import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { BusinessesService } from '../businesses/businesses.service';
import { CustomersService } from '../customers/customers.service';
import { Invoice } from './schemas/invoice.schema';
import {
  DocumentTemplateId,
  DocumentTemplateTheme,
  getDocumentTemplate,
} from '../common/pdf/document-templates';

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
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function statusInfo(
  colors: DocumentTemplateTheme['colors'],
): Record<string, { label: string; bg: string; text: string }> {
  return {
    draft: { label: 'DRAFT', bg: '#EFEEEB', text: colors.textSecondary },
    unpaid: { label: 'UNPAID', bg: colors.urgencyBg, text: colors.urgencyText },
    partially_paid: {
      label: 'PARTIALLY PAID',
      bg: colors.urgencyBg,
      text: colors.urgencyText,
    },
    paid: { label: 'PAID', bg: colors.tintBg, text: colors.tintText },
    overdue: { label: 'OVERDUE', bg: colors.dangerBg, text: colors.dangerText },
    cancelled: {
      label: 'CANCELLED',
      bg: '#EFEEEB',
      text: colors.textSecondary,
    },
  };
}

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly customersService: CustomersService,
  ) {}

  async generate(
    businessId: string,
    invoice: Invoice & { _id: unknown },
    templateId?: DocumentTemplateId,
  ): Promise<Buffer> {
    // invoice.customerId may already be a populated Customer object (the
    // detail-view fetch populates it) — resolve to a plain id either way.
    const rawCustomerId = invoice.customerId as unknown;
    const customerId =
      typeof rawCustomerId === 'object' && rawCustomerId !== null
        ? ((rawCustomerId as { _id?: unknown })._id ?? rawCustomerId).toString()
        : String(rawCustomerId);

    const [business, customer] = await Promise.all([
      this.businessesService.findByIdWithBranding(businessId),
      this.customersService.findOne(businessId, customerId),
    ]);

    return this.render(business, customer, invoice, templateId);
  }

  // Split out from generate() so preview rendering (fixed sample data, no
  // customer lookup) can share the same drawing code.
  render(
    business: {
      name: string;
      address?: string;
      phone?: string;
      email?: string;
      gstin?: string;
      logo?: Buffer;
      signature?: Buffer;
    },
    customer: { name: string; phone: string; address?: string; gstin?: string },
    invoice: Invoice,
    templateId?: DocumentTemplateId,
  ): Promise<Buffer> {
    const theme = getDocumentTemplate(templateId);
    const notesHeight = invoice.notes
      ? this.measureTextHeight(invoice.notes)
      : 0;
    const termsHeight = invoice.termsAndConditions
      ? this.measureTextHeight(invoice.termsAndConditions)
      : 0;

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    this.drawHeader(doc, business, theme);
    let y = this.drawTitleRow(doc, invoice, theme);
    y = this.drawBillingInfo(doc, invoice, customer, y, theme);
    y = this.drawItemsTable(doc, invoice, y, theme);
    y = this.drawTotals(doc, invoice, business, y, theme);
    if (invoice.notes) {
      y = this.drawTextBox(doc, 'NOTES', invoice.notes, y, notesHeight, theme);
    }
    if (invoice.termsAndConditions) {
      y = this.drawTextBox(
        doc,
        'TERMS & CONDITIONS',
        invoice.termsAndConditions,
        y,
        termsHeight,
        theme,
      );
    }
    if (business.signature) {
      y = this.drawSignatureBlock(doc, business.signature, y, theme);
    }
    this.drawFooter(doc, business, y + FOOTER_TOP_GAP, theme);

    doc.end();
    return done;
  }

  // A throwaway document purely for font metrics — heightOfString needs a
  // PDFDocument instance but not one sized for the final page.
  private measureTextHeight(text: string): number {
    const measureDoc = new PDFDocument();
    measureDoc.font('Helvetica').fontSize(10);
    return measureDoc.heightOfString(text, { width: CONTENT_WIDTH - 28 });
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    business: {
      name: string;
      address?: string;
      phone?: string;
      email?: string;
      gstin?: string;
      logo?: Buffer;
    },
    theme: DocumentTemplateTheme,
  ) {
    const { colors } = theme;
    const badgeCx = M + 22;
    const badgeCy = 44;
    const textX = M + 60;
    const isLine = theme.headerStyle === 'line';

    const drawBadge = () => {
      if (business.logo) {
        doc.save();
        doc.circle(badgeCx, badgeCy, 22).clip();
        doc.image(business.logo, badgeCx - 22, badgeCy - 22, {
          fit: [44, 44],
          align: 'center',
          valign: 'center',
        });
        doc.restore();
        return;
      }
      const initial = (business.name?.trim()?.[0] ?? '?').toUpperCase();
      doc
        .fillColor(colors.primary)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(initial, badgeCx - 22, badgeCy - 10, {
          width: 44,
          align: 'center',
        });
    };

    if (isLine) {
      doc
        .circle(badgeCx, badgeCy, 22)
        .lineWidth(1.5)
        .strokeColor(colors.primary)
        .stroke();
      drawBadge();
      doc
        .fillColor(colors.text)
        .font('Helvetica-Bold')
        .fontSize(17)
        .text(business.name, textX, 24, { width: 320 });
      doc.font('Helvetica').fontSize(9).fillColor(colors.textSecondary);
    } else {
      doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT).fill(colors.primary);
      doc.circle(badgeCx, badgeCy, 22).fill(colors.onPrimary);
      drawBadge();
      doc
        .fillColor(colors.onPrimary)
        .font('Helvetica-Bold')
        .fontSize(17)
        .text(business.name, textX, 24, { width: 320 });
      doc.font('Helvetica').fontSize(9).fillColor(colors.primaryTint);
    }

    let contactY = 46;
    if (business.address) {
      doc.text(business.address, textX, contactY, { width: 320 });
      contactY += 13;
    }
    const contactLine = [business.phone, business.email]
      .filter(Boolean)
      .join('   ·   ');
    if (contactLine) {
      doc.text(contactLine, textX, contactY, { width: 320 });
    }

    if (business.gstin) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(isLine ? colors.textSecondary : colors.primaryTint)
        .text(`GSTIN: ${business.gstin}`, PAGE_WIDTH - M - 200, 24, {
          width: 200,
          align: 'right',
        });
    }

    if (isLine) {
      doc
        .moveTo(0, HEADER_HEIGHT)
        .lineTo(PAGE_WIDTH, HEADER_HEIGHT)
        .strokeColor(colors.primary)
        .lineWidth(2)
        .stroke();
    }
  }

  private drawTitleRow(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    theme: DocumentTemplateTheme,
  ): number {
    const { colors } = theme;
    const top = TITLE_TOP;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(colors.textMuted)
      .text('INVOICE', M, top, { characterSpacing: 1.5 });
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(colors.text)
      .text(invoice.invoiceNumber, M, top + 14);

    const status =
      statusInfo(colors)[invoice.status] ?? statusInfo(colors).draft;
    doc.font('Helvetica-Bold').fontSize(9);
    const label = status.label;
    const textWidth = doc.widthOfString(label, { characterSpacing: 0.5 });
    const pillWidth = textWidth + 24;
    const pillHeight = 22;
    const pillX = PAGE_WIDTH - M - pillWidth;
    const pillY = top + 8;
    doc
      .roundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2)
      .fill(status.bg);
    doc.fillColor(status.text).text(label, pillX, pillY + 6.5, {
      width: pillWidth,
      align: 'center',
      characterSpacing: 0.5,
    });

    const dividerY = top + 56;
    doc
      .moveTo(M, dividerY)
      .lineTo(PAGE_WIDTH - M, dividerY)
      .strokeColor(colors.border)
      .lineWidth(1)
      .stroke();
    return dividerY + 22;
  }

  private drawBillingInfo(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    customer: { name: string; phone: string; address?: string; gstin?: string },
    top: number,
    theme: DocumentTemplateTheme,
  ): number {
    const { colors } = theme;
    const rightX = M + 300;
    const labelWidth = 110;
    const valueWidth = PAGE_WIDTH - M - (rightX + labelWidth);

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(colors.textMuted)
      .text('BILLED TO', M, top, { characterSpacing: 1 });
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(colors.text)
      .text(customer.name, M, top + 14);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(colors.textSecondary)
      .text(customer.phone, M, top + 32);
    let customerDetailsHeight = 0;
    if (customer.address) {
      doc.font('Helvetica').fontSize(9).fillColor(colors.textSecondary);
      customerDetailsHeight = doc.heightOfString(customer.address, {
        width: 260,
      });
      doc.text(customer.address, M, top + 47, { width: 260 });
    }
    if (customer.gstin) {
      const gstinY =
        top + 47 + customerDetailsHeight + (customer.address ? 4 : 0);
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(colors.textSecondary)
        .text(`GSTIN: ${customer.gstin}`, M, gstinY, { width: 260 });
      customerDetailsHeight += (customer.address ? 4 : 0) + 12;
    }

    const detailRow = (label: string, value: string, rowY: number) => {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(colors.textMuted)
        .text(label, rightX, rowY, { width: labelWidth });
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(colors.text)
        .text(value, rightX + labelWidth, rowY, {
          width: valueWidth,
          align: 'right',
        });
    };
    detailRow('Invoice date', formatDate(invoice.invoiceDate), top);
    detailRow('Due date', formatDate(invoice.dueDate), top + 16);
    if (invoice.paymentTerms) {
      detailRow('Payment terms', invoice.paymentTerms, top + 32);
    }

    return (
      top + Math.max(BILLING_BLOCK_HEIGHT, 47 + customerDetailsHeight + 12)
    );
  }

  private drawItemsTable(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    top: number,
    theme: DocumentTemplateTheme,
  ): number {
    const { colors } = theme;
    const s = theme.fontScale;
    const tableHeaderHeight = Math.round(TABLE_HEADER_HEIGHT * s);
    const itemRowHeight = Math.round(ITEM_ROW_HEIGHT * s);
    const itemRowHeightWithDesc = Math.round(ITEM_ROW_HEIGHT_WITH_DESC * s);

    const cols = {
      desc: { x: M, w: 235 },
      qty: { x: M + 235, w: 45 },
      rate: { x: M + 280, w: 75 },
      tax: { x: M + 355, w: 45 },
      amount: { x: M + 400, w: PAGE_WIDTH - M - (M + 400) },
    };

    doc.rect(M, top, CONTENT_WIDTH, tableHeaderHeight).fill(colors.tintBg);
    doc
      .font('Helvetica-Bold')
      .fontSize(9 * s)
      .fillColor(colors.tintText);
    const headerY = top + tableHeaderHeight / 2 - 4.5 * s;
    doc.text('DESCRIPTION', cols.desc.x + 10, headerY);
    doc.text('QTY', cols.qty.x, headerY, { width: cols.qty.w, align: 'right' });
    doc.text('RATE', cols.rate.x, headerY, {
      width: cols.rate.w,
      align: 'right',
    });
    doc.text('TAX', cols.tax.x, headerY, { width: cols.tax.w, align: 'right' });
    doc.text('AMOUNT', cols.amount.x, headerY, {
      width: cols.amount.w - 10,
      align: 'right',
    });

    let rowY = top + tableHeaderHeight;
    invoice.items.forEach((item, index) => {
      const rowHeight = item.description
        ? itemRowHeightWithDesc
        : itemRowHeight;
      if (index % 2 === 1) {
        doc.rect(M, rowY, CONTENT_WIDTH, rowHeight).fill(colors.stripe);
      }
      const textY = rowY + 7 * s;
      doc
        .font('Helvetica-Bold')
        .fontSize(10 * s)
        .fillColor(colors.text)
        .text(item.name, cols.desc.x + 10, textY, { width: cols.desc.w - 10 });
      doc
        .font('Helvetica')
        .fontSize(10 * s)
        .fillColor(colors.text);
      doc.text(String(item.quantity), cols.qty.x, textY, {
        width: cols.qty.w,
        align: 'right',
      });
      doc.text(item.rate.toFixed(2), cols.rate.x, textY, {
        width: cols.rate.w,
        align: 'right',
      });
      doc.text(`${item.taxRate}%`, cols.tax.x, textY, {
        width: cols.tax.w,
        align: 'right',
      });
      doc
        .font('Helvetica-Bold')
        .text((item.amount + item.taxAmount).toFixed(2), cols.amount.x, textY, {
          width: cols.amount.w - 10,
          align: 'right',
        });
      if (item.description) {
        doc
          .font('Helvetica')
          .fontSize(8.5 * s)
          .fillColor(colors.textMuted)
          .text(item.description, cols.desc.x + 10, textY + 14 * s, {
            width: cols.desc.w - 10,
          });
      }
      rowY += rowHeight;
    });

    doc
      .moveTo(M, rowY)
      .lineTo(PAGE_WIDTH - M, rowY)
      .strokeColor(colors.border)
      .lineWidth(1)
      .stroke();
    return rowY + TABLE_BOTTOM_GAP;
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    business: { gstin?: string },
    top: number,
    theme: DocumentTemplateTheme,
  ): number {
    const { colors } = theme;
    const boxWidth = 240;
    const boxX = PAGE_WIDTH - M - boxWidth;
    const labelX = boxX + 16;
    const valueWidth = boxWidth - 32;
    let rowY = top + TOTALS_TOP_GAP;

    const row = (
      label: string,
      value: string,
      opts: { bold?: boolean; color?: string; size?: number } = {},
    ) => {
      const size = opts.size ?? (opts.bold ? 12 : 10);
      doc
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(
          opts.color ?? (opts.bold ? colors.text : colors.textSecondary),
        );
      doc.text(label, labelX, rowY, { width: valueWidth / 2 });
      doc.text(value, labelX + valueWidth / 2, rowY, {
        width: valueWidth / 2,
        align: 'right',
      });
      rowY += opts.bold ? TOTALS_ROW_HEIGHT_BOLD : TOTALS_ROW_HEIGHT;
    };

    row('Subtotal', formatCurrency(invoice.subtotal));
    if (invoice.discount > 0)
      row('Discount', `- ${formatCurrency(invoice.discount)}`);
    if (business.gstin) {
      row('CGST', formatCurrency(invoice.taxTotal / 2));
      row('SGST', formatCurrency(invoice.taxTotal / 2));
    } else {
      row('Tax', formatCurrency(invoice.taxTotal));
    }

    rowY += TOTALS_DIVIDER_GAP;
    doc
      .moveTo(boxX, rowY - TOTALS_DIVIDER_GAP)
      .lineTo(PAGE_WIDTH - M, rowY - TOTALS_DIVIDER_GAP)
      .strokeColor(colors.border)
      .lineWidth(1)
      .stroke();

    row('Total', formatCurrency(invoice.total), {
      bold: true,
      color: colors.primary,
      size: 13,
    });
    row('Amount paid', formatCurrency(invoice.amountPaid));

    const balanceColor =
      invoice.balanceDue > 0 ? colors.dangerText : colors.tintText;
    row('Balance due', formatCurrency(invoice.balanceDue), {
      bold: true,
      color: balanceColor,
    });

    return rowY + TOTALS_BOTTOM_GAP;
  }

  private drawTextBox(
    doc: PDFKit.PDFDocument,
    label: string,
    text: string,
    top: number,
    textHeight: number,
    theme: DocumentTemplateTheme,
  ): number {
    const { colors } = theme;
    const boxHeight = textHeight + NOTES_BOX_PADDING;
    doc.roundedRect(M, top, CONTENT_WIDTH, boxHeight, 6).fill(colors.stripe);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(colors.textMuted)
      .text(label, M + 14, top + 12, { characterSpacing: 1 });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(colors.textSecondary)
      .text(text, M + 14, top + 26, { width: CONTENT_WIDTH - 28 });
    return top + boxHeight + NOTES_BOTTOM_GAP;
  }

  private drawSignatureBlock(
    doc: PDFKit.PDFDocument,
    signature: Buffer,
    top: number,
    theme: DocumentTemplateTheme,
  ): number {
    const { colors } = theme;
    const boxWidth = 160;
    const boxX = PAGE_WIDTH - M - boxWidth;
    const imageHeight = 44;
    doc.image(signature, boxX, top, {
      fit: [boxWidth, imageHeight],
      align: 'center',
    });
    const lineY = top + imageHeight + 6;
    doc
      .moveTo(boxX, lineY)
      .lineTo(boxX + boxWidth, lineY)
      .strokeColor(colors.border)
      .lineWidth(1)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(colors.textMuted)
      .text('Authorized Signatory', boxX, lineY + 6, {
        width: boxWidth,
        align: 'center',
      });
    return lineY + 24;
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    business: { name: string },
    y: number,
    theme: DocumentTemplateTheme,
  ) {
    const { colors } = theme;
    doc
      .moveTo(M, y)
      .lineTo(PAGE_WIDTH - M, y)
      .strokeColor(colors.border)
      .lineWidth(1)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(colors.textMuted)
      .text(`Thank you for your business — ${business.name}`, M, y + 12, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
  }
}
