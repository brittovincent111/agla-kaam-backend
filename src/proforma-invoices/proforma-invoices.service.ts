import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProformaInvoice, ProformaInvoiceDocument } from './schemas/proforma-invoice.schema';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { BusinessesService } from '../businesses/businesses.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { calculateInvoiceTotals } from '../common/constants/invoice-options';
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
import { CustomersService } from '../customers/customers.service';

@Injectable()
export class ProformaInvoicesService {
  constructor(
    @InjectModel(ProformaInvoice.name)
    private readonly proformaModel: Model<ProformaInvoiceDocument>,
    private readonly businessesService: BusinessesService,
    private readonly invoicingService: InvoicingService,
    private readonly customersService: CustomersService,
  ) {}

  async create(businessId: string, dto: CreateProformaInvoiceDto): Promise<ProformaInvoiceDocument> {
    const business = await this.businessesService.findById(businessId);
    const prefix = business?.proformaPrefix || 'PI-';
    const serial = business?.proformaNextSerial || (await this.proformaModel.countDocuments({ businessId: new Types.ObjectId(businessId) })) + 1;

    const proformaNumber = `${prefix}${new Date().getFullYear()}-${String(serial).padStart(3, '0')}`;

    // Auto-increment serial counter on Business
    await this.businessesService.update(businessId, { proformaNextSerial: serial + 1 });

    const discount = dto.discount || 0;
    const totals = calculateInvoiceTotals(dto.items, discount);

    const items = dto.items.map((item) => {
      const lineSubtotal = item.quantity * item.rate;
      const taxRate = item.taxRate || 0;
      const taxAmount = lineSubtotal * (taxRate / 100);
      const amount = lineSubtotal + taxAmount;
      return {
        serviceId: item.serviceId ? new Types.ObjectId(item.serviceId) : undefined,
        name: item.name.trim(),
        description: item.description?.trim(),
        hsnCode: item.hsnCode?.trim().toUpperCase(),
        quantity: item.quantity,
        rate: item.rate,
        taxRate,
        taxAmount,
        amount,
      };
    });

    const proforma = new this.proformaModel({
      businessId: new Types.ObjectId(businessId),
      customerId: new Types.ObjectId(dto.customerId),
      proformaNumber,
      proformaDate: new Date(dto.proformaDate),
      validUntil: new Date(dto.validUntil),
      status: 'draft',
      currency: business?.currency || 'INR',
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: dto.notes?.trim(),
      paymentTerms: dto.paymentTerms?.trim(),
      termsAndConditions: dto.termsAndConditions?.trim(),
    });

    return proforma.save();
  }

  /**
   * One page of proforma invoices, newest first.
   *
   * The unpaged findAll below returns every one the business has ever
   * raised, and the app then searched them on the device. Both the paging
   * and the search now happen in the query.
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
  ): Promise<Page<ProformaInvoiceDocument>> {
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
      // Stored as an ObjectId here, unlike the string-keyed collections —
      // idFilter matches either form.
      { businessId: idFilter(businessId) },
      options.customerId ? { customerId: idFilter(options.customerId) } : {},
      options.status && options.status !== 'all' ? { status: options.status } : {},
      numberOrCustomerFilter(options.search, 'proformaNumber', customerIds, idsFilter),
      pageCursorFilter(cursor, 'createdAt', 'desc'),
    );

    const [rows, total] = await Promise.all([
      this.proformaModel
        .find(filter)
        .sort(pageSort('createdAt', 'desc'))
        .limit(limit + 1)
        .populate('customerId', 'name phone')
        .exec(),
      cursor ? Promise.resolve(undefined) : this.proformaModel.countDocuments(filter).exec(),
    ]);

    return buildPage(rows, limit, (row) => ({
      v: (row as unknown as { createdAt: Date }).createdAt.toISOString(),
      id: (row._id as { toString(): string }).toString(),
    }), total);
  }

  async findAll(businessId: string): Promise<ProformaInvoiceDocument[]> {
    return this.proformaModel
      .find({ businessId: new Types.ObjectId(businessId) })
      .populate('customerId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(businessId: string, id: string): Promise<ProformaInvoiceDocument> {
    const doc = await this.proformaModel
      .findOne({ _id: new Types.ObjectId(id), businessId: new Types.ObjectId(businessId) })
      .populate('customerId')
      .exec();

    if (!doc) throw new NotFoundException('Proforma Invoice not found');
    return doc;
  }

  async update(businessId: string, id: string, dto: UpdateProformaInvoiceDto): Promise<ProformaInvoiceDocument> {
    const existing = await this.findOne(businessId, id);
    if (existing.status === 'converted') {
      throw new BadRequestException('Cannot edit a converted Proforma Invoice');
    }

    let items = existing.items;
    let totals = {
      subtotal: existing.subtotal,
      discount: dto.discount !== undefined ? dto.discount : existing.discount,
      taxTotal: existing.taxTotal,
      total: existing.total,
    };

    if (dto.items) {
      totals = calculateInvoiceTotals(dto.items, totals.discount);
      items = dto.items.map((item) => {
        const lineSubtotal = item.quantity * item.rate;
        const taxRate = item.taxRate || 0;
        const taxAmount = lineSubtotal * (taxRate / 100);
        const amount = lineSubtotal + taxAmount;
        return {
          serviceId: item.serviceId ? new Types.ObjectId(item.serviceId) : undefined,
          name: item.name.trim(),
          description: item.description?.trim(),
          hsnCode: item.hsnCode?.trim().toUpperCase(),
          quantity: item.quantity,
          rate: item.rate,
          taxRate,
          taxAmount,
          amount,
        } as any;
      });
    }

    const updated = await this.proformaModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), businessId: new Types.ObjectId(businessId) },
        {
          $set: {
            proformaDate: dto.proformaDate ? new Date(dto.proformaDate) : existing.proformaDate,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : existing.validUntil,
            items,
            subtotal: totals.subtotal,
            discount: totals.discount,
            taxTotal: totals.taxTotal,
            total: totals.total,
            notes: dto.notes !== undefined ? dto.notes?.trim() : existing.notes,
            paymentTerms: dto.paymentTerms !== undefined ? dto.paymentTerms?.trim() : existing.paymentTerms,
            termsAndConditions: dto.termsAndConditions !== undefined ? dto.termsAndConditions?.trim() : existing.termsAndConditions,
          },
        },
        { new: true },
      )
      .populate('customerId')
      .exec();

    if (!updated) throw new NotFoundException('Proforma Invoice not found');
    return updated;
  }

  async delete(businessId: string, id: string): Promise<void> {
    const res = await this.proformaModel.deleteOne({
      _id: new Types.ObjectId(id),
      businessId: new Types.ObjectId(businessId),
    });
    if (res.deletedCount === 0) throw new NotFoundException('Proforma Invoice not found');
  }

  async convertToTaxInvoice(businessId: string, id: string): Promise<any> {
    const proforma = await this.findOne(businessId, id);
    if (proforma.status === 'converted') {
      throw new BadRequestException('This Proforma Invoice has already been converted');
    }

    const customerIdStr = (proforma.customerId as any)?._id?.toString() || proforma.customerId.toString();

    // Create final Tax Invoice using InvoicingService
    const invoice = await this.invoicingService.create(businessId, {
      customerId: customerIdStr,
      invoiceDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      paymentTerms: proforma.paymentTerms,
      notes: proforma.notes ? `Converted from ${proforma.proformaNumber}. ${proforma.notes}` : `Converted from ${proforma.proformaNumber}`,
      termsAndConditions: proforma.termsAndConditions,
      discount: proforma.discount,
      items: proforma.items.map((i) => ({
        serviceId: (i.serviceId as any)?._id?.toString() || i.serviceId?.toString(),
        name: i.name,
        description: i.description,
        quantity: i.quantity,
        rate: i.rate,
        taxRate: i.taxRate,
      })),
    });

    proforma.status = 'converted';
    proforma.convertedInvoiceId = new Types.ObjectId((invoice as any)._id);
    proforma.convertedAt = new Date();
    await proforma.save();

    return invoice;
  }
}
