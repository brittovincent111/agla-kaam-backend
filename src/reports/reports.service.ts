import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Invoice, InvoiceDocument } from '../invoicing/schemas/invoice.schema';
import { Payment, PaymentDocument } from '../invoicing/schemas/payment.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { Amc, AmcDocument } from '../amc/schemas/amc.schema';
import {
  InventoryItem,
  InventoryItemDocument,
} from '../inventory/schemas/inventory-item.schema';
import {
  Purchase,
  PurchaseDocument,
} from '../purchases/schemas/purchase.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  Business,
  BusinessDocument,
} from '../businesses/schemas/business.schema';
import { idFilter } from '../common/utils/id-match';
import { ReportRange, resolveRange } from './report-range';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Every figure on the Reports screen, totalled in the database.
 *
 * The screen used to download every invoice and purchase onto the phone and
 * only the first 100 services and AMCs, then add them up there — slow on
 * a cheap phone, and simply wrong for any business past 100 jobs. It also
 * counted drafts and cancelled invoices as "issued", and scheduled or
 * cancelled jobs as "services".
 *
 * Definitions, now stated once:
 *  - Invoiced: total of invoices dated in the range, drafts and cancelled
 *    left out.
 *  - Collected: payments RECEIVED in the range (by payment date) — money in
 *    the bank this month, whichever month it was billed.
 *  - Outstanding: what is still owed on the invoices dated in the range.
 *  - Services done: jobs COMPLETED in the range.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(Amc.name) private readonly amcModel: Model<AmcDocument>,
    @InjectModel(InventoryItem.name)
    private readonly inventoryModel: Model<InventoryItemDocument>,
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  async summary(businessId: string, range: ReportRange) {
    const biz = await this.businessModel
      .findById(businessId)
      .select('timezone')
      .lean()
      .exec();
    const { from, to } = resolveRange(range, biz?.timezone);
    const inRange = (field: string) =>
      from && to ? { [field]: { $gte: from, $lt: to } } : {};
    const owned = { businessId: idFilter(businessId) };

    const [
      invoiceAgg,
      collectedAgg,
      topPayers,
      servicesAgg,
      activeAmcs,
      stockAgg,
      lowStock,
      purchaseAgg,
    ] = await Promise.all([
      this.invoiceModel
        .aggregate<{
          count: number;
          paid: number;
          invoiced: number;
          outstanding: number;
        }>([
          {
            $match: {
              ...owned,
              status: { $nin: ['draft', 'cancelled'] },
              ...inRange('invoiceDate'),
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
              invoiced: { $sum: '$total' },
              outstanding: { $sum: '$balanceDue' },
            },
          },
        ])
        .exec(),
      this.paymentModel
        .aggregate<{ collected: number; count: number }>([
          { $match: { ...owned, ...inRange('paymentDate') } },
          {
            $group: {
              _id: null,
              collected: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      // Top customers by money actually received from them in the range.
      this.paymentModel
        .aggregate<{ _id: unknown; amount: number; invoices: string[] }>([
          { $match: { ...owned, ...inRange('paymentDate') } },
          {
            $group: {
              // As text: ids are stored both ways (see id-match.ts), and
              // grouping on the raw value split one customer in two.
              _id: { $toString: '$customerId' },
              amount: { $sum: '$amount' },
              invoices: { $addToSet: '$invoiceId' },
            },
          },
          { $sort: { amount: -1 } },
          { $limit: 10 },
        ] as PipelineStage[])
        .exec(),
      this.serviceModel
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              ...owned,
              status: 'completed',
              ...inRange('completedAt'),
            },
          },
          {
            $group: {
              _id: { $ifNull: ['$serviceType', 'General Service'] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ])
        .exec(),
      this.amcModel.countDocuments({ ...owned, status: 'active' }).exec(),
      this.inventoryModel
        .aggregate<{ items: number; stockValue: number; lowStock: number }>([
          { $match: owned },
          {
            $group: {
              _id: null,
              items: { $sum: 1 },
              stockValue: {
                $sum: {
                  $cond: [
                    { $eq: ['$isService', true] },
                    0,
                    {
                      $multiply: [
                        { $ifNull: ['$stockQuantity', 0] },
                        { $ifNull: ['$costPrice', 0] },
                      ],
                    },
                  ],
                },
              },
              lowStock: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$isService', true] },
                        {
                          $lte: [
                            { $ifNull: ['$stockQuantity', 0] },
                            { $ifNull: ['$minStockAlert', 0] },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
      this.inventoryModel
        .find({
          ...owned,
          isService: { $ne: true },
          $expr: {
            $lte: [
              { $ifNull: ['$stockQuantity', 0] },
              { $ifNull: ['$minStockAlert', 0] },
            ],
          },
        })
        .select('name sku unit stockQuantity')
        .sort({ stockQuantity: 1 })
        .limit(5)
        .lean()
        .exec(),
      this.purchaseModel
        .aggregate<{ spent: number }>([
          { $match: { ...owned, ...inRange('purchaseDate') } },
          { $group: { _id: null, spent: { $sum: '$totalAmount' } } },
        ])
        .exec(),
    ]);

    // Names for the top payers — one query, not one per customer.
    const payerIds = topPayers.map((p) => String(p._id)).filter(Boolean);
    const names = payerIds.length
      ? await this.customerModel
          .find({ ...owned, _id: { $in: payerIds } })
          .select('name')
          .lean()
          .exec()
      : [];
    const nameOf = new Map(names.map((c) => [String(c._id), c.name]));

    const inv = invoiceAgg[0] ?? {
      count: 0,
      paid: 0,
      invoiced: 0,
      outstanding: 0,
    };
    const collected = round2(collectedAgg[0]?.collected ?? 0);
    const servicesDone = servicesAgg.reduce((sum, row) => sum + row.count, 0);
    const stock = stockAgg[0] ?? { items: 0, stockValue: 0, lowStock: 0 };

    return {
      range,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      sales: {
        invoiced: round2(inv.invoiced),
        collected,
        outstanding: round2(inv.outstanding),
        invoiceCount: inv.count,
        paidCount: inv.paid,
        // Share of the range's invoices that are fully paid.
        collectionRate: inv.count
          ? Math.round((inv.paid / inv.count) * 100)
          : 100,
        averageInvoice: inv.count ? Math.round(inv.invoiced / inv.count) : 0,
        paymentsCount: collectedAgg[0]?.count ?? 0,
      },
      services: {
        completed: servicesDone,
        topTypes: servicesAgg
          .slice(0, 5)
          .map((row) => ({ type: row._id, count: row.count })),
        activeAmcs,
      },
      inventory: {
        items: stock.items,
        stockValue: round2(stock.stockValue),
        lowStockCount: stock.lowStock,
        lowStockItems: lowStock.map((item) => ({
          _id: String(item._id),
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          stockQuantity: item.stockQuantity,
        })),
      },
      purchases: { spent: round2(purchaseAgg[0]?.spent ?? 0) },
      topCustomers: topPayers.map((p) => ({
        customerId: String(p._id),
        customerName: nameOf.get(String(p._id)) ?? 'Customer',
        totalAmount: round2(p.amount),
        count: p.invoices.length,
      })),
    };
  }
}
