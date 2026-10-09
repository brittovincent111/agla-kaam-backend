import { dateRangeFilter } from '../common/pagination/date-range';
import {
  SortSpec,
  amountRangeFilter,
  cursorValue,
  splitList,
} from '../common/pagination/list-options';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { CustomersService } from '../customers/customers.service';
import { ServicesService } from '../services/services.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BusinessesService } from '../businesses/businesses.service';
import {
  applyLineTax,
  calculateInvoiceTotals,
  computeDisplayStatus,
} from '../common/constants/invoice-options';
import {
  FREE_TIER_INVOICE_LIMIT,
  tierHasInvoicing,
} from '../common/constants/subscription-options';
import {
  Page,
  andFilters,
  buildPage,
  clampLimit,
  decodePageCursor,
  pageCursorFilter,
  pageSort,
} from '../common/pagination/cursor-page';
import {
  SEARCH_CUSTOMER_CAP,
  numberOrCustomerFilter,
} from '../common/pagination/document-search';
import { idFilter, idsFilter } from '../common/utils/id-match';

const DEFAULT_PAYMENT_TERM_DAYS = 7;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

import { InventoryService } from '../inventory/inventory.service';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';

@Injectable()
export class InvoicingService {
  constructor(
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly customersService: CustomersService,
    private readonly servicesService: ServicesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly businessesService: BusinessesService,
    private readonly inventoryService: InventoryService,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
  ) {}

  private withDisplayStatus(
    invoice: InvoiceDocument,
  ): Invoice & { _id: Types.ObjectId } {
    const plain = invoice.toObject();
    return {
      ...plain,
      status: computeDisplayStatus(
        plain.status,
        plain.dueDate,
        plain.balanceDue,
      ),
    };
  }

  private async nextInvoiceNumber(businessId: string): Promise<string> {
    const business = await this.businessesService.findById(businessId);
    const prefix = business?.invoicePrefix || 'INV-';
    // Atomic — see BusinessesService.allocateSerial. Seeded from the count
    // only the very first time, for businesses that pre-date the counter.
    const serial = await this.businessesService.allocateSerial(
      businessId,
      'invoiceNextSerial',
      async () =>
        (await this.invoiceModel
          .countDocuments({ businessId: idFilter(businessId) })
          .exec()) + 1,
    );
    return `${prefix}${new Date().getFullYear()}-${String(serial).padStart(3, '0')}`;
  }

  private async buildItems(
    businessId: string,
    customerId: string,
    dtoItems: CreateInvoiceDto['items'],
  ) {
    return Promise.all(
      dtoItems.map(async (item) => {
        if (item.serviceId) {
          // Confirms the referenced service actually belongs to this
          // business/customer before it can be billed.
          const service = await this.servicesService.findOne(
            businessId,
            item.serviceId,
          );
          if (service.customerId.toString() !== customerId) {
            throw new BadRequestException(
              'Service does not belong to the selected customer',
            );
          }
        }
        const taxRate = item.taxRate ?? 0;
        const amount =
          Math.round((item.quantity * item.rate + Number.EPSILON) * 100) / 100;
        // Placeholder only. The real per-line tax depends on this line's share
        // of the invoice-level discount, which is not known until every line
        // is priced — applyLineTax() below overwrites it from
        // calculateInvoiceTotals().
        const taxAmount = 0;
        return {
          serviceId: item.serviceId,
          name: item.name,
          description: item.description,
          hsnCode: item.hsnCode,
          quantity: item.quantity,
          rate: item.rate,
          taxRate,
          amount,
          taxAmount,
        };
      }),
    );
  }

  async create(
    businessId: string,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceDocument> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    if (!tierHasInvoicing(tier)) {
      const count = await this.invoiceModel
        .countDocuments({
          businessId: idFilter(businessId),
          status: { $ne: 'cancelled' },
        })
        .exec();
      if (count >= FREE_TIER_INVOICE_LIMIT) {
        throw new ForbiddenException(
          `Free plan is limited to ${FREE_TIER_INVOICE_LIMIT} invoices. Upgrade to the Invoicing or Combo plan for unlimited invoices.`,
        );
      }
    }

    await this.customersService.findOne(businessId, dto.customerId);

    // Snapshotted onto the invoice below rather than read live at render
    // time — a later change to the business's currency/tax setup must not
    // retroactively relabel an invoice that already went out to a customer.
    const business = await this.businessesService.findById(businessId);

    const items = await this.buildItems(businessId, dto.customerId, dto.items);
    const totals = calculateInvoiceTotals(items, dto.discount ?? 0);
    applyLineTax(items, totals);
    const invoiceDate = dto.invoiceDate
      ? new Date(dto.invoiceDate)
      : new Date();
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : addDays(invoiceDate, DEFAULT_PAYMENT_TERM_DAYS);
    const fields = {
      businessId,
      customerId: dto.customerId,
      invoiceDate,
      dueDate,
      status: 'draft' as const,
      currency: business.currency || 'INR',
      taxType: business.taxType || 'gst',
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      amountPaid: 0,
      balanceDue: totals.total,
      notes: dto.notes,
      paymentTerms: dto.paymentTerms,
      termsAndConditions: dto.termsAndConditions,
    };

    // A number that is already taken (the counter was set behind numbers in
    // use) fails on the unique {businessId, invoiceNumber} index. allocateSerial
    // is atomic, so one more allocation moves past the collision instead of
    // surfacing a raw 500.
    //
    // Stock is not touched here: a draft has not been billed. It moves when
    // the invoice is sent — see send().
    for (let attempt = 0; ; attempt++) {
      const invoiceNumber = await this.nextInvoiceNumber(businessId);
      try {
        return await this.invoiceModel.create({ ...fields, invoiceNumber });
      } catch (err) {
        const e = err as {
          code?: number;
          keyPattern?: Record<string, unknown>;
        };
        if (attempt === 0 && e?.code === 11000 && e.keyPattern?.invoiceNumber) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Takes the invoice's goods out of the inventory catalogue, matching lines
   * to tracked items by name (invoice lines carry no item id). Returns what
   * was taken, for cancel() to put back.
   *
   * Best-effort per line: an item deleted from the catalogue, or a name that
   * matches nothing, must not stop an invoice from being sent.
   */
  private async deductStock(
    businessId: string,
    items: { name: string; quantity: number }[],
  ): Promise<{ itemId: string; quantity: number }[]> {
    const deductions: { itemId: string; quantity: number }[] = [];
    let catalogue: InventoryItem[];
    try {
      catalogue = await this.inventoryService.findAll(businessId);
    } catch {
      return deductions;
    }
    for (const item of items) {
      const match = catalogue.find(
        (inv) =>
          inv.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
      );
      if (!match || match.isService) continue;
      const itemId = (
        match as unknown as { _id: Types.ObjectId }
      )._id.toString();
      try {
        await this.inventoryService.adjustStock(
          businessId,
          itemId,
          -item.quantity,
        );
        deductions.push({ itemId, quantity: item.quantity });
      } catch {
        // Not tracked any more — nothing to deduct.
      }
    }
    return deductions;
  }

  // Puts back what deductStock() took. Same best-effort rule.
  private async restoreStock(
    businessId: string,
    deductions: { itemId: string; quantity: number }[] | undefined,
  ): Promise<void> {
    for (const { itemId, quantity } of deductions ?? []) {
      try {
        await this.inventoryService.adjustStock(businessId, itemId, quantity);
      } catch {
        // The item has since been deleted from the catalogue.
      }
    }
  }

  async findOne(
    businessId: string,
    invoiceId: string,
  ): Promise<InvoiceDocument> {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new NotFoundException('Invoice not found');
    }
    const invoice = await this.invoiceModel.findById(invoiceId).exec();
    if (!invoice || invoice.businessId.toString() !== businessId) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  /**
   * One customer's billing at a glance, over every invoice — the customer
   * screen used to add up only the three it had loaded, so a customer with
   * twenty invoices showed the total of the latest three. Drafts and
   * cancelled invoices are not money billed, so they are left out.
   */
  async customerSummary(businessId: string, customerId: string) {
    const [row] = await this.invoiceModel
      .aggregate<{ invoiced: number; outstanding: number; count: number }>([
        {
          $match: {
            businessId: idFilter(businessId),
            customerId: idFilter(customerId),
            status: { $nin: ['draft', 'cancelled'] },
          },
        },
        {
          $group: {
            _id: null,
            invoiced: { $sum: '$total' },
            outstanding: { $sum: '$balanceDue' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    return {
      invoiced: round(row?.invoiced ?? 0),
      outstanding: round(row?.outstanding ?? 0),
      count: row?.count ?? 0,
    };
  }

  // The latest live invoice that bills this job (drafts included: "invoice
  // started"), for the completed job's checklist and its WhatsApp message.
  async findLatestForService(businessId: string, serviceId: string) {
    const invoice = await this.invoiceModel
      .findOne({
        businessId: idFilter(businessId),
        'items.serviceId': idFilter(serviceId),
        status: { $ne: 'cancelled' },
      })
      .sort({ createdAt: -1 })
      .exec();
    return invoice ? this.withDisplayStatus(invoice) : null;
  }

  async markReminded(businessId: string, invoiceId: string): Promise<void> {
    const invoice = await this.findOne(businessId, invoiceId);
    await this.invoiceModel
      .updateOne({ _id: invoice._id }, { $set: { lastRemindedAt: new Date() } })
      .exec();
  }

  async findOneWithDisplayStatus(businessId: string, invoiceId: string) {
    const invoice = await this.findOne(businessId, invoiceId);
    await invoice.populate('customerId');
    return this.withDisplayStatus(invoice);
  }

  async findAllForBusiness(
    businessId: string,
    filters: { status?: string; search?: string; customerId?: string },
  ) {
    const query: Record<string, unknown> = { businessId: idFilter(businessId) };
    if (filters.customerId) {
      query.customerId = idFilter(filters.customerId);
    }
    if (
      filters.status &&
      filters.status !== 'all' &&
      filters.status !== 'overdue'
    ) {
      query.status = filters.status;
    }

    const invoices = await this.invoiceModel
      .find(query)
      .sort({ invoiceDate: -1 })
      .populate('customerId')
      .exec();

    let withStatus = invoices.map((invoice) => this.withDisplayStatus(invoice));

    if (filters.status === 'overdue') {
      withStatus = withStatus.filter((invoice) => invoice.status === 'overdue');
    }

    if (filters.search) {
      const q = filters.search.trim().toLowerCase();
      withStatus = withStatus.filter((invoice) => {
        const customer = invoice.customerId as unknown as {
          name?: string;
          phone?: string;
        };
        return (
          invoice.invoiceNumber.toLowerCase().includes(q) ||
          customer?.name?.toLowerCase().includes(q) ||
          customer?.phone?.includes(q)
        );
      });
    }

    return withStatus;
  }

  /**
   * One page of invoices, newest first.
   *
   * The unpaged findAllForBusiness above fetches every invoice the business
   * has ever raised and then filters it in JavaScript — both the search and
   * the "overdue" chip. Neither survives paging, so both become part of the
   * query here. It stays for already-installed app versions.
   */
  async findPageForBusiness(
    businessId: string,
    options: {
      status?: string;
      search?: string;
      customerId?: string;
      from?: string;
      to?: string;
      minAmount?: number;
      maxAmount?: number;
      sort?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<
    Page<Invoice & { _id: Types.ObjectId }> & { summary?: ListMoneySummary }
  > {
    const limit = clampLimit(options.limit);
    const cursor = decodePageCursor(options.cursor);

    const customerIds = options.search
      ? await this.customersService.findIdsMatching(
          businessId,
          options.search,
          SEARCH_CUSTOMER_CAP,
        )
      : [];

    const pickedCustomers = splitList(options.customerId);
    const narrowing = [
      pickedCustomers.length ? { customerId: idsFilter(pickedCustomers) } : {},
      this.statusFilter(options.status),
      numberOrCustomerFilter(
        options.search,
        'invoiceNumber',
        customerIds,
        idsFilter,
      ),
      dateRangeFilter('invoiceDate', options.from, options.to),
      amountRangeFilter('total', options.minAmount, options.maxAmount),
    ];
    const sort =
      INVOICE_SORTS[options.sort ?? 'newest'] ?? INVOICE_SORTS.newest;
    const filter = andFilters(
      { businessId: idFilter(businessId) },
      ...narrowing,
      pageCursorFilter(cursor, sort.field, sort.direction),
    );

    // The money behind what the list shows, once per list (first page):
    // "₹84,500 billed · ₹12,300 due". Aggregation does not cast ids, so the
    // business is matched in both stored forms. Run alongside the page and
    // its count rather than after them.
    const [rows, total, summary] = await Promise.all([
      this.invoiceModel
        .find(filter)
        .sort(pageSort(sort.field, sort.direction))
        .limit(limit + 1)
        .populate('customerId', 'name phone')
        .exec(),
      cursor
        ? Promise.resolve(undefined)
        : this.invoiceModel.countDocuments(filter).exec(),
      cursor
        ? Promise.resolve(undefined)
        : this.moneySummary(
            andFilters({ businessId: idFilter(businessId) }, ...narrowing),
          ),
    ]);

    const page = buildPage(
      rows,
      limit,
      (row) => ({
        v: cursorValue(row as unknown as Record<string, unknown>, sort),
        id: (row._id as { toString(): string }).toString(),
      }),
      total,
    );

    // The display status is derived at read time, so it is applied to the
    // page rather than filtered on afterwards — see statusFilter.
    return {
      ...page,
      items: page.items.map((row) => this.withDisplayStatus(row)),
      ...(summary ? { summary } : {}),
    };
  }

  // Drafts are not billed yet and cancelled invoices never will be, so
  // neither counts toward the money — they still count in the list.
  private async moneySummary(
    filter: Record<string, unknown>,
  ): Promise<ListMoneySummary> {
    const [row] = await this.invoiceModel
      .aggregate<{ billed: number; due: number }>([
        { $match: filter },
        { $match: { status: { $nin: ['draft', 'cancelled'] } } },
        {
          $group: {
            _id: null,
            billed: { $sum: '$total' },
            due: { $sum: '$balanceDue' },
          },
        },
      ])
      .exec();
    return { billed: row?.billed ?? 0, due: row?.due ?? 0 };
  }

  // 'overdue' is never stored — it is what an unpaid or part-paid invoice
  // past its due date looks like (computeDisplayStatus). Filtering for it in
  // JavaScript after the fact cannot be paged, so it is spelled out as a
  // query here. The two must agree; if computeDisplayStatus changes, this
  // has to change with it.
  private statusFilter(status?: string): Record<string, unknown> {
    if (!status || status === 'all') return {};
    // Everything with money still owed, late or not — what Home's "Payments
    // to collect" counts. Unpaid and Overdue each show only part of it.
    if (status === 'to_collect') {
      return {
        status: { $in: ['unpaid', 'partially_paid'] },
        balanceDue: { $gt: 0 },
      };
    }
    if (status === 'overdue') {
      return {
        status: { $in: ['unpaid', 'partially_paid'] },
        balanceDue: { $gt: 0 },
        dueDate: { $lt: new Date() },
      };
    }
    // The stored statuses that *would* read as overdue are excluded from
    // their own bucket, so "unpaid" and "overdue" do not both claim the same
    // invoice — which is exactly what the app shows on the two chips.
    // "Unpaid" is everything still owed and not yet late — part-paid
    // included. It used to match the stored 'unpaid' only, so an invoice the
    // customer had paid half of sat in no chip but All: exactly the money
    // someone chasing payments needs to see.
    if (status === 'unpaid' || status === 'partially_paid') {
      return {
        status:
          status === 'unpaid' ? { $in: ['unpaid', 'partially_paid'] } : status,
        $or: [{ balanceDue: { $lte: 0 } }, { dueDate: { $gte: new Date() } }],
      };
    }
    return { status };
  }

  /**
   * Home's "Payments to collect": how many invoices are still owed, the
   * total owed, and the next three by due date.
   *
   * Counted and summed in the database, with only three rows fetched. It used
   * to load every unpaid invoice — whole customer documents populated — just
   * to add up one field and keep three of them.
   */
  async findOutstandingSummary(businessId: string) {
    const match: Record<string, unknown> = {
      businessId: idFilter(businessId),
      status: { $in: ['unpaid', 'partially_paid'] },
    };
    const [totals, upcoming] = await Promise.all([
      this.invoiceModel
        .aggregate<{ count: number; outstandingTotal: number }>([
          { $match: match },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              outstandingTotal: { $sum: { $ifNull: ['$balanceDue', 0] } },
            },
          },
        ])
        .exec(),
      this.invoiceModel
        .find(match)
        .sort({ dueDate: 1, _id: 1 })
        .limit(3)
        .populate('customerId', 'name phone')
        .exec(),
    ]);
    const outstandingTotal = totals[0]?.outstandingTotal ?? 0;

    return {
      count: totals[0]?.count ?? 0,
      outstandingTotal:
        Math.round((outstandingTotal + Number.EPSILON) * 100) / 100,
      upcoming: upcoming.map((invoice) => this.withDisplayStatus(invoice)),
    };
  }

  async update(
    businessId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceDocument> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status === 'cancelled') {
      throw new BadRequestException('Cannot edit a cancelled invoice');
    }
    if (invoice.status === 'paid') {
      throw new BadRequestException(
        'Cannot edit a fully paid invoice. Record a payment adjustment or delete payments first.',
      );
    }

    const customerId = invoice.customerId.toString();
    if (dto.items) {
      invoice.items = (await this.buildItems(
        businessId,
        customerId,
        dto.items,
      )) as any;
    }
    if (dto.invoiceDate) invoice.invoiceDate = new Date(dto.invoiceDate);
    if (dto.dueDate) invoice.dueDate = new Date(dto.dueDate);
    if (dto.notes !== undefined) invoice.notes = dto.notes;
    if (dto.paymentTerms !== undefined) invoice.paymentTerms = dto.paymentTerms;
    if (dto.termsAndConditions !== undefined)
      invoice.termsAndConditions = dto.termsAndConditions;

    const totals = calculateInvoiceTotals(
      invoice.items.map((item) => ({
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
      })),
      dto.discount ?? invoice.discount,
    );
    applyLineTax(invoice.items, totals);
    invoice.subtotal = totals.subtotal;
    invoice.discount = totals.discount;
    invoice.taxTotal = totals.taxTotal;
    invoice.total = totals.total;
    invoice.balanceDue = Math.max(
      0,
      Math.round((totals.total - invoice.amountPaid + Number.EPSILON) * 100) /
        100,
    );

    if (invoice.amountPaid > 0) {
      invoice.status = invoice.balanceDue <= 0 ? 'paid' : 'partially_paid';
    }

    const saved = await invoice.save();
    if (saved.status === 'draft') return saved;

    // A sent invoice whose jobs changed: a job taken off gives its door
    // payment back to the job, and a job added brings its door payment
    // with it, exactly as if the invoice had been sent like this.
    const onInvoice = new Set(
      saved.items
        .map((i) => (i.serviceId ? i.serviceId.toString() : null))
        .filter((id): id is string => !!id),
    );
    const released = await this.releaseJobCollections(
      businessId,
      saved._id,
      onInvoice,
      false,
    );
    const applied = await this.applyJobCollections(businessId, [
      ...onInvoice,
      ...released,
    ]);
    return released.length || applied
      ? this.findOne(businessId, invoiceId)
      : saved;
  }

  async send(businessId: string, invoiceId: string): Promise<InvoiceDocument> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status !== 'draft') {
      throw new BadRequestException('Only draft invoices can be sent');
    }
    if (invoice.items.length === 0) {
      throw new BadRequestException(
        'Add at least one item before sending an invoice',
      );
    }
    // Claimed atomically on the draft status, so two taps on Send cannot
    // both deduct the stock.
    const claimed = await this.invoiceModel
      .findOneAndUpdate(
        { _id: invoice._id, status: 'draft' },
        { $set: { status: 'unpaid' } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException('Only draft invoices can be sent');
    }
    // Sending is the point the goods are billed, so it is where they leave
    // stock (a draft may never be sent, and can be deleted).
    claimed.stockDeductions = await this.deductStock(businessId, claimed.items);
    const sent = await claimed.save();
    // Cash or UPI already taken at the door for these jobs goes on the
    // invoice now, so the customer is not asked to pay it twice.
    const serviceIds = sent.items
      .map((i) => (i.serviceId ? i.serviceId.toString() : null))
      .filter((id): id is string => !!id);
    if (
      serviceIds.length &&
      (await this.applyJobCollections(businessId, serviceIds))
    ) {
      return this.findOne(businessId, invoiceId);
    }
    return sent;
  }

  /**
   * Corrects the payment a door collection put on an invoice — the owner
   * fixing a mistyped amount. Capped like the original at what the invoice
   * could take; zero removes the payment. The invoice's paid / due / status
   * are recomputed in one atomic update, as for a new payment. Returns the
   * amount now applied, or null when the payment was removed.
   */
  async adjustJobPayment(
    businessId: string,
    paymentId: string,
    amount: number,
    method: 'cash' | 'upi',
  ): Promise<number | null> {
    const payment = await this.paymentModel
      .findOne({ _id: paymentId, businessId: idFilter(businessId) })
      .exec();
    if (!payment) return null;
    const invoice = await this.invoiceModel
      .findOne({ _id: payment.invoiceId, businessId: idFilter(businessId) })
      .exec();
    const room = invoice ? invoice.balanceDue + payment.amount : payment.amount;
    const applied = Math.round(Math.max(0, Math.min(amount, room)) * 100) / 100;
    const diff = Math.round((applied - payment.amount) * 100) / 100;

    if (invoice && diff !== 0) {
      await this.shiftAmountPaid(invoice._id, diff);
    }
    if (applied <= 0) {
      await payment.deleteOne();
      return null;
    }
    payment.amount = applied;
    payment.paymentMethod = method;
    await payment.save();
    return applied;
  }

  /**
   * Records money a technician (or the owner) took at the door against the
   * job's open invoice, once per job. Returns whether anything was recorded.
   * Capped at what the invoice still owes; anything over stays on the job.
   */
  async applyJobCollections(
    businessId: string,
    serviceIds: string[],
  ): Promise<boolean> {
    let applied = false;
    for (const serviceId of serviceIds) {
      const invoice = await this.invoiceModel
        .findOne({
          businessId: idFilter(businessId),
          'items.serviceId': idFilter(serviceId),
          status: { $in: ['unpaid', 'partially_paid'] },
          balanceDue: { $gt: 0 },
        })
        .sort({ invoiceDate: -1 })
        .exec();
      if (!invoice) continue;
      const claim = await this.servicesService.claimCollection(
        businessId,
        serviceId,
      );
      if (!claim) continue;
      try {
        const amount = Math.min(claim.amount, invoice.balanceDue);
        const { payment } = await this.recordPayment(
          businessId,
          invoice._id.toString(),
          {
            amount,
            paymentMethod: claim.method,
            paymentDate: claim.collectedAt.toISOString(),
            notes: 'Collected at the job',
          },
        );
        await this.servicesService.finishCollectionClaim(
          serviceId,
          payment._id.toString(),
          amount,
        );
        applied = true;
      } catch (err) {
        await this.servicesService.finishCollectionClaim(serviceId, null);
        throw err;
      }
    }
    return applied;
  }

  async cancel(
    businessId: string,
    invoiceId: string,
  ): Promise<InvoiceDocument> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot cancel a ${invoice.status} invoice`,
      );
    }
    // Atomic, and the deductions are cleared in the same write, so a second
    // cancel racing this one cannot put the stock back twice. The document
    // returned is the one from before the update, holding what to restore.
    const before = await this.invoiceModel
      .findOneAndUpdate(
        { _id: invoice._id, status: { $nin: ['paid', 'cancelled'] } },
        { $set: { status: 'cancelled', stockDeductions: [] } },
        { new: false },
      )
      .exec();
    if (!before) {
      throw new BadRequestException('This invoice can no longer be cancelled');
    }
    await this.restoreStock(businessId, before.stockDeductions);
    // Money taken at the door was the customer's payment for the job, not
    // for this piece of paper: it comes off the cancelled invoice and goes
    // on the job's next one (now, if one is already open), so the
    // replacement invoice does not ask for it again.
    const released = await this.releaseJobCollections(
      businessId,
      invoice._id,
      new Set(),
      true,
    );
    if (released.length) {
      await this.applyJobCollections(businessId, released);
    }
    return this.findOne(businessId, invoiceId);
  }

  /**
   * Takes door payments off this invoice for every job not in `keep`,
   * deleting the payment and freeing the job's collection for its next
   * invoice. Returns the jobs released. A cancelled invoice keeps its
   * status; any other is re-derived from what is still paid.
   */
  private async releaseJobCollections(
    businessId: string,
    invoiceId: Types.ObjectId,
    keep: Set<string>,
    cancelled: boolean,
  ): Promise<string[]> {
    const payments = await this.paymentModel
      .find({
        businessId: idFilter(businessId),
        invoiceId: idFilter(invoiceId.toString()),
      })
      .select('_id amount')
      .lean();
    if (!payments.length) return [];
    const amountOf = new Map(payments.map((p) => [String(p._id), p.amount]));
    const jobs = await this.serviceModel
      .find({
        businessId: idFilter(businessId),
        collectionPaymentId: { $in: [...amountOf.keys()] },
      })
      .select('_id collectionPaymentId')
      .lean();

    const released: string[] = [];
    for (const job of jobs) {
      const serviceId = String(job._id);
      if (keep.has(serviceId)) continue;
      const paymentId = String(job.collectionPaymentId);
      const amount = amountOf.get(paymentId) ?? 0;
      await this.paymentModel.deleteOne({ _id: paymentId }).exec();
      if (cancelled) {
        await this.invoiceModel
          .updateOne({ _id: invoiceId }, { $inc: { amountPaid: -amount } })
          .exec();
      } else {
        await this.shiftAmountPaid(invoiceId, -amount);
      }
      await this.servicesService.releaseCollection(serviceId);
      released.push(serviceId);
    }
    return released;
  }

  async remove(businessId: string, invoiceId: string): Promise<void> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status !== 'draft') {
      throw new ForbiddenException('Only draft invoices can be deleted');
    }
    await invoice.deleteOne();
    // A draft has not moved stock (see send()), so this is normally empty;
    // it is honoured in case one ever did.
    await this.restoreStock(businessId, invoice.stockDeductions);
  }

  async recordPayment(
    businessId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
  ) {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status === 'draft' || invoice.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot record a payment against a ${invoice.status} invoice`,
      );
    }

    const payment = await this.paymentModel.create({
      businessId,
      invoiceId,
      customerId: invoice.customerId,
      amount: dto.amount,
      paymentMethod: dto.paymentMethod,
      paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
      reference: dto.reference,
      notes: dto.notes,
    });

    // Applied by the database in a single atomic update, not read-modify-save.
    // Two payments recorded at the same moment both used to read the same
    // amountPaid and write their own total over it, so one payment was
    // recorded in the payments collection but silently lost from the invoice
    // balance — the customer had paid and the invoice still said they owed it.
    //
    // Each pipeline stage sees the previous stage's output, so balanceDue and
    // status are derived from the amountPaid this very update produced.
    const updated = await this.invoiceModel
      .findOneAndUpdate(
        { _id: invoiceId, businessId: idFilter(businessId) },
        [
          {
            $set: {
              amountPaid: {
                $round: [{ $add: ['$amountPaid', dto.amount] }, 2],
              },
            },
          },
          {
            $set: {
              balanceDue: {
                $max: [
                  0,
                  { $round: [{ $subtract: ['$total', '$amountPaid'] }, 2] },
                ],
              },
            },
          },
          {
            $set: {
              status: {
                $cond: [{ $lte: ['$balanceDue', 0] }, 'paid', 'partially_paid'],
              },
            },
          },
        ],
        // Mongoose 9 refuses an update written as a pipeline (the array
        // above) unless told it is one — without this every payment 500'd
        // after the payment row had already been saved.
        { new: true, updatePipeline: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Invoice not found');
    }

    return { invoice: updated, payment };
  }

  findPaymentsForInvoice(
    businessId: string,
    invoiceId: string,
  ): Promise<PaymentDocument[]> {
    return this.paymentModel
      .find({
        businessId: idFilter(businessId),
        invoiceId: idFilter(invoiceId),
      })
      .sort({ paymentDate: -1 })
      .exec();
  }

  /**
   * The owner correcting a payment recorded with the wrong amount, method or
   * date. Only the difference moves the invoice, in the same single atomic
   * update a new payment uses, so a payment recorded at the same moment is
   * not lost. Overpaying is allowed exactly as recordPayment allows it: the
   * balance stops at zero.
   */
  async updatePayment(
    businessId: string,
    invoiceId: string,
    paymentId: string,
    dto: UpdatePaymentDto,
  ) {
    const { invoice, payment } = await this.findEditablePayment(
      businessId,
      invoiceId,
      paymentId,
    );

    const set: Record<string, unknown> = {};
    if (dto.amount !== undefined) {
      set.amount = Math.round((dto.amount + Number.EPSILON) * 100) / 100;
    }
    if (dto.paymentMethod !== undefined) set.paymentMethod = dto.paymentMethod;
    if (dto.paymentDate !== undefined) {
      set.paymentDate = new Date(dto.paymentDate);
    }
    if (dto.reference !== undefined) set.reference = dto.reference;
    if (dto.notes !== undefined) set.notes = dto.notes;

    // Claimed on the amount it was read with: two corrections racing each
    // other cannot both apply their difference to the invoice.
    const updated = await this.paymentModel
      .findOneAndUpdate(
        { _id: payment._id, amount: payment.amount },
        { $set: set },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'This payment was just changed. Reload the invoice and try again.',
      );
    }

    const diff =
      Math.round((updated.amount - payment.amount + Number.EPSILON) * 100) /
      100;
    const result =
      diff !== 0
        ? await this.shiftAmountPaid(invoice._id, diff)
        : await this.invoiceModel.findById(invoice._id).exec();
    if (!result) {
      throw new NotFoundException('Invoice not found');
    }
    return { invoice: result, payment: updated };
  }

  /** Removes a payment recorded by mistake and takes it off the invoice. */
  async removePayment(
    businessId: string,
    invoiceId: string,
    paymentId: string,
  ) {
    const { invoice, payment } = await this.findEditablePayment(
      businessId,
      invoiceId,
      paymentId,
    );
    // The deleted row is what is subtracted — a second delete racing this
    // one finds nothing, so the amount cannot come off the invoice twice.
    const removed = await this.paymentModel
      .findOneAndDelete({ _id: payment._id })
      .exec();
    if (!removed) {
      throw new NotFoundException('Payment not found');
    }
    const result = await this.shiftAmountPaid(invoice._id, -removed.amount);
    if (!result) {
      throw new NotFoundException('Invoice not found');
    }
    return { invoice: result };
  }

  // A payment of this business, on this invoice, that the owner may change
  // from the invoice screen.
  private async findEditablePayment(
    businessId: string,
    invoiceId: string,
    paymentId: string,
  ) {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status === 'cancelled') {
      throw new BadRequestException(
        'Cannot change a payment on a cancelled invoice',
      );
    }
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel
      .findOne({
        _id: paymentId,
        businessId: idFilter(businessId),
        invoiceId: idFilter(invoiceId),
      })
      .exec();
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    // Money taken at the door belongs to the job: the job also carries the
    // amount (and, for cash, the technician's hand-over). Changing it here
    // would leave the job saying one thing and the invoice another — the
    // job's own correction moves both together.
    const fromJob = await this.serviceModel
      .exists({
        businessId: idFilter(businessId),
        collectionPaymentId: payment._id.toString(),
      })
      .exec();
    if (fromJob) {
      throw new BadRequestException(
        'Change this on the job — it was collected at the visit.',
      );
    }
    return { invoice, payment };
  }

  /**
   * Moves an invoice's amountPaid by `diff` (negative to take money off) and
   * re-derives balanceDue and status, in one atomic update. Never below zero
   * paid; back to 'unpaid' when nothing is paid any more. 'overdue' is not
   * stored — it is derived at read time from the due date.
   */
  private shiftAmountPaid(invoiceId: Types.ObjectId, diff: number) {
    return this.invoiceModel
      .findOneAndUpdate(
        { _id: invoiceId },
        [
          {
            $set: {
              amountPaid: {
                $round: [{ $max: [0, { $add: ['$amountPaid', diff] }] }, 2],
              },
            },
          },
          {
            $set: {
              balanceDue: {
                $max: [
                  0,
                  { $round: [{ $subtract: ['$total', '$amountPaid'] }, 2] },
                ],
              },
            },
          },
          {
            $set: {
              status: {
                $cond: [
                  { $lte: ['$balanceDue', 0] },
                  'paid',
                  {
                    $cond: [
                      { $gt: ['$amountPaid', 0] },
                      'partially_paid',
                      'unpaid',
                    ],
                  },
                ],
              },
            },
          },
        ],
        { new: true, updatePipeline: true },
      )
      .exec();
  }
}

export interface ListMoneySummary {
  billed: number;
  due: number;
}

// The Filters sheet's sort choices. "dueDate" is oldest due date first —
// the longest-waiting money at the top.
const INVOICE_SORTS: Record<string, SortSpec> = {
  newest: { field: 'invoiceDate', direction: 'desc', keyType: 'date' },
  oldest: { field: 'invoiceDate', direction: 'asc', keyType: 'date' },
  amount: { field: 'total', direction: 'desc', keyType: 'number' },
  dueDate: { field: 'dueDate', direction: 'asc', keyType: 'date' },
};
