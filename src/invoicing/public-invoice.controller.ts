import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import { InvoicingService } from './invoicing.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceShareService } from './invoice-share.service';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  isCustomAccentUnlocked,
  isDocumentTemplateUnlocked,
} from '../common/pdf/document-templates';
import { formatCurrency, formatDate } from '../common/pdf/document-render';
import { buildUpiLink } from '../common/utils/upi';
import { esc, renderPublicPage, waDigits } from '../common/public/public-page';

// These pages are for the business's customer: no scripts, no forms, only
// our own styles and images.
export const PUBLIC_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// No auth guard on purpose: these open from a payment reminder. Access is
// the signed, expiring token in the path (see InvoiceShareService) — it names
// exactly one invoice.
@Controller('public/invoices')
export class PublicInvoiceController {
  constructor(
    private readonly shareService: InvoiceShareService,
    private readonly invoicingService: InvoicingService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private async load(token: string) {
    const target = this.shareService.verify(token);
    // One answer for expired, forged and deleted alike — nothing to probe.
    if (!target) throw new NotFoundException('This invoice link has expired');
    const [invoice, biz] = await Promise.all([
      this.invoicingService
        .findOneWithDisplayStatus(target.businessId, target.invoiceId)
        .catch(() => null),
      this.businessesService.findById(target.businessId).catch(() => null),
    ]);
    if (
      !invoice ||
      !biz ||
      invoice.status === 'draft' ||
      invoice.status === 'cancelled'
    ) {
      throw new NotFoundException('This invoice link has expired');
    }
    return { target, invoice, biz };
  }

  /**
   * The invoice as a page: what is owed, a "Pay with UPI" button that opens
   * the customer's UPI app with the amount and invoice number filled in, and
   * the PDF one tap away. It used to be the PDF alone, with the UPI ID to
   * copy and the amount to type.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  async page(@Param('token') token: string, @Res() res: Response) {
    const { invoice, biz } = await this.load(token);
    const currency = invoice.currency || biz.currency || 'INR';
    const money = (n: number) => formatCurrency(n, currency);
    const customer = invoice.customerId as unknown as
      { name?: string } | undefined;
    const balance = invoice.balanceDue ?? 0;
    const settled = balance <= 0;
    const status = String(invoice.status);

    const showPayment =
      biz.showPaymentDetailsOnInvoice !== false &&
      biz.invoiceShowUpiInfo !== false;
    const upiLink =
      !settled && showPayment
        ? buildUpiLink({
            upiIdOrLink: biz.paymentQrContent || biz.paymentUpiId || '',
            payeeName: biz.name,
            amount: balance,
            note: invoice.invoiceNumber,
            currency,
          })
        : null;
    const upiIsLink = !!upiLink && upiLink.startsWith('upi://');
    const qr = upiLink
      ? await QRCode.toDataURL(upiLink, { margin: 1, width: 360 }).catch(
          () => null,
        )
      : null;

    const bizWa = waDigits(biz.phone);
    const paidMsg = encodeURIComponent(
      `Hi ${biz.name}, I've paid invoice ${invoice.invoiceNumber} (${money(balance)}).`,
    );

    const pill = settled
      ? '<span class="pill ok">Paid in full</span>'
      : status === 'overdue'
        ? '<span class="pill bad">Overdue</span>'
        : status === 'partially_paid'
          ? '<span class="pill warn">Part paid</span>'
          : '<span class="pill warn">Due</span>';

    const body = `
<div class="biz">${esc(biz.name)}</div>
${biz.phone ? `<div class="bizsub">${esc(biz.phone)}</div>` : ''}
<div class="card">
  <div class="muted">Invoice ${esc(invoice.invoiceNumber)}${customer?.name ? ` · for ${esc(customer.name)}` : ''}</div>
  <h1>${settled ? 'Nothing to pay' : esc(money(balance))}</h1>
  ${pill}
  <div style="margin-top:12px">
    <div class="row"><span>Invoice date</span><span>${esc(formatDate(invoice.invoiceDate))}</span></div>
    <div class="row"><span>Due date</span><span>${esc(formatDate(invoice.dueDate))}</span></div>
    <div class="row"><span>Total</span><span>${esc(money(invoice.total))}</span></div>
    ${invoice.amountPaid > 0 ? `<div class="row"><span>Paid so far</span><span>${esc(money(invoice.amountPaid))}</span></div>` : ''}
    <div class="row"><span><b>Balance due</b></span><span><b>${esc(money(Math.max(0, balance)))}</b></span></div>
  </div>
</div>
${
  upiLink
    ? `<div class="card">
  ${
    upiIsLink
      ? `<a class="btn primary" href="${esc(upiLink)}">Pay ${esc(money(balance))} with UPI</a>
  <p class="muted" style="text-align:center;margin:6px 0 0">Opens GPay, PhonePe, Paytm or any UPI app with the amount filled in.</p>`
      : ''
  }
  ${
    qr
      ? `<img class="qr" src="${qr}" alt="UPI QR code for ${esc(money(balance))}">
  <p class="muted" style="text-align:center;margin:6px 0 0">On another device? Scan this with any UPI app.</p>`
      : ''
  }
  ${biz.paymentUpiId ? `<p class="muted" style="text-align:center;margin:8px 0 0">UPI ID <code>${esc(biz.paymentUpiId)}</code></p>` : ''}
</div>`
    : ''
}
<a class="btn ghost" href="${esc(token)}/pdf">View invoice PDF</a>
${!settled && bizWa ? `<a class="btn ghost" href="https://wa.me/${bizWa}?text=${paidMsg}">Paid? Tell ${esc(biz.name)} on WhatsApp</a>` : ''}
`;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': PUBLIC_PAGE_CSP,
      'Referrer-Policy': 'no-referrer',
    });
    res.send(
      renderPublicPage({
        title: `Invoice ${invoice.invoiceNumber}`,
        businessName: biz.name,
        body,
      }),
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const { target, invoice, biz } = await this.load(token);
    const tier = await this.subscriptionsService.getActiveTier(
      target.businessId,
    );
    const templateId = isDocumentTemplateUnlocked(biz.invoiceTemplateId, tier)
      ? biz.invoiceTemplateId
      : DEFAULT_DOCUMENT_TEMPLATE_ID;
    const accentColor = isCustomAccentUnlocked(tier)
      ? (biz.documentAccentColor ?? null)
      : null;
    const buffer = await this.invoicePdfService.generate(
      target.businessId,
      invoice as any,
      templateId,
      accentColor,
    );
    res.set({
      'Content-Type': 'application/pdf',
      // inline: opens in the phone's viewer from WhatsApp, not a download.
      'Content-Disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  }
}
