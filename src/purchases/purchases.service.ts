import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Purchase,
  PurchaseDocument,
  PurchaseItem,
} from './schemas/purchase.schema';
import { CreatePurchaseDto, PurchaseItemDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
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

// One place decides the status from the numbers, so a purchase can never
// read "unpaid" while carrying a full payment.
export function derivePaymentStatus(
  totalAmount: number,
  amountPaid: number,
): 'paid' | 'unpaid' | 'partially_paid' {
  if (amountPaid <= 0) return 'unpaid';
  if (amountPaid >= totalAmount) return 'paid';
  return 'partially_paid';
}

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    private readonly inventoryService: InventoryService,
    private readonly businessesService: BusinessesService,
  ) {}

  async create(businessId: string, dto: CreatePurchaseDto): Promise<Purchase> {
    const business = await this.businessesService.findById(businessId);
    const currency = dto.currency || business?.currency || 'INR';

    const prefix = business?.purchasePrefix || 'PO-';
    const serial =
      business?.purchaseNextSerial ||
      (await this.purchaseModel.countDocuments({
        businessId: idFilter(businessId),
      })) + 1;
    const purchaseNumber = `${prefix}${new Date().getFullYear()}-${String(serial).padStart(3, '0')}`;
    await this.businessesService.update(businessId, {
      purchaseNextSerial: serial + 1,
    });

    const { items, totalAmount } = await this.buildItems(businessId, dto.items);

    // Auto increment stock quantities in Inventory Catalog for linked lines
    await this.moveStock(businessId, this.stockDeltas([], items));

    // An explicit amount wins; otherwise it follows the status the user
    // chose, so the common "paid at the counter" and "on credit" cases need
    // no extra input. The status is then re-derived from the amount, which
    // keeps the two from contradicting each other.
    const requestedStatus = dto.paymentStatus || 'paid';
    const amountPaid = Math.min(
      totalAmount,
      Math.max(
        0,
        dto.amountPaid ?? (requestedStatus === 'paid' ? totalAmount : 0),
      ),
    );
    const paymentStatus = derivePaymentStatus(totalAmount, amountPaid);

    const purchase = new this.purchaseModel({
      businessId: new Types.ObjectId(businessId),
      purchaseNumber,
      supplierId: dto.supplierId
        ? new Types.ObjectId(dto.supplierId)
        : undefined,
      supplierName: dto.supplierName.trim(),
      supplierPhone: dto.supplierPhone?.trim(),
      supplierInvoiceNumber: dto.supplierInvoiceNumber?.trim(),
      purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : new Date(),
      currency,
      paymentStatus,
      paymentMethod: dto.paymentMethod || 'cash',
      items,
      totalAmount,
      amountPaid,
      balanceDue: Math.max(0, totalAmount - amountPaid),
      notes: dto.notes?.trim(),
    });

    return purchase.save();
  }

  /**
   * Corrects a logged purchase: supplier, bill details, lines and the amount
   * paid. The purchase number never changes.
   *
   * Stock follows the lines: what the old lines added comes back out and
   * what the new lines add goes in, netted per inventory item so an
   * unchanged line moves nothing. Netting matters because adjustStock floors
   * at 0 — taking 10 out of an item that has since sold down to 2 would floor
   * it at 0 and then putting the same 10 back would read 10, not 2.
   *
   * When a line is cut below what has already been sold since, the item's
   * stock is floored at 0 by adjustStock rather than going negative; the
   * edit still goes through.
   */
  async update(
    businessId: string,
    id: string,
    dto: UpdatePurchaseDto,
  ): Promise<Purchase> {
    const purchase = await this.findOwned(businessId, id);

    const built = dto.items
      ? await this.buildItems(businessId, dto.items)
      : null;
    const totalAmount = built ? built.totalAmount : purchase.totalAmount;
    const amountPaid = Math.min(
      totalAmount,
      Math.max(0, dto.amountPaid ?? purchase.amountPaid ?? 0),
    );

    const set: Record<string, unknown> = {
      totalAmount,
      amountPaid,
      balanceDue: Math.max(0, totalAmount - amountPaid),
      paymentStatus: derivePaymentStatus(totalAmount, amountPaid),
    };
    const unset: Record<string, ''> = {};
    if (built) set.items = built.items;
    if (dto.supplierName !== undefined) {
      if (!dto.supplierName.trim()) {
        throw new BadRequestException('Supplier name cannot be empty');
      }
      set.supplierName = dto.supplierName.trim();
    }
    if (dto.supplierId) set.supplierId = new Types.ObjectId(dto.supplierId);
    if (dto.purchaseDate) set.purchaseDate = new Date(dto.purchaseDate);
    if (dto.paymentMethod) set.paymentMethod = dto.paymentMethod;
    // An empty string clears an optional text field; leaving it out keeps it.
    for (const key of [
      'supplierPhone',
      'supplierInvoiceNumber',
      'notes',
    ] as const) {
      const value = dto[key];
      if (value === undefined) continue;
      if (value.trim()) set[key] = value.trim();
      else unset[key] = '';
    }

    // Written only if nobody else changed the purchase since it was read
    // (an edit, a payment): two edits racing on the same old lines would
    // otherwise both take their stock back out. No transactions here, so the
    // stock moves after the write, best-effort per item like create().
    const updated = await this.purchaseModel
      .findOneAndUpdate(
        {
          _id: purchase._id,
          businessId: idFilter(businessId),
          updatedAt: purchase.get('updatedAt') ?? { $exists: false },
        },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'This purchase was changed while you were editing it. Reload it and try again.',
      );
    }

    if (built) {
      await this.moveStock(
        businessId,
        this.stockDeltas(purchase.items, built.items),
      );
    }
    return updated;
  }

  /**
   * Deletes a purchase and takes the stock its lines added back out of
   * inventory (floored at 0 by adjustStock, as in update()).
   *
   * The delete is the atomic step and the stock follows from the document it
   * removed, so two deletes racing cannot both take the stock out.
   */
  async remove(businessId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Purchase bill not found');
    }
    const removed = await this.purchaseModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        businessId: idFilter(businessId),
      })
      .exec();
    if (!removed) throw new NotFoundException('Purchase bill not found');
    await this.moveStock(businessId, this.stockDeltas(removed.items, []));
  }

  /**
   * Turns submitted lines into stored ones. A line not picked from the
   * catalogue is added to it first (at stock 0, so moveStock() can then add
   * the purchased quantity like any other line). Moves no stock itself.
   */
  private async buildItems(
    businessId: string,
    lines: PurchaseItemDto[],
  ): Promise<{ items: PurchaseItem[]; totalAmount: number }> {
    let totalAmount = 0;
    const items: PurchaseItem[] = [];

    for (const item of lines) {
      const amount = item.quantity * item.costPrice;
      totalAmount += amount;

      let validItemId: Types.ObjectId | undefined;
      const existing =
        item.itemId && Types.ObjectId.isValid(item.itemId)
          ? null
          : await this.inventoryService
              .findByExactName(businessId, item.name)
              .catch(() => null);
      if (item.itemId && Types.ObjectId.isValid(item.itemId)) {
        validItemId = new Types.ObjectId(item.itemId);
      } else if (existing) {
        // Typed by hand but already stocked: restock that item rather than
        // creating a second one with the same name.
        validItemId = new Types.ObjectId(String(existing._id));
      } else {
        // Automatically create in Inventory Catalog if it's a custom uncatalogued item
        try {
          const newItem = await this.inventoryService.create(businessId, {
            name: item.name.trim(),
            hsnCode: item.hsnCode?.trim().toUpperCase(),
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
        hsnCode: item.hsnCode?.trim().toUpperCase(),
        quantity: item.quantity,
        costPrice: item.costPrice,
        amount,
      });
    }

    return { items, totalAmount };
  }

  // Net stock change per inventory item going from `before` lines to
  // `after` lines. Lines with no linked item never moved stock.
  private stockDeltas(
    before: { itemId?: unknown; quantity: number }[],
    after: { itemId?: unknown; quantity: number }[],
  ): Map<string, number> {
    const deltas = new Map<string, number>();
    const add = (lines: typeof before, sign: 1 | -1) => {
      for (const line of lines) {
        if (!line.itemId) continue;
        const key = String(line.itemId);
        deltas.set(key, (deltas.get(key) ?? 0) + sign * line.quantity);
      }
    };
    add(before, -1);
    add(after, 1);
    return deltas;
  }

  // Best-effort per item: one deleted from the catalogue since must not stop
  // the purchase being saved (same rule as invoicing's restoreStock).
  private async moveStock(
    businessId: string,
    deltas: Map<string, number>,
  ): Promise<void> {
    for (const [itemId, change] of deltas) {
      if (!change) continue;
      try {
        await this.inventoryService.adjustStock(businessId, itemId, change);
      } catch {
        // Continue if stock adjustment fails
      }
    }
  }

  private async findOwned(
    businessId: string,
    id: string,
  ): Promise<PurchaseDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Purchase bill not found');
    }
    const purchase = await this.purchaseModel
      .findOne({
        _id: new Types.ObjectId(id),
        businessId: idFilter(businessId),
      })
      .exec();
    if (!purchase) throw new NotFoundException('Purchase bill not found');
    return purchase;
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
      cursor
        ? Promise.resolve(undefined)
        : this.purchaseModel.countDocuments(filter).exec(),
    ]);

    return buildPage(
      rows,
      limit,
      (row) => ({
        v: row.purchaseDate.toISOString(),
        id: (row._id as { toString(): string }).toString(),
      }),
      total,
    );
  }

  async findAll(businessId: string): Promise<Purchase[]> {
    return this.purchaseModel
      .find({ businessId: idFilter(businessId) })
      .sort({ purchaseDate: -1 })
      .exec();
  }

  /**
   * Records money handed to a supplier against one purchase.
   *
   * Additive rather than absolute: the caller says "I just paid 2,000", not
   * "the total paid is now 5,000", so two people recording payments cannot
   * silently overwrite each other's entry.
   */
  async recordPayment(
    businessId: string,
    id: string,
    amount: number,
  ): Promise<Purchase> {
    const purchase = await this.purchaseModel
      .findOne({ _id: id, businessId: idFilter(businessId) })
      .exec();
    if (!purchase) throw new NotFoundException('Purchase not found');

    const alreadyPaid = purchase.amountPaid ?? 0;
    const amountPaid = Math.min(purchase.totalAmount, alreadyPaid + amount);
    purchase.amountPaid = amountPaid;
    purchase.balanceDue = Math.max(0, purchase.totalAmount - amountPaid);
    purchase.paymentStatus = derivePaymentStatus(
      purchase.totalAmount,
      amountPaid,
    );
    return purchase.save();
  }

  /**
   * What the business owes, grouped by supplier — the payables side of the
   * ledger, which had no representation anywhere before.
   *
   * Grouped by supplierId where a purchase has one and by name otherwise, so
   * bills logged before the supplier book existed still total up instead of
   * being dropped.
   */
  async payablesBySupplier(businessId: string): Promise<{
    totalOutstanding: number;
    suppliers: {
      supplierId: string | null;
      supplierName: string;
      outstanding: number;
      billCount: number;
    }[];
  }> {
    const rows = await this.purchaseModel
      .aggregate<{
        _id: { supplierId: Types.ObjectId | null; supplierName: string };
        outstanding: number;
        billCount: number;
      }>([
        { $match: { businessId: idFilter(businessId) } },
        {
          // Rows written before balanceDue existed have no value at all;
          // treat those as settled rather than as fully owed.
          $addFields: {
            outstandingAmount: { $ifNull: ['$balanceDue', 0] },
          },
        },
        { $match: { outstandingAmount: { $gt: 0 } } },
        {
          $group: {
            _id: {
              supplierId: { $ifNull: ['$supplierId', null] },
              supplierName: '$supplierName',
            },
            outstanding: { $sum: '$outstandingAmount' },
            billCount: { $sum: 1 },
          },
        },
        { $sort: { outstanding: -1 } },
      ])
      .exec();

    const suppliers = rows.map((r) => ({
      supplierId: r._id.supplierId ? r._id.supplierId.toString() : null,
      supplierName: r._id.supplierName,
      outstanding: r.outstanding,
      billCount: r.billCount,
    }));

    return {
      totalOutstanding: suppliers.reduce((sum, s) => sum + s.outstanding, 0),
      suppliers,
    };
  }

  async findOne(businessId: string, id: string): Promise<Purchase> {
    const purchase = await this.purchaseModel
      .findOne({
        _id: new Types.ObjectId(id),
        businessId: idFilter(businessId),
      })
      .exec();
    if (!purchase) {
      throw new NotFoundException('Purchase bill not found');
    }
    return purchase;
  }
}
