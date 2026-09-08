import { Injectable } from '@nestjs/common';
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { Quotation } from './schemas/quotation.schema';
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
  RenderStatus,
  RenderTotalRow,
  buildTaxRows,
  formatDate,
  taxTypeName,
} from '../common/pdf/document-render';
import { renderDocument } from '../common/pdf/render-document';

// Mirror of InvoicePdfService: all drawing lives in common/pdf, and this
// service only describes a quotation as a DocumentSpec. Sharing the renderer
// is what lets each of the five layouts be written once and apply to both
// document types.

const STATUS_LABELS: Record<string, RenderStatus> = {
  draft: { label: 'DRAFT', tone: 'neutral' },
  sent: { label: 'SENT', tone: 'urgent' },
  accepted: { label: 'ACCEPTED', tone: 'positive' },
  rejected: { label: 'REJECTED', tone: 'danger' },
  converted: { label: 'CONVERTED', tone: 'positive' },
  cancelled: { label: 'CANCELLED', tone: 'neutral' },
};

@Injectable()
export class QuotationPdfService {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
  ) {}

  async generate(
    businessId: string,
    quotation: Quotation & { _id?: unknown },
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    // quotation.customerId may already be a populated Customer object (the
    // detail-view fetch populates it) — resolve to a plain id either way.
    const rawCustomerId = quotation.customerId as unknown;
    const customerId =
      typeof rawCustomerId === 'object' && rawCustomerId !== null
        ? ((rawCustomerId as { _id?: unknown })._id ?? rawCustomerId).toString()
        : String(rawCustomerId);

    const [business, customer] = await Promise.all([
      this.businessesService.findByIdWithBranding(businessId),
      this.customersService.findOne(businessId, customerId),
    ]);

    return this.render(business, customer, quotation, templateId, accentColor, geometry);
  }

  // Split out from generate() so preview rendering (fixed sample data, no
  // customer lookup) can share the same drawing code.
  render(
    business: RenderBusiness,
    customer: RenderCustomer,
    quotation: Quotation,
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    const theme = resolveDocumentTheme(templateId, accentColor);

    // Same reasoning as InvoicePdfService: the quotation's own stored
    // currency/taxType win over the business's *current* settings, since this
    // quotation was created under whatever they were at the time and must keep
    // showing that even if the business later changes them.
    const currency = quotation.currency || business.currency || 'INR';
    const taxType = quotation.taxType || business.taxType || 'gst';
    const country = business.country || 'IN';

    const metaRows = [
      { label: 'Date', value: formatDate(quotation.quotationDate, country) },
      { label: 'Valid Until', value: formatDate(quotation.validUntil, country) },
    ];

    const totals: RenderTotalRow[] = [{ label: 'Subtotal', value: quotation.subtotal }];
    if (quotation.discount > 0) {
      totals.push({ label: 'Discount', value: quotation.discount, negative: true });
    }
    totals.push(...buildTaxRows(taxType, quotation.taxTotal, quotation.items));
    totals.push({
      label: 'Total',
      value: quotation.total,
      style: 'grand',
      color: 'primary',
      ruleAbove: true,
    });

    const spec: DocumentSpec = {
      title: 'QUOTATION',
      number: quotation.quotationNumber,
      numberLabel: 'Quotation No.',
      recipientLabel: 'QUOTED TO',
      status: STATUS_LABELS[quotation.status] ?? STATUS_LABELS.draft,
      metaRows,
      items: quotation.items,
      totals,
      grandTotal: quotation.total,
      notes: quotation.notes,
      terms: quotation.termsAndConditions,
      currency,
      taxType,
      country,
      footerNote: `Thank you for the opportunity — ${business.name}`,
      hasTax: taxType !== 'none' && quotation.items.some((item) => item.taxRate > 0),
      taxLabel: taxTypeName(taxType),
    };

    return renderDocument(business, customer, spec, theme, geometry);
  }
}
