import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as QRCode from 'qrcode';
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { ServicesService } from '../services/services.service';
import { Invoice } from './schemas/invoice.schema';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import {
  DocumentTemplateId,
  resolveDocumentTheme,
} from '../common/pdf/document-templates';
import {
  A4,
  DocumentSpec,
  PageGeometry,
  RenderBusiness,
  RenderCustomer,
  RenderServiceContext,
  RenderStatus,
  RenderTotalRow,
  buildTaxRows,
  formatDate,
  taxTypeName,
} from '../common/pdf/document-render';
import { renderDocument } from '../common/pdf/render-document';
import { PAYMENT_METHOD_LABELS } from '../common/constants/invoice-options';

// All drawing lives in common/pdf — this service's only job is to describe an
// invoice as a DocumentSpec. Everything that differs from a quotation (the
// masthead word, 'BILL TO', the due-date row, the paid and balance-due
// totals) is stated here, once, as data.
//
// Every figure comes straight off the stored invoice. Templates never
// recompute a subtotal, tax, discount or balance — they only present them.

const STATUS_LABELS: Record<string, RenderStatus> = {
  draft: { label: 'DRAFT', tone: 'neutral' },
  unpaid: { label: 'UNPAID', tone: 'urgent' },
  partially_paid: { label: 'PART PAID', tone: 'urgent' },
  paid: { label: 'PAID', tone: 'positive' },
  overdue: { label: 'OVERDUE', tone: 'danger' },
  cancelled: { label: 'CANCELLED', tone: 'neutral' },
};

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
    private readonly servicesService: ServicesService,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  async generate(
    businessId: string,
    invoice: Invoice & { _id: unknown },
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    // invoice.customerId may already be a populated Customer object (the
    // detail-view fetch populates it) — resolve to a plain id either way.
    const rawCustomerId = invoice.customerId as unknown;
    const customerId =
      typeof rawCustomerId === 'object' && rawCustomerId !== null
        ? ((rawCustomerId as { _id?: unknown })._id ?? rawCustomerId).toString()
        : String(rawCustomerId);

    const [business, customer, serviceContext, payment] = await Promise.all([
      this.businessesService.findByIdWithBranding(businessId),
      this.customersService.findOne(businessId, customerId),
      this.resolveServiceContext(businessId, invoice),
      this.resolvePaymentSummary(businessId, invoice),
    ]);

    let paymentQrBuffer: Buffer | undefined;
    const qrText =
      business.paymentQrContent ||
      (business.paymentUpiId
        ? `upi://pay?pa=${business.paymentUpiId}&pn=${encodeURIComponent(business.name)}`
        : undefined);
    if (qrText) {
      try {
        paymentQrBuffer = await QRCode.toBuffer(qrText, { margin: 1, width: 200 });
      } catch {
        // Fallback silently if QR encoding fails
      }
    }

    return this.render(
      { ...business, paymentQrBuffer },
      customer,
      invoice,
      templateId,
      accentColor,
      {
        serviceContext,
        payment,
        geometry,
      },
    );
  }

  // The Compact layout shows who did the work and when the next visit is due.
  // That is real data — it comes from the Service records this invoice's line
  // items were raised against — so it is looked up rather than invented, and
  // simply absent on an invoice with no linked service.
  private async resolveServiceContext(
    businessId: string,
    invoice: Invoice,
  ): Promise<RenderServiceContext | undefined> {
    const serviceIds = (invoice.items ?? [])
      .map((item) => item.serviceId)
      .filter(Boolean)
      .map((id) => id!.toString());
    if (!serviceIds.length) return undefined;

    const services = await Promise.all(
      [...new Set(serviceIds)].map((id) =>
        this.servicesService.findOne(businessId, id).catch(() => null),
      ),
    );
    const resolved = services.filter(Boolean);
    if (!resolved.length) return undefined;

    // Most recent visit wins when an invoice bundles several.
    const latest = resolved.sort(
      (a, b) => b!.serviceDate.getTime() - a!.serviceDate.getTime(),
    )[0]!;

    const technician = latest.assignedTechnicianId as unknown as
      | { name?: string }
      | undefined;

    return {
      technicianName: technician?.name,
      serviceDate: latest.serviceDate,
      nextServiceDate: latest.nextServiceDate,
      // Short, stable, and derived — not a new stored identifier.
      jobReference: `#${(latest._id as Types.ObjectId).toString().slice(-6).toUpperCase()}`,
      serviceNotes: latest.notes,
    };
  }

  private async resolvePaymentSummary(businessId: string, invoice: Invoice) {
    const invoiceId = (invoice as unknown as { _id?: unknown })._id;
    if (!invoiceId) return undefined;
    const payments = await this.paymentModel
      .find({ businessId, invoiceId })
      .sort({ paymentDate: -1 })
      .limit(1)
      .exec();
    if (!payments.length) return undefined;
    return { method: PAYMENT_METHOD_LABELS[payments[0].paymentMethod] };
  }

  // Split out from generate() so preview rendering (fixed sample data, no
  // customer lookup) can share the same drawing code.
  render(
    business: RenderBusiness,
    customer: RenderCustomer,
    invoice: Invoice,
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    extras: {
      serviceContext?: RenderServiceContext;
      payment?: { method?: string };
      geometry?: PageGeometry;
    } = {},
  ): Promise<Buffer> {
    const theme = resolveDocumentTheme(templateId, accentColor);

    // The invoice's own stored currency/taxType win over the business's
    // *current* settings — this invoice was created under whatever the
    // business's settings were at the time (see InvoicingService.create), and
    // must keep showing that even if the business later changes them.
    // Resolved once here, so there is exactly one place this is decided.
    const currency = invoice.currency || business.currency || 'INR';
    const taxType = invoice.taxType || business.taxType || 'gst';
    const country = business.country || 'IN';

    // The number is NOT a meta row: layouts that headline it would otherwise
    // print it twice. They add it via metaRowsWithNumber() when they want it
    // inside the metadata block instead.
    const metaRows = [
      { label: 'Date', value: formatDate(invoice.invoiceDate, country) },
      { label: 'Due Date', value: formatDate(invoice.dueDate, country) },
    ];

    const totals: RenderTotalRow[] = [{ label: 'Subtotal', value: invoice.subtotal }];
    if (invoice.discount > 0) {
      totals.push({ label: 'Discount', value: invoice.discount, negative: true });
    }
    totals.push(...buildTaxRows(taxType, invoice.taxTotal, invoice.items));
    totals.push({
      label: 'Total',
      value: invoice.total,
      style: 'grand',
      color: 'primary',
      ruleAbove: true,
    });
    // Only shown once something has actually been paid — an untouched invoice
    // does not need a "Paid 0.00 / Balance = Total" restatement.
    if (invoice.amountPaid > 0) {
      totals.push({ label: 'Amount paid', value: invoice.amountPaid, negative: true });
      totals.push({
        label: 'Balance due',
        value: invoice.balanceDue,
        style: 'strong',
        color: invoice.balanceDue > 0 ? 'danger' : 'success',
      });
    }

    const paidLabel =
      invoice.amountPaid > 0 && invoice.balanceDue > 0
        ? 'Part paid'
        : invoice.balanceDue <= 0 && invoice.total > 0
          ? 'Paid in full'
          : undefined;

    const spec: DocumentSpec = {
      title: taxType === 'none' ? 'INVOICE' : 'TAX INVOICE',
      number: invoice.invoiceNumber,
      numberLabel: 'Invoice No.',
      recipientLabel: 'BILL TO',
      status: STATUS_LABELS[invoice.status] ?? STATUS_LABELS.draft,
      metaRows,
      items: invoice.items,
      totals,
      grandTotal: invoice.total,
      notes: invoice.notes,
      terms: invoice.termsAndConditions,
      paymentTerms: invoice.paymentTerms,
      currency,
      taxType,
      country,
      footerNote: `Thank you for your business — ${business.name}`,
      serviceContext: extras.serviceContext,
      payment: extras.payment ? { ...extras.payment, paidLabel } : paidLabel ? { paidLabel } : undefined,
      hasTax: taxType !== 'none' && invoice.items.some((item) => item.taxRate > 0),
      taxLabel: taxTypeName(taxType),
    };

    return renderDocument(
      business,
      customer,
      spec,
      theme,
      extras.geometry ?? A4,
    );
  }
}
