import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { Invoice } from './schemas/invoice.schema';

// Mirrors mobile/src/theme.ts (light palette) so the PDF reads as the same
// brand as the app rather than a generic black-and-white document.
const COLORS = {
  primary: '#0F6E56',
  onPrimary: '#FFFFFF',
  primaryTint: '#CDEDE1', // onPrimary at reduced opacity, for text on the header band
  tintBg: '#E1F5EE',
  tintText: '#0F6E56',
  urgencyText: '#D85A30',
  urgencyBg: '#FAECE7',
  text: '#2C2C2A',
  textSecondary: '#5F5E5A',
  textMuted: '#888780',
  border: '#E4E2DD',
  dangerText: '#A32D2D',
  dangerBg: '#FCEBEB',
  stripe: '#FAFAF9',
};

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89; // A4
const M = 42; // content margin
const CONTENT_WIDTH = PAGE_WIDTH - M * 2;

const HEADER_HEIGHT = 118;
const TITLE_TOP = 146;
const BILLING_BLOCK_HEIGHT = 60;
const TABLE_HEADER_HEIGHT = 26;
const ITEM_ROW_HEIGHT = 24;
const ITEM_ROW_HEIGHT_WITH_DESC = 34;
const TABLE_BOTTOM_GAP = 18;
const TOTALS_TOP_GAP = 14;
const TOTALS_ROW_HEIGHT = 17;
const TOTALS_ROW_HEIGHT_BOLD = 22;
const TOTALS_DIVIDER_GAP = 4;
const TOTALS_BOTTOM_GAP = 20;
const NOTES_BOX_PADDING = 40;
const NOTES_BOTTOM_GAP = 20;
const FOOTER_TOP_GAP = 24;

function formatCurrency(amount: number): string {
  return `Rs. ${amount.toFixed(2)}`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_INFO: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: 'DRAFT', bg: '#EFEEEB', text: COLORS.textSecondary },
  unpaid: { label: 'UNPAID', bg: COLORS.urgencyBg, text: COLORS.urgencyText },
  partially_paid: { label: 'PARTIALLY PAID', bg: COLORS.urgencyBg, text: COLORS.urgencyText },
  paid: { label: 'PAID', bg: COLORS.tintBg, text: COLORS.tintText },
  overdue: { label: 'OVERDUE', bg: COLORS.dangerBg, text: COLORS.dangerText },
  cancelled: { label: 'CANCELLED', bg: '#EFEEEB', text: COLORS.textSecondary },
};

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
  ) {}

  async generate(businessId: string, invoice: Invoice & { _id: unknown }): Promise<Buffer> {
    // invoice.customerId may already be a populated Customer object (the
    // detail-view fetch populates it) — resolve to a plain id either way.
    const rawCustomerId = invoice.customerId as unknown;
    const customerId =
      typeof rawCustomerId === 'object' && rawCustomerId !== null
        ? ((rawCustomerId as { _id?: unknown })._id ?? rawCustomerId).toString()
        : String(rawCustomerId);

    const [business, customer] = await Promise.all([
      this.businessesService.findById(businessId),
      this.customersService.findOne(businessId, customerId),
    ]);

    const notesHeight = invoice.notes ? this.measureNotesHeight(invoice.notes) : 0;

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    this.drawHeader(doc, business);
    let y = this.drawTitleRow(doc, invoice);
    y = this.drawBillingInfo(doc, invoice, customer, y);
    y = this.drawItemsTable(doc, invoice, y);
    y = this.drawTotals(doc, invoice, business, y);
    if (invoice.notes) {
      y = this.drawNotes(doc, invoice.notes, y, notesHeight);
    }
    this.drawFooter(doc, business, y + FOOTER_TOP_GAP);

    doc.end();
    return done;
  }

  // A throwaway document purely for font metrics — heightOfString needs a
  // PDFDocument instance but not one sized for the final page.
  private measureNotesHeight(notes: string): number {
    const measureDoc = new PDFDocument();
    measureDoc.font('Helvetica').fontSize(10);
    return measureDoc.heightOfString(notes, { width: CONTENT_WIDTH - 28 });
  }

  private drawHeader(doc: PDFKit.PDFDocument, business: { name: string; address?: string; phone: string; email?: string; gstin?: string }) {
    doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT).fill(COLORS.primary);

    // Monogram badge — stands in for a logo until logo upload exists.
    const badgeCx = M + 22;
    const badgeCy = 44;
    doc.circle(badgeCx, badgeCy, 22).fill(COLORS.onPrimary);
    const initial = (business.name?.trim()?.[0] ?? '?').toUpperCase();
    doc
      .fillColor(COLORS.primary)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(initial, badgeCx - 22, badgeCy - 10, { width: 44, align: 'center' });

    const textX = M + 60;
    doc.fillColor(COLORS.onPrimary).font('Helvetica-Bold').fontSize(17).text(business.name, textX, 24, { width: 320 });

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.primaryTint);
    let contactY = 46;
    if (business.address) {
      doc.text(business.address, textX, contactY, { width: 320 });
      contactY += 13;
    }
    const contactLine = [business.phone, business.email].filter(Boolean).join('   ·   ');
    if (contactLine) {
      doc.text(contactLine, textX, contactY, { width: 320 });
    }

    if (business.gstin) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.primaryTint)
        .text(`GSTIN: ${business.gstin}`, PAGE_WIDTH - M - 200, 24, { width: 200, align: 'right' });
    }
  }

  private drawTitleRow(doc: PDFKit.PDFDocument, invoice: Invoice): number {
    const top = TITLE_TOP;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.textMuted).text('INVOICE', M, top, { characterSpacing: 1.5 });
    doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.text).text(invoice.invoiceNumber, M, top + 14);

    const status = STATUS_INFO[invoice.status] ?? STATUS_INFO.draft;
    doc.font('Helvetica-Bold').fontSize(9);
    const label = status.label;
    const textWidth = doc.widthOfString(label, { characterSpacing: 0.5 });
    const pillWidth = textWidth + 24;
    const pillHeight = 22;
    const pillX = PAGE_WIDTH - M - pillWidth;
    const pillY = top + 8;
    doc.roundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2).fill(status.bg);
    doc
      .fillColor(status.text)
      .text(label, pillX, pillY + 6.5, { width: pillWidth, align: 'center', characterSpacing: 0.5 });

    const dividerY = top + 56;
    doc.moveTo(M, dividerY).lineTo(PAGE_WIDTH - M, dividerY).strokeColor(COLORS.border).lineWidth(1).stroke();
    return dividerY + 22;
  }

  private drawBillingInfo(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    customer: { name: string; phone: string },
    top: number,
  ): number {
    const rightX = M + 300;
    const labelWidth = 110;
    const valueWidth = PAGE_WIDTH - M - (rightX + labelWidth);

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted).text('BILLED TO', M, top, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text(customer.name, M, top + 14);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.textSecondary).text(customer.phone, M, top + 32);

    const detailRow = (label: string, value: string, rowY: number) => {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted).text(label, rightX, rowY, { width: labelWidth });
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(value, rightX + labelWidth, rowY, { width: valueWidth, align: 'right' });
    };
    detailRow('Invoice date', formatDate(invoice.invoiceDate), top);
    detailRow('Due date', formatDate(invoice.dueDate), top + 16);
    if (invoice.paymentTerms) {
      detailRow('Payment terms', invoice.paymentTerms, top + 32);
    }

    return top + BILLING_BLOCK_HEIGHT;
  }

  private drawItemsTable(doc: PDFKit.PDFDocument, invoice: Invoice, top: number): number {
    const cols = {
      desc: { x: M, w: 235 },
      qty: { x: M + 235, w: 45 },
      rate: { x: M + 280, w: 75 },
      tax: { x: M + 355, w: 45 },
      amount: { x: M + 400, w: PAGE_WIDTH - M - (M + 400) },
    };

    doc.rect(M, top, CONTENT_WIDTH, TABLE_HEADER_HEIGHT).fill(COLORS.tintBg);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.tintText);
    const headerY = top + 9;
    doc.text('DESCRIPTION', cols.desc.x + 10, headerY);
    doc.text('QTY', cols.qty.x, headerY, { width: cols.qty.w, align: 'right' });
    doc.text('RATE', cols.rate.x, headerY, { width: cols.rate.w, align: 'right' });
    doc.text('TAX', cols.tax.x, headerY, { width: cols.tax.w, align: 'right' });
    doc.text('AMOUNT', cols.amount.x, headerY, { width: cols.amount.w - 10, align: 'right' });

    let rowY = top + TABLE_HEADER_HEIGHT;
    invoice.items.forEach((item, index) => {
      const rowHeight = item.description ? ITEM_ROW_HEIGHT_WITH_DESC : ITEM_ROW_HEIGHT;
      if (index % 2 === 1) {
        doc.rect(M, rowY, CONTENT_WIDTH, rowHeight).fill(COLORS.stripe);
      }
      const textY = rowY + 7;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(item.name, cols.desc.x + 10, textY, { width: cols.desc.w - 10 });
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
      doc.text(String(item.quantity), cols.qty.x, textY, { width: cols.qty.w, align: 'right' });
      doc.text(item.rate.toFixed(2), cols.rate.x, textY, { width: cols.rate.w, align: 'right' });
      doc.text(`${item.taxRate}%`, cols.tax.x, textY, { width: cols.tax.w, align: 'right' });
      doc
        .font('Helvetica-Bold')
        .text((item.amount + item.taxAmount).toFixed(2), cols.amount.x, textY, { width: cols.amount.w - 10, align: 'right' });
      if (item.description) {
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor(COLORS.textMuted)
          .text(item.description, cols.desc.x + 10, textY + 14, { width: cols.desc.w - 10 });
      }
      rowY += rowHeight;
    });

    doc.moveTo(M, rowY).lineTo(PAGE_WIDTH - M, rowY).strokeColor(COLORS.border).lineWidth(1).stroke();
    return rowY + TABLE_BOTTOM_GAP;
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    business: { gstin?: string },
    top: number,
  ): number {
    const boxWidth = 240;
    const boxX = PAGE_WIDTH - M - boxWidth;
    const labelX = boxX + 16;
    const valueWidth = boxWidth - 32;
    let rowY = top + TOTALS_TOP_GAP;

    const row = (label: string, value: string, opts: { bold?: boolean; color?: string; size?: number } = {}) => {
      const size = opts.size ?? (opts.bold ? 12 : 10);
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(opts.color ?? (opts.bold ? COLORS.text : COLORS.textSecondary));
      doc.text(label, labelX, rowY, { width: valueWidth / 2 });
      doc.text(value, labelX + valueWidth / 2, rowY, { width: valueWidth / 2, align: 'right' });
      rowY += opts.bold ? TOTALS_ROW_HEIGHT_BOLD : TOTALS_ROW_HEIGHT;
    };

    row('Subtotal', formatCurrency(invoice.subtotal));
    if (invoice.discount > 0) row('Discount', `- ${formatCurrency(invoice.discount)}`);
    if (business.gstin) {
      row('CGST', formatCurrency(invoice.taxTotal / 2));
      row('SGST', formatCurrency(invoice.taxTotal / 2));
    } else {
      row('Tax', formatCurrency(invoice.taxTotal));
    }

    rowY += TOTALS_DIVIDER_GAP;
    doc.moveTo(boxX, rowY - TOTALS_DIVIDER_GAP).lineTo(PAGE_WIDTH - M, rowY - TOTALS_DIVIDER_GAP).strokeColor(COLORS.border).lineWidth(1).stroke();

    row('Total', formatCurrency(invoice.total), { bold: true, color: COLORS.primary, size: 13 });
    row('Amount paid', formatCurrency(invoice.amountPaid));

    const balanceColor = invoice.balanceDue > 0 ? COLORS.dangerText : COLORS.tintText;
    row('Balance due', formatCurrency(invoice.balanceDue), { bold: true, color: balanceColor });

    return rowY + TOTALS_BOTTOM_GAP;
  }

  private drawNotes(doc: PDFKit.PDFDocument, notes: string, top: number, notesHeight: number): number {
    const boxHeight = notesHeight + NOTES_BOX_PADDING;
    doc.roundedRect(M, top, CONTENT_WIDTH, boxHeight, 6).fill(COLORS.stripe);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.textMuted).text('NOTES', M + 14, top + 12, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.textSecondary).text(notes, M + 14, top + 26, { width: CONTENT_WIDTH - 28 });
    return top + boxHeight + NOTES_BOTTOM_GAP;
  }

  private drawFooter(doc: PDFKit.PDFDocument, business: { name: string }, y: number) {
    doc.moveTo(M, y).lineTo(PAGE_WIDTH - M, y).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.textMuted)
      .text(`Thank you for your business — ${business.name}`, M, y + 12, { width: CONTENT_WIDTH, align: 'center' });
  }
}
