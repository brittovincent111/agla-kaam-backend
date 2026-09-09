import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Quotation, QuotationDocument } from './schemas/quotation.schema';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { CustomersService } from '../customers/customers.service';
import { ServicesService } from '../services/services.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { BusinessesService } from '../businesses/businesses.service';
import { InvoiceDocument } from '../invoicing/schemas/invoice.schema';
import {
  applyLineTax,
  calculateInvoiceTotals,
} from '../common/constants/invoice-options';
import { FREE_TIER_QUOTATION_LIMIT, tierHasInvoicing } from '../common/constants/subscription-options';
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

const DEFAULT_VALIDITY_DAYS = 15;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

@Injectable()
export class QuotationsService {
  constructor(
    @InjectModel(Quotation.name) private readonly quotationModel: Model<QuotationDocument>,
    private readonly customersService: CustomersService,
    private readonly servicesService: ServicesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly invoicingService: InvoicingService,
    private readonly businessesService: BusinessesService,
  ) {}

  private async nextQuotationNumber(businessId: string): Promise<string> {
    const business = await this.businessesService.findById(businessId);
    const prefix = business?.quotationPrefix || 'QT-';
    // Atomic — see BusinessesService.allocateSerial.
    const serial = await this.businessesService.allocateSerial(
      businessId,
      'quotationNextSerial',
      async () =>
        (await this.quotationModel.countDocuments({ businessId }).exec()) + 1,
    );
    return `${prefix}${new Date().getFullYear()}-${String(serial).padStart(3, '0')}`;
  }

  private async buildItems(businessId: string, customerId: string, dtoItems: CreateQuotationDto['items']) {
    return Promise.all(
      dtoItems.map(async (item) => {
        if (item.serviceId) {
          // Confirms the referenced service actually belongs to this
          // business/customer before it can be quoted.
          const service = await this.servicesService.findOne(businessId, item.serviceId);
          if (service.customerId.toString() !== customerId) {
            throw new BadRequestException('Service does not belong to the selected customer');
          }
        }
        const taxRate = item.taxRate ?? 0;
        const amount = Math.round((item.quantity * item.rate + Number.EPSILON) * 100) / 100;
        // Placeholder only. The real per-line tax depends on this line's share
        // of the invoice-level discount, which is not known until every line
        // is priced — applyLineTax() below overwrites it from
        // calculateInvoiceTotals().
        const taxAmount = 0;
        return {
          serviceId: item.serviceId,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          rate: item.rate,
          taxRate,
          amount,
          taxAmount,
        };
      }),
    );
  }

  async create(businessId: string, dto: CreateQuotationDto): Promise<QuotationDocument> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    if (!tierHasInvoicing(tier)) {
      const count = await this.quotationModel
        .countDocuments({ businessId, status: { $ne: 'rejected' } })
        .exec();
      if (count >= FREE_TIER_QUOTATION_LIMIT) {
        throw new ForbiddenException(
          `Free plan is limited to ${FREE_TIER_QUOTATION_LIMIT} quotations. Upgrade to the Invoicing or Combo plan for unlimited quotations.`,
        );
      }
    }

    await this.customersService.findOne(businessId, dto.customerId);

    // Snapshotted onto the quotation below — same reasoning as Invoice's
    // currency/taxType — so it keeps showing what was actually quoted even
    // if the business's currency/tax setup changes later.
    const business = await this.businessesService.findById(businessId);

    const items = await this.buildItems(businessId, dto.customerId, dto.items);
    const totals = calculateInvoiceTotals(items, dto.discount ?? 0);
    applyLineTax(items, totals);
    const quotationDate = dto.quotationDate ? new Date(dto.quotationDate) : new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : addDays(quotationDate, DEFAULT_VALIDITY_DAYS);
    const quotationNumber = await this.nextQuotationNumber(businessId);

    return this.quotationModel.create({
      businessId,
      customerId: dto.customerId,
      quotationNumber,
      quotationDate,
      validUntil,
      status: 'draft',
      currency: business.currency || 'INR',
      taxType: business.taxType || 'gst',
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: dto.notes,
      termsAndConditions: dto.termsAndConditions,
    });
  }

  async findOne(businessId: string, quotationId: string): Promise<QuotationDocument> {
    if (!Types.ObjectId.isValid(quotationId)) {
      throw new NotFoundException('Quotation not found');
    }
    const quotation = await this.quotationModel.findById(quotationId).exec();
    if (!quotation || quotation.businessId.toString() !== businessId) {
      throw new NotFoundException('Quotation not found');
    }
    return quotation;
  }

  async findOnePopulated(businessId: string, quotationId: string): Promise<QuotationDocument> {
    const quotation = await this.findOne(businessId, quotationId);
    await quotation.populate('customerId');
    return quotation;
  }

  /**
   * One page of quotations, newest first.
   *
   * The unpaged read below fetches every quotation and then filters the
   * search in JavaScript, which cannot survive paging — so the search runs
   * as part of the query here, still reaching the customer's name and phone
   * via a bounded id lookup.
   */
  async findPageForBusiness(
    businessId: string,
    options: {
      status?: string;
      search?: string;
      customerId?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<Page<QuotationDocument>> {
    const limit = clampLimit(options.limit);
    const cursor = decodePageCursor(options.cursor);

    const customerIds = options.search
      ? await this.customersService.findIdsMatching(
          businessId,
          options.search,
          SEARCH_CUSTOMER_CAP,
        )
      : [];

    const filter = andFilters(
      { businessId },
      options.customerId ? { customerId: idFilter(options.customerId) } : {},
      options.status && options.status !== 'all' ? { status: options.status } : {},
      numberOrCustomerFilter(options.search, 'quotationNumber', customerIds, idsFilter),
      pageCursorFilter(cursor, 'quotationDate', 'desc'),
    );

    const [rows, total] = await Promise.all([
      this.quotationModel
        .find(filter)
        .sort(pageSort('quotationDate', 'desc'))
        .limit(limit + 1)
        .populate('customerId', 'name phone')
        .exec(),
      cursor ? Promise.resolve(undefined) : this.quotationModel.countDocuments(filter).exec(),
    ]);

    return buildPage(rows, limit, (row) => ({
      v: row.quotationDate.toISOString(),
      id: (row._id as { toString(): string }).toString(),
    }), total);
  }

  async findAllForBusiness(
    businessId: string,
    filters: { status?: string; search?: string; customerId?: string },
  ) {
    const query: Record<string, unknown> = { businessId };
    if (filters.customerId) {
      query.customerId = filters.customerId;
    }
    if (filters.status && filters.status !== 'all') {
      query.status = filters.status;
    }

    const quotations = await this.quotationModel
      .find(query)
      .sort({ quotationDate: -1 })
      .populate('customerId')
      .exec();

    if (!filters.search) {
      return quotations;
    }

    const q = filters.search.trim().toLowerCase();
    return quotations.filter((quotation) => {
      const customer = quotation.customerId as unknown as { name?: string; phone?: string };
      return (
        quotation.quotationNumber.toLowerCase().includes(q) ||
        customer?.name?.toLowerCase().includes(q) ||
        customer?.phone?.includes(q)
      );
    });
  }

  async update(businessId: string, quotationId: string, dto: UpdateQuotationDto): Promise<QuotationDocument> {
    const quotation = await this.findOne(businessId, quotationId);
    if (quotation.status !== 'draft' && quotation.status !== 'sent') {
      throw new BadRequestException('Only draft or sent quotations can be edited');
    }

    const customerId = quotation.customerId.toString();
    if (dto.items) {
      quotation.items = (await this.buildItems(businessId, customerId, dto.items)) as any;
    }
    if (dto.quotationDate) quotation.quotationDate = new Date(dto.quotationDate);
    if (dto.validUntil) quotation.validUntil = new Date(dto.validUntil);
    if (dto.notes !== undefined) quotation.notes = dto.notes;
    if (dto.termsAndConditions !== undefined) quotation.termsAndConditions = dto.termsAndConditions;
    if (dto.status) quotation.status = dto.status;

    const totals = calculateInvoiceTotals(
      quotation.items.map((item) => ({ quantity: item.quantity, rate: item.rate, taxRate: item.taxRate })),
      dto.discount ?? quotation.discount,
    );
    quotation.subtotal = totals.subtotal;
    quotation.discount = totals.discount;
    quotation.taxTotal = totals.taxTotal;
    quotation.total = totals.total;

    return quotation.save();
  }

  async send(businessId: string, quotationId: string): Promise<QuotationDocument> {
    const quotation = await this.findOne(businessId, quotationId);
    if (quotation.status !== 'draft') {
      throw new BadRequestException('Only draft quotations can be sent');
    }
    if (quotation.items.length === 0) {
      throw new BadRequestException('Add at least one item before sending a quotation');
    }
    quotation.status = 'sent';
    return quotation.save();
  }

  async cancel(businessId: string, quotationId: string): Promise<QuotationDocument> {
    const quotation = await this.findOne(businessId, quotationId);
    if (quotation.status !== 'draft' && quotation.status !== 'sent') {
      throw new BadRequestException(`Cannot cancel a ${quotation.status} quotation`);
    }
    quotation.status = 'rejected';
    return quotation.save();
  }

  async remove(businessId: string, quotationId: string): Promise<void> {
    const quotation = await this.findOne(businessId, quotationId);
    if (quotation.status !== 'draft') {
      throw new ForbiddenException('Only draft quotations can be deleted');
    }
    await quotation.deleteOne();
  }

  async convertToInvoice(
    businessId: string,
    quotationId: string,
  ): Promise<{ quotation: QuotationDocument; invoice: InvoiceDocument }> {
    const quotation = await this.findOne(businessId, quotationId);
    if (quotation.status === 'converted') {
      throw new BadRequestException('This quotation has already been converted to an invoice');
    }
    if (quotation.status === 'rejected') {
      throw new BadRequestException('A rejected quotation cannot be converted to an invoice');
    }

    // Goes through InvoicingService.create() so the conversion is subject to
    // the exact same free/paid invoice-creation gate as a normal invoice —
    // it is, after all, creating a real invoice.
    const invoice = await this.invoicingService.create(businessId, {
      customerId: quotation.customerId.toString(),
      notes: quotation.notes,
      discount: quotation.discount,
      items: quotation.items.map((item) => ({
        serviceId: item.serviceId?.toString(),
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
      })),
    });

    // invoicingService.create() stamps the invoice with the business's
    // *current* currency/taxType — but this quotation may have been quoted
    // under different settings (they're editable any time). The invoice
    // must honor what was actually quoted, not silently switch.
    if (invoice.currency !== quotation.currency || invoice.taxType !== quotation.taxType) {
      invoice.currency = quotation.currency;
      invoice.taxType = quotation.taxType;
      await invoice.save();
    }

    quotation.status = 'converted';
    quotation.convertedInvoiceId = invoice._id as Types.ObjectId;
    quotation.convertedAt = new Date();
    await quotation.save();

    return { quotation, invoice };
  }
}
