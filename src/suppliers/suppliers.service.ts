import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Supplier, SupplierDocument } from './schemas/supplier.schema';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { phoneMatchPatterns } from '../common/utils/phone-match';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  andFilters,
  cursorFilter,
  decodeCursor,
  encodeCursor,
  searchFilter,
} from '../customers/customer-page';

// Deliberately simpler than CustomersService: suppliers carry no free-tier
// cap (they are not what the plan meters) and no technician scoping (a
// technician has no supplier book of their own). Everything else — the
// duplicate-phone guard and the cursor paging — mirrors the customer book so
// the two lists behave identically in the app.
@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
  ) {}

  async create(businessId: string, dto: CreateSupplierDto): Promise<SupplierDocument> {
    // Matched on digits, not the literal string, so the same supplier stored
    // as "9876543210" and "+91 98765 43210" is caught once.
    const patterns = phoneMatchPatterns(dto.phone);
    const existing = patterns.length
      ? await this.supplierModel
          .findOne({
            businessId,
            $or: patterns.map((pattern) => ({ phone: { $regex: pattern } })),
          })
          .exec()
      : null;
    if (existing) {
      throw new ConflictException({
        message: 'A supplier with this phone number already exists.',
        existingSupplierId: existing.id,
        existingSupplierName: existing.name,
      });
    }

    return this.supplierModel.create({
      ...dto,
      businessId,
      source: dto.source ?? 'manual',
    });
  }

  async findPage(
    businessId: string,
    options: { search?: string; limit?: number; cursor?: string },
  ): Promise<{ items: SupplierDocument[]; nextCursor: string | null; total?: number }> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const cursor = decodeCursor(options.cursor);

    // andFilters rather than a spread: scope, search and cursor are each a
    // top-level $or and spreading would keep only the last.
    const filter = andFilters(
      { businessId },
      searchFilter(options.search),
      cursorFilter(cursor),
    );

    // One extra row reveals whether another page exists without a count().
    // The count runs only for the first page, where the app displays it.
    const [rows, total] = await Promise.all([
      this.supplierModel.find(filter).sort({ name: 1, _id: 1 }).limit(limit + 1).exec(),
      cursor ? Promise.resolve(undefined) : this.supplierModel.countDocuments(filter).exec(),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last ? encodeCursor({ name: last.name, id: last.id as string }) : null,
      total,
    };
  }

  async findOne(businessId: string, id: string): Promise<SupplierDocument> {
    const supplier = await this.supplierModel.findOne({ _id: id, businessId }).exec();
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(
    businessId: string,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierDocument> {
    const supplier = await this.supplierModel
      .findOneAndUpdate({ _id: id, businessId }, dto, { new: true })
      .exec();
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async remove(businessId: string, id: string): Promise<void> {
    const res = await this.supplierModel.deleteOne({ _id: id, businessId }).exec();
    if (!res.deletedCount) throw new NotFoundException('Supplier not found');
  }
}
