import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { BusinessesService } from '../businesses/businesses.service';
import { Purchase } from './schemas/purchase.schema';
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
  RenderItem,
  RenderStatus,
  RenderTotalRow,
  applyPaymentVisibility,
  formatDate,
} from '../common/pdf/document-render';
import { renderDocument } from '../common/pdf/render-document';

const STATUS_LABELS: Record<string, RenderStatus> = {
  paid: { label: 'PAID', tone: 'positive' },
  unpaid: { label: 'UNPAID', tone: 'urgent' },
  partially_paid: { label: 'PART PAID', tone: 'urgent' },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  credit: 'Supplier credit',
  other: 'Other',
};

// Same shape as the other three, minus the flags a purchase has nothing to
// apply: the schema carries no discount and no per-line tax, so
// purchaseShowDiscount and purchaseShowTax have nothing to gate.
type PurchaseRenderBusiness = RenderBusiness & {
  purchaseShowBankInfo?: boolean;
  purchaseBottomMessage?: string;
  purchaseShowHsn?: boolean;
};

// A purchase record turned into the same DocumentSpec the invoice, quotation
// and proforma use, so it gets the identical five layouts and theming for
// free. The one structural difference is the recipient: a purchase is
// addressed to the SUPPLIER, so the supplier fills the customer slot.
@Injectable()
export class PurchasePdfService {
  constructor(private readonly businessesService: BusinessesService) {}

  async generate(
    businessId: string,
    purchase: Purchase & { _id?: unknown },
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    const business = await this.businessesService.findByIdWithBranding(businessId);

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
        // Fall through without a QR rather than failing the whole document.
      }
    }

    return this.render({ ...business, paymentQrBuffer }, purchase, templateId, accentColor, geometry);
  }

  // Split out from generate() the same way the invoice service does, so a
  // preview with fixed sample data can share the drawing code.
  render(
    business: PurchaseRenderBusiness,
    purchase: Purchase,
    templateId?: DocumentTemplateId,
    accentColor?: string | null,
    geometry: PageGeometry = A4,
  ): Promise<Buffer> {
    const theme = resolveDocumentTheme(templateId, accentColor);
    const currency = purchase.currency || business.currency || 'INR';
    const country = business.country || 'IN';

    // The supplier stands in for the customer: the layouts address whoever is
    // in this slot, and on a purchase order that is who we are buying from.
    const supplier: RenderCustomer = {
      name: purchase.supplierName,
      phone: purchase.supplierPhone ?? '',
    };

    const metaRows = [
      { label: 'Date', value: formatDate(purchase.purchaseDate, country) },
      { label: 'Payment', value: PAYMENT_METHOD_LABELS[purchase.paymentMethod] ?? purchase.paymentMethod },
    ];
    if (purchase.supplierInvoiceNumber) {
      metaRows.push({ label: 'Supplier Inv.', value: purchase.supplierInvoiceNumber });
    }

    // A purchase line stores costPrice where a sales line stores rate, and
    // carries no tax of its own, so tax is zeroed rather than invented.
    const items: RenderItem[] = purchase.items.map((item) => ({
      name: item.name,
      hsn: item.hsnCode,
      quantity: item.quantity,
      rate: item.costPrice,
      taxRate: 0,
      amount: item.amount,
      taxAmount: 0,
    }));

    const totals: RenderTotalRow[] = [
      {
        label: 'Total',
        value: purchase.totalAmount,
        style: 'grand',
        color: 'primary',
        ruleAbove: true,
      },
    ];

    const spec: DocumentSpec = {
      title: 'PURCHASE ORDER',
      number: purchase.purchaseNumber,
      numberLabel: 'PO No.',
      recipientLabel: 'SUPPLIER',
      status: STATUS_LABELS[purchase.paymentStatus] ?? STATUS_LABELS.unpaid,
      metaRows,
      items,
      totals,
      grandTotal: purchase.totalAmount,
      notes: purchase.notes,
      currency,
      taxType: 'none',
      country,
      footerNote:
        business.purchaseBottomMessage?.trim() || `Purchase order from ${business.name}`,
      // No per-line tax on a purchase, so the tax column is always dropped.
      hasTax: false,
      taxLabel: '',
      // A PO is a document for a supplier, not a field-service call.
      itemLabel: 'ITEM',
      show: {
        hsn: business.purchaseShowHsn === true,
        serviceAddress: false,
      },
    };

    return renderDocument(
      applyPaymentVisibility(business, {
        bank: business.purchaseShowBankInfo !== false,
        upi: business.purchaseShowBankInfo !== false,
      }),
      supplier,
      spec,
      theme,
      geometry,
    );
  }
}
