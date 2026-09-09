import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Purchase, PurchaseDocument } from './schemas/purchase.schema';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { InventoryService } from '../inventory/inventory.service';
import { BusinessesService } from '../businesses/businesses.service';
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
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    private readonly inventoryService: InventoryService,
    private readonly businessesService: BusinessesService,
  ) {}

  async create(
    businessId: string,
    dto: CreatePurchaseDto,
  ): Promise<Purchase> {
    const business = await this.businessesService.findById(businessId);
    const currency = dto.currency || business?.currency || 'INR';

    const prefix = business?.purchasePrefix || 'PO-';
    const serial =
      business?.purchaseNextSerial ||
      (await this.purchaseModel.countDocuments({
        businessId: new Types.ObjectId(businessId),
      })) + 1;
    const purchaseNumber = `${prefix}${new Date().getFullYear()}-${String(serial).padStart(3, '0')}`;
    await this.businessesService.update(businessId, {
      purchaseNextSerial: serial + 1,
    });

    let totalAmount = 0;
    const items = [];

    for (const item of dto.items) {
      const amount = item.quantity * item.costPrice;
      totalAmount += amount;

      let validItemId: Types.ObjectId | undefined;
      if (item.itemId && Types.ObjectId.isValid(item.itemId)) {
        validItemId = new Types.ObjectId(item.itemId);
      } else {
        // Automatically create in Inventory Catalog if it's a custom uncatalogued item
        try {
          const newItem = await this.inventoryService.create(businessId, {
            name: item.name.trim(),
            unit: 'pcs',
            salePrice: item.costPrice > 0 ? item.costPrice * 1.2 : 0,
            costPrice: item.costPrice,
            stockQuantity: 0,
            minStockAlert: 5,
            isService: false,
          });
          validItemId = new Types.ObjectId((newItem as any)._id);
        } catch {
          // If creation fails, proceed without linking itemId
        }
      }

      items.push({
        itemId: validItemId,
        name: item.name,
        quantity: item.quantity,
        costPrice: item.costPrice,
        amount,
      });

      // Auto increment stock quantities in Inventory Catalog if validItemId is set
      if (validItemId) {
        try {
          await this.inventoryService.adjustStock(
            businessId,
            validItemId.toString(),
            item.quantity,
          );
        } catch {
          // Continue if stock adjustment fails
        }
      }
    }

    const purchase = new this.purchaseModel({
      businessId: new Types.ObjectId(businessId),
      purchaseNumber,
      supplierName: dto.supplierName.trim(),
      supplierPhone: dto.supplierPhone?.trim(),
      supplierInvoiceNumber: dto.supplierInvoiceNumber?.trim(),
      purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : new Date(),
      currency,
      paymentStatus: dto.paymentStatus || 'paid',
      paymentMethod: dto.paymentMethod || 'cash',
      items,
      totalAmount,
      notes: dto.notes?.trim(),
    });

    return purchase.save();
  }

  /**
   * One page of purchase bills, newest first.
   *
   * A purchase names its supplier directly rather than a customer, so the
   * search stays on the document's own fields — no id lookup needed.
   */
  async findPageForBusiness(
    businessId: string,
    options: {
      paymentStatus?: string;
      search?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<Page<PurchaseDocument>> {
    const limit = clampLimit(options.limit);
    const cursor = decodePageCursor(options.cursor);

    const filter = andFilters(
      { businessId: idFilter(businessId) },
      options.paymentStatus && options.paymentStatus !== 'all'
        ? { paymentStatus: options.paymentStatus }
        : {},
      textSearchFilter(options.search, [
        'purchaseNumber',
        'supplierName',
        'supplierPhone',
        'supplierInvoiceNumber',
      ]),
      pageCursorFilter(cursor, 'purchaseDate', 'desc'),
    );

    const [rows, total] = await Promise.all([
      this.purchaseModel
        .find(filter)
        .sort(pageSort('purchaseDate', 'desc'))
        .limit(limit + 1)
        .exec(),
      cursor ? Promise.resolve(undefined) : this.purchaseModel.countDocuments(filter).exec(),
    ]);

    return buildPage(rows, limit, (row) => ({
      v: row.purchaseDate.toISOString(),
      id: (row._id as { toString(): string }).toString(),
    }), total);
  }

  async findAll(businessId: string): Promise<Purchase[]> {
    return this.purchaseModel
      .find({ businessId: new Types.ObjectId(businessId) })
      .sort({ purchaseDate: -1 })
      .exec();
  }

  async findOne(businessId: string, id: string): Promise<Purchase> {
    const purchase = await this.purchaseModel
      .findOne({
        _id: new Types.ObjectId(id),
        businessId: new Types.ObjectId(businessId),
      })
      .exec();
    if (!purchase) {
      throw new NotFoundException('Purchase bill not found');
    }
    return purchase;
  }
}
