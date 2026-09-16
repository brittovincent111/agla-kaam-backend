import { Injectable } from '@nestjs/common';
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { ProformaInvoice } from './schemas/proforma-invoice.schema';
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
  applyPaymentVisibility,
  toRenderItems,
  formatDate,
  taxTypeName,
} from '../common/pdf/document-render';
import { renderDocument } from '../common/pdf/render-document';

const STATUS_LABELS: Record<string, RenderStatus> = {
  draft: { label: 'DRAFT', tone: 'neutral' },
  sent: { label: 'SENT', tone: 'urgent' },
  converted: { label: 'CONVERTED', tone: 'positive' },
  cancelled: { label: 'CANCELLED', tone: 'neutral' },
};

// Declared locally for the same reason as InvoiceRenderBusiness: the shared
// RenderBusiness stays free of per-document-type setting names. All optional,
// and undefined means "show".
type ProformaRenderBusiness = RenderBusiness & {
  proformaShowDiscount?: boolean;
  proformaShowTax?: boolean;
  proformaShowBankInfo?: boolean;
  proformaShowUpiInfo?: boolean;
  proformaBottomMessage?: string;
  proformaShowHsn?: boolean;
};

@Injectable()
export class ProformaPdfService {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
  ) {}

  async generate(
    businessId: string,
    proforma: ProformaInvoice & { _id?: unknown },
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    const rawCustomerId = proforma.customerId as unknown;
    const customerId =
      typeof rawCustomerId === 'object' && rawCustomerId !== null
        ? ((rawCustomerId as { _id?: unknown })._id ?? rawCustomerId).toString()
        : String(rawCustomerId);

    const [business, customer] = await Promise.all([
      this.businessesService.findByIdWithBranding(businessId),
      this.customersService.findOne(businessId, customerId),
    ]);

    return this.render(business, customer, proforma, templateId, accentColor, geometry);
  }

  render(
    business: ProformaRenderBusiness,
    customer: RenderCustomer,
    proforma: ProformaInvoice,
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    const theme = resolveDocumentTheme(templateId, accentColor);

    const currency = proforma.currency || business.currency || 'INR';
    const taxType = (proforma as any).taxType || business.taxType || 'gst';
    const country = business.country || 'IN';

    const metaRows = [
      { label: 'Date', value: formatDate(proforma.proformaDate, country) },
      { label: 'Valid Until', value: formatDate(proforma.validUntil, country) },
    ];

    const totals: RenderTotalRow[] = [{ label: 'Subtotal', value: proforma.subtotal }];
    const showDiscount = business.proformaShowDiscount !== false;
    const showTax = business.proformaShowTax !== false;
    if (showDiscount && proforma.discount > 0) {
      totals.push({ label: 'Discount', value: proforma.discount, negative: true });
    }
    if (showTax) {
      totals.push(...buildTaxRows(taxType, proforma.taxTotal, proforma.items));
    }
    totals.push({
      label: 'Total',
      value: proforma.total,
      style: 'grand',
      color: 'primary',
      ruleAbove: true,
    });

    const spec: DocumentSpec = {
      title: 'PROFORMA INVOICE',
      number: proforma.proformaNumber,
      numberLabel: 'Proforma No.',
      recipientLabel: 'PROFORMA TO',
      status: STATUS_LABELS[proforma.status] ?? STATUS_LABELS.draft,
      metaRows,
      items: toRenderItems(proforma.items),
      totals,
      grandTotal: proforma.total,
      notes: proforma.notes,
      terms: proforma.termsAndConditions,
      paymentTerms: proforma.paymentTerms,
      currency,
      taxType,
      country,
      footerNote:
        business.proformaBottomMessage?.trim() ||
        `Thank you for your business — ${business.name}`,
      hasTax:
        showTax && taxType !== 'none' && proforma.items.some((item) => item.taxRate > 0),
      taxLabel: taxTypeName(taxType),
      show: { hsn: business.proformaShowHsn === true },
    };

    return renderDocument(
      applyPaymentVisibility(business, {
        bank: business.proformaShowBankInfo !== false,
        upi: business.proformaShowUpiInfo !== false,
      }),
      customer,
      spec,
      theme,
      geometry,
    );
  }
}
