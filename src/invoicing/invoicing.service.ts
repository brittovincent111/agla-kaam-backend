import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { CustomersService } from '../customers/customers.service';
import { ServicesService } from '../services/services.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { calculateInvoiceTotals, computeDisplayStatus } from '../common/constants/invoice-options';
import { FREE_TIER_INVOICE_LIMIT, tierHasInvoicing } from '../common/constants/subscription-options';

const DEFAULT_PAYMENT_TERM_DAYS = 7;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

@Injectable()
export class InvoicingService {
  constructor(
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    private readonly customersService: CustomersService,
    private readonly servicesService: ServicesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private withDisplayStatus(invoice: InvoiceDocument): Invoice & { _id: Types.ObjectId } {
    const plain = invoice.toObject();
    return {
      ...plain,
      status: computeDisplayStatus(plain.status, plain.dueDate, plain.balanceDue),
    };
  }

  private async nextInvoiceNumber(businessId: string): Promise<string> {
    const count = await this.invoiceModel.countDocuments({ businessId }).exec();
    return `INV-${String(count + 1).padStart(4, '0')}`;
  }

  private async buildItems(businessId: string, customerId: string, dtoItems: CreateInvoiceDto['items']) {
    return Promise.all(
      dtoItems.map(async (item) => {
        if (item.serviceId) {
          // Confirms the referenced service actually belongs to this
          // business/customer before it can be billed.
          const service = await this.servicesService.findOne(businessId, item.serviceId);
          if (service.customerId.toString() !== customerId) {
            throw new BadRequestException('Service does not belong to the selected customer');
          }
        }
        const taxRate = item.taxRate ?? 0;
        const amount = Math.round((item.quantity * item.rate + Number.EPSILON) * 100) / 100;
        const taxAmount = Math.round((amount * (taxRate / 100) + Number.EPSILON) * 100) / 100;
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

  async create(businessId: string, dto: CreateInvoiceDto): Promise<InvoiceDocument> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    if (!tierHasInvoicing(tier)) {
      const count = await this.invoiceModel
        .countDocuments({ businessId, status: { $ne: 'cancelled' } })
        .exec();
      if (count >= FREE_TIER_INVOICE_LIMIT) {
        throw new ForbiddenException(
          `Free plan is limited to ${FREE_TIER_INVOICE_LIMIT} invoices. Upgrade to the Invoicing or Combo plan for unlimited invoices.`,
        );
      }
    }

    await this.customersService.findOne(businessId, dto.customerId);

    const items = await this.buildItems(businessId, dto.customerId, dto.items);
    const totals = calculateInvoiceTotals(items, dto.discount ?? 0);
    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : addDays(invoiceDate, DEFAULT_PAYMENT_TERM_DAYS);
    const invoiceNumber = await this.nextInvoiceNumber(businessId);

    return this.invoiceModel.create({
      businessId,
      customerId: dto.customerId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      status: 'draft',
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
    });
  }

  async findOne(businessId: string, invoiceId: string): Promise<InvoiceDocument> {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new NotFoundException('Invoice not found');
    }
    const invoice = await this.invoiceModel.findById(invoiceId).exec();
    if (!invoice || invoice.businessId.toString() !== businessId) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
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
    const query: Record<string, unknown> = { businessId };
    if (filters.customerId) {
      query.customerId = filters.customerId;
    }
    if (filters.status && filters.status !== 'all' && filters.status !== 'overdue') {
      query.status = filters.status;
    }

    let invoices = await this.invoiceModel
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
        const customer = invoice.customerId as unknown as { name?: string; phone?: string };
        return (
          invoice.invoiceNumber.toLowerCase().includes(q) ||
          customer?.name?.toLowerCase().includes(q) ||
          customer?.phone?.includes(q)
        );
      });
    }

    return withStatus;
  }

  async findOutstandingSummary(businessId: string) {
    const invoices = await this.invoiceModel
      .find({ businessId, status: { $in: ['unpaid', 'partially_paid'] } })
      .sort({ dueDate: 1 })
      .populate('customerId')
      .exec();

    const withStatus = invoices.map((invoice) => this.withDisplayStatus(invoice));
    const outstandingTotal = withStatus.reduce((sum, invoice) => sum + invoice.balanceDue, 0);

    return {
      count: withStatus.length,
      outstandingTotal: Math.round((outstandingTotal + Number.EPSILON) * 100) / 100,
      upcoming: withStatus.slice(0, 3),
    };
  }

  async update(businessId: string, invoiceId: string, dto: UpdateInvoiceDto): Promise<InvoiceDocument> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status !== 'draft') {
      throw new BadRequestException('Only draft invoices can be edited');
    }

    const customerId = invoice.customerId.toString();
    if (dto.items) {
      invoice.items = (await this.buildItems(businessId, customerId, dto.items)) as any;
    }
    if (dto.invoiceDate) invoice.invoiceDate = new Date(dto.invoiceDate);
    if (dto.dueDate) invoice.dueDate = new Date(dto.dueDate);
    if (dto.notes !== undefined) invoice.notes = dto.notes;
    if (dto.paymentTerms !== undefined) invoice.paymentTerms = dto.paymentTerms;
    if (dto.termsAndConditions !== undefined) invoice.termsAndConditions = dto.termsAndConditions;

    const totals = calculateInvoiceTotals(
      invoice.items.map((item) => ({ quantity: item.quantity, rate: item.rate, taxRate: item.taxRate })),
      dto.discount ?? invoice.discount,
    );
    invoice.subtotal = totals.subtotal;
    invoice.discount = totals.discount;
    invoice.taxTotal = totals.taxTotal;
    invoice.total = totals.total;
    invoice.balanceDue = Math.max(0, totals.total - invoice.amountPaid);

    return invoice.save();
  }

  async send(businessId: string, invoiceId: string): Promise<InvoiceDocument> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status !== 'draft') {
      throw new BadRequestException('Only draft invoices can be sent');
    }
    if (invoice.items.length === 0) {
      throw new BadRequestException('Add at least one item before sending an invoice');
    }
    invoice.status = 'unpaid';
    return invoice.save();
  }

  async cancel(businessId: string, invoiceId: string): Promise<InvoiceDocument> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      throw new BadRequestException(`Cannot cancel a ${invoice.status} invoice`);
    }
    invoice.status = 'cancelled';
    return invoice.save();
  }

  async remove(businessId: string, invoiceId: string): Promise<void> {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status !== 'draft') {
      throw new ForbiddenException('Only draft invoices can be deleted');
    }
    await invoice.deleteOne();
  }

  async recordPayment(businessId: string, invoiceId: string, dto: RecordPaymentDto) {
    const invoice = await this.findOne(businessId, invoiceId);
    if (invoice.status === 'draft' || invoice.status === 'cancelled') {
      throw new BadRequestException(`Cannot record a payment against a ${invoice.status} invoice`);
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

    invoice.amountPaid = Math.round((invoice.amountPaid + dto.amount + Number.EPSILON) * 100) / 100;
    invoice.balanceDue = Math.max(0, Math.round((invoice.total - invoice.amountPaid + Number.EPSILON) * 100) / 100);
    invoice.status = invoice.balanceDue <= 0 ? 'paid' : 'partially_paid';
    await invoice.save();

    return { invoice, payment };
  }

  findPaymentsForInvoice(businessId: string, invoiceId: string): Promise<PaymentDocument[]> {
    return this.paymentModel.find({ businessId, invoiceId }).sort({ paymentDate: -1 }).exec();
  }
}
