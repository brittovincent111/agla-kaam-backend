import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InventoryItem, InventoryItemDocument } from './schemas/inventory-item.schema';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import {
  Page,
  andFilters,
  buildPage,
  clampLimit,
  decodePageCursor,
  pageCursorFilter,
  pageSort,
  textSearchFilter,
} from '../common/pagination/cursor-page';
import { idFilter } from '../common/utils/id-match';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(InventoryItem.name)
    private readonly inventoryItemModel: Model<InventoryItemDocument>,
  ) {}

  async create(
    businessId: string,
    dto: CreateInventoryItemDto,
  ): Promise<InventoryItem> {
    const created = new this.inventoryItemModel({
      ...dto,
      businessId: new Types.ObjectId(businessId),
      costPrice: dto.costPrice ?? 0,
      stockQuantity: dto.stockQuantity ?? 0,
      minStockAlert: dto.minStockAlert ?? 5,
    });
    return created.save();
  }

  /**
   * One page of the catalogue, in alphabetical order.
   *
   * Alphabetical rather than newest-first because this list is read as a
   * reference — you come to it looking for a specific part. That makes the
   * sort key the item's name, so the cursor is a text key, not a date one
   * (see CursorKeyType); the { businessId, name } index already covers it.
   *
   * The search runs here rather than on the device: a catalogue of a few
   * thousand parts was being downloaded in full on every focus, and matching
   * client-side meant the search box could only ever see what had already
   * been fetched.
   */
  async findPageForBusiness(
    businessId: string,
    options: { type?: string; search?: string; limit?: number; cursor?: string },
  ): Promise<Page<InventoryItemDocument>> {
    const limit = clampLimit(options.limit);
    const cursor = decodePageCursor(options.cursor);

    const filter = andFilters(
      { businessId: idFilter(businessId) },
      options.type === 'product'
        ? { isService: { $ne: true } }
        : options.type === 'service'
          ? { isService: true }
          : {},
      textSearchFilter(options.search, ['name', 'sku', 'hsnCode']),
      pageCursorFilter(cursor, 'name', 'asc', 'text'),
    );

    const [rows, total] = await Promise.all([
      this.inventoryItemModel
        .find(filter)
        .sort(pageSort('name', 'asc'))
        .limit(limit + 1)
        .exec(),
      // Counted once, with the first page — a count on every scroll would
      // re-scan the whole collection for a number that has not changed.
      cursor
        ? Promise.resolve(undefined)
        : this.inventoryItemModel.countDocuments(filter).exec(),
    ]);

    return buildPage(
      rows,
      limit,
      (row) => ({
        v: row.name,
        id: (row._id as { toString(): string }).toString(),
      }),
      total,
    );
  }

  // The unpaged catalogue. Kept for already-installed app versions, which
  // still call it; new callers should use findPageForBusiness.
  async findAll(businessId: string): Promise<InventoryItem[]> {
    return this.inventoryItemModel
      .find({ businessId: new Types.ObjectId(businessId) })
      .sort({ name: 1 })
      .exec();
  }

  async findOne(businessId: string, id: string): Promise<InventoryItem> {
    const item = await this.inventoryItemModel
      .findOne({
        _id: new Types.ObjectId(id),
        businessId: new Types.ObjectId(businessId),
      })
      .exec();
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }
    return item;
  }

  async update(
    businessId: string,
    id: string,
    dto: UpdateInventoryItemDto,
  ): Promise<InventoryItem> {
    const updated = await this.inventoryItemModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          businessId: new Types.ObjectId(businessId),
        },
        { $set: dto },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Inventory item not found');
    }
    return updated;
  }

  async remove(businessId: string, id: string): Promise<void> {
    const result = await this.inventoryItemModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        businessId: new Types.ObjectId(businessId),
      })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Inventory item not found');
    }
  }

  async adjustStock(
    businessId: string,
    id: string,
    quantityChange: number,
  ): Promise<InventoryItem> {
    const item = await this.findOne(businessId, id);
    if (item.isService) return item;

    const newStock = (item.stockQuantity || 0) + quantityChange;
    item.stockQuantity = Math.max(0, newStock);
    return (item as InventoryItemDocument).save();
  }
}
