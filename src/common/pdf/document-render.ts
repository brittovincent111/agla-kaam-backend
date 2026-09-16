import PDFDocument = require('pdfkit');
import { DocumentTemplateColors, DocumentTemplateTheme } from './document-templates';

// The shared PDF engine behind both invoices and quotations.
//
// Two responsibilities live here:
//
//  1. The DocumentSpec — everything a layout needs to draw, with no notion of
//     whether it came from an invoice or a quotation. Invoice and quotation
//     used to be a pair of ~660-line near-identical renderers, which is why
//     the five "templates" could only ever be colour swaps: real layout work
//     would have had to be written twice and kept in sync by hand.
//
//  2. Pagination. A layout draws through a Canvas rather than straight onto
//     the document, so an invoice with sixty line items flows onto as many
//     pages as it needs, repeating its table header and numbering its pages,
//     instead of running off the bottom of page one.

export interface PageGeometry {
  width: number;
  height: number;
  margin: number;
}

export const A4: PageGeometry = { width: 595.28, height: 841.89, margin: 42 };
export const LETTER: PageGeometry = { width: 612, height: 792, margin: 42 };

export const PAGE_SIZES: Record<string, PageGeometry> = { A4, LETTER };

// Reserved strip at the foot of every page for the footer rule + page number.
export const FOOTER_RESERVE = 54;

export interface RenderBusiness {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  tradeType?: string;
  country?: string;
  currency?: string;
  taxType?: string;
  taxRegistrationNumber?: string;
  gstin?: string;
  logo?: Buffer;
  signature?: Buffer;
  // Payment instructions — every field optional; the block is skipped
  // entirely when a business has set none.
  paymentUpiId?: string;
  paymentQrContent?: string;
  paymentQrBuffer?: Buffer;
  bankDetails?: string;
  paymentBankName?: string;
  paymentAccountNumber?: string;
  paymentAccountCode?: string;
  acceptsCash?: boolean;
  // Master switch — see Business.showPaymentDetailsOnInvoice. Undefined is
  // treated as on, so a business created before this existed is unaffected.
  showPaymentDetailsOnInvoice?: boolean;
}

export interface RenderCustomer {
  name: string;
  phone: string;
  address?: string;
  gstin?: string;
  taxRegistrationNumber?: string;
}

export interface RenderItem {
  name: string;
  description?: string;
  // HSN/SAC — the GST classification code, copied onto the line from the
  // inventory item it was added from. Not the SKU: an SKU is the business's
  // own stock code and means nothing to a customer or a tax officer.
  hsn?: string;
  quantity: number;
  rate: number;
  taxRate: number;
  amount: number;
  taxAmount: number;
}

export type TotalRowStyle = 'normal' | 'grand' | 'strong';
export type TotalRowColor = 'default' | 'primary' | 'danger' | 'success';

export interface RenderTotalRow {
  label: string;
  value: number;
  style?: TotalRowStyle;
  color?: TotalRowColor;
  // Rendered as "- 1,234.00". Kept as a flag rather than a negative number so
  // the caller doesn't have to negate a stored discount that is positive.
  negative?: boolean;
  ruleAbove?: boolean;
}

export type StatusTone = 'neutral' | 'urgent' | 'positive' | 'danger';

export interface RenderStatus {
  label: string;
  tone: StatusTone;
}

// Field-service context, shown by the Compact layout. Every field is
// optional and resolved from the services an invoice's line items actually
// reference — nothing here is invented when an invoice has no linked service.
export interface RenderServiceContext {
  technicianName?: string;
  serviceDate?: Date;
  nextServiceDate?: Date;
  jobReference?: string;
  serviceNotes?: string;
}

export interface RenderPaymentSummary {
  method?: string;
  paidLabel?: string;
}

export interface DocumentSpec {
  title: string;
  number: string;
  // 'Invoice No.' / 'Quotation No.' — layouts that show the number inside a
  // metadata block label it with this; the ones that headline the number
  // (Modern, Compact) omit the row instead of printing it twice.
  numberLabel: string;
  recipientLabel: string;
  status: RenderStatus;
  metaRows: { label: string; value: string }[];
  items: RenderItem[];
  totals: RenderTotalRow[];
  // The grand total, for the layouts that give it its own emphasis (a filled
  // bar, the amount in words). Separate from `totals` so a layout can pull it
  // out without pattern-matching on labels.
  grandTotal: number;
  notes?: string;
  terms?: string;
  paymentTerms?: string;
  currency: string;
  taxType: string;
  country: string;
  footerNote: string;
  serviceContext?: RenderServiceContext;
  payment?: RenderPaymentSummary;
  // True when at least one line carries tax — lets a layout drop the whole
  // tax column on a zero-tax invoice instead of printing a column of "0%".
  hasTax: boolean;
  taxLabel: string;
  // Optional blocks the business has switched off for THIS document type
  // (quotationShowSignature and friends). Omitted means show everything, so
  // every existing caller keeps its current output.
  show?: { signature?: boolean; hsn?: boolean; serviceAddress?: boolean };
  // Overrides the items column header. A purchase order is not a service
  // call, so "SERVICE / ITEM" is wrong on one.
  itemLabel?: string;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: 'Rs. ',
  AED: 'AED ',
  SAR: 'SAR ',
  QAR: 'QAR ',
  OMR: 'OMR ',
  KWD: 'KWD ',
  BHD: 'BHD ',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

// Gulf currencies are quoted to 3 decimals; everything else to 2.
const THREE_DECIMAL_CURRENCIES = new Set(['OMR', 'KWD', 'BHD']);

export function currencyDecimals(currencyCode = 'INR'): number {
  return THREE_DECIMAL_CURRENCIES.has((currencyCode || 'INR').toUpperCase()) ? 3 : 2;
}

export function currencySymbol(currencyCode = 'INR'): string {
  const code = (currencyCode || 'INR').toUpperCase();
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

export function formatCurrency(amount: number, currencyCode = 'INR'): string {
  const digits = currencyDecimals(currencyCode);
  return `${currencySymbol(currencyCode)}${amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

// Bare number, no symbol — for table cells sitting under a column header that
// already names the currency.
export function formatAmount(amount: number, currencyCode = 'INR'): string {
  const digits = currencyDecimals(currencyCode);
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDate(date: Date, countryCode = 'IN'): string {
  const locale = countryCode === 'US' ? 'en-US' : 'en-GB';
  return new Date(date).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function statusStyle(
  tone: StatusTone,
  colors: DocumentTemplateColors,
): { bg: string; text: string } {
  switch (tone) {
    case 'positive':
      return { bg: colors.tintBg, text: colors.tintText };
    case 'urgent':
      return { bg: colors.urgencyBg, text: colors.urgencyText };
    case 'danger':
      return { bg: colors.dangerBg, text: colors.dangerText };
    default:
      return { bg: '#EFEEEB', text: colors.textSecondary };
  }
}

export function totalRowColor(
  color: TotalRowColor | undefined,
  colors: DocumentTemplateColors,
  fallback: string,
): string {
  switch (color) {
    case 'primary':
      // primaryInk, not primary: this is drawn as text on white, where a pale
      // brand accent would be unreadable.
      return colors.primaryInk;
    case 'danger':
      return colors.dangerText;
    case 'success':
      return colors.tintText;
    default:
      return fallback;
  }
}

// Metadata rows with the document number prepended — for the layouts that do
// not headline the number separately.
export function metaRowsWithNumber(
  spec: DocumentSpec,
): { label: string; value: string }[] {
  return [{ label: spec.numberLabel, value: spec.number }, ...spec.metaRows];
}

export function taxIdLabel(taxType: string, country?: string): string {
  if (taxType === 'vat') return country === 'AE' ? 'TRN' : 'VAT No.';
  if (taxType === 'sales_tax') return 'Tax ID';
  return 'GSTIN';
}

// IFSC in India, IBAN across the Gulf, routing number in the US — the field
// is one thing in the data model and needs the right name on the page.
export function accountCodeLabel(country?: string): string {
  if (country === 'IN') return 'IFSC';
  if (country === 'US') return 'Routing No.';
  return 'IBAN';
}

export function businessTaxId(business: RenderBusiness): string | undefined {
  return business.taxRegistrationNumber || business.gstin;
}

export function customerTaxId(customer: RenderCustomer): string | undefined {
  return customer.taxRegistrationNumber || customer.gstin;
}

export interface PaymentLine {
  label: string;
  value: string;
}

// Only the instructions a business has actually filled in, and only when it
// wants them printed. This is the one place every layout asks for the payment
// block, so the switch is honoured by all five without each one checking.
//
// It deliberately does NOT gate the record of how an invoice *was* paid
// (Compact's payment method and status) — that is a fact about the invoice,
// not standing instructions the business chooses to publish.
/**
 * The business as THIS document type should show it: whatever its
 * *ShowBankInfo / *ShowUpiInfo settings have switched off is stripped, so
 * paymentLines() and the QR block simply find nothing to draw.
 *
 * Done by narrowing the business rather than threading flags through the
 * five layouts, each of which calls paymentLines() itself and would
 * otherwise have to remember to check.
 */
/**
 * Document line items as the renderer wants them. The only translation is
 * the HSN field name: every document schema stores it as `hsnCode`, while
 * RenderItem calls it `hsn` alongside the other presentation fields.
 */
export function toRenderItems(
  items: (Omit<RenderItem, "hsn"> & { hsnCode?: string })[],
): RenderItem[] {
  return items.map((item) => ({ ...item, hsn: item.hsnCode }));
}

export function applyPaymentVisibility(
  business: RenderBusiness,
  show: { bank?: boolean; upi?: boolean },
): RenderBusiness {
  if (show.bank !== false && show.upi !== false) return business;
  const next: RenderBusiness = { ...business };
  if (show.upi === false) {
    next.paymentUpiId = undefined;
    next.paymentQrContent = undefined;
    next.paymentQrBuffer = undefined;
  }
  if (show.bank === false) {
    next.bankDetails = undefined;
    next.paymentBankName = undefined;
    next.paymentAccountNumber = undefined;
    next.paymentAccountCode = undefined;
  }
  return next;
}

export function paymentLines(business: RenderBusiness): PaymentLine[] {
  if (business.showPaymentDetailsOnInvoice === false) return [];
  const lines: PaymentLine[] = [];
  if (business.paymentQrContent) {
    lines.push({ label: 'Pay QR', value: 'Scan QR Code on invoice to pay' });
  }
  if (business.paymentUpiId) lines.push({ label: 'UPI', value: business.paymentUpiId });
  if (business.bankDetails) {
    lines.push({ label: 'Bank', value: business.bankDetails });
  } else {
    if (business.paymentBankName || business.paymentAccountNumber) {
      const value = [business.paymentBankName, business.paymentAccountNumber]
        .filter(Boolean)
        .join(' · ');
      lines.push({ label: 'Bank', value });
    }
    if (business.paymentAccountCode) {
      lines.push({
        label: accountCodeLabel(business.country),
        value: business.paymentAccountCode,
      });
    }
  }
  if (business.acceptsCash) lines.push({ label: 'Cash', value: 'Accepted' });
  return lines;
}

// ---------------------------------------------------------------------------
// Canvas — pagination
// ---------------------------------------------------------------------------

export interface Ctx {
  doc: PDFKit.PDFDocument;
  theme: DocumentTemplateTheme;
  colors: DocumentTemplateColors;
  business: RenderBusiness;
  customer: RenderCustomer;
  spec: DocumentSpec;
  geo: PageGeometry;
  canvas: Canvas;
}

// Drawn at the top of every page after the first. A layout supplies one so a
// continuation page still identifies the document, and returns the y its body
// may start at.
export type ContinuationPainter = (ctx: Ctx) => number;

export class Canvas {
  y = 0;
  pageCount = 1;
  // Set by the layout once its first-page header is drawn.
  contentX: number;
  contentWidth: number;
  bottom: number;

  private continuation: ContinuationPainter | null = null;
  private ctx: Ctx | null = null;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly geo: PageGeometry,
  ) {
    this.contentX = geo.margin;
    this.contentWidth = geo.width - geo.margin * 2;
    this.bottom = geo.height - FOOTER_RESERVE;
  }

  attach(ctx: Ctx, continuation: ContinuationPainter): void {
    this.ctx = ctx;
    this.continuation = continuation;
  }

  // Reserves `height` of vertical space, breaking to a new page when the
  // current one cannot hold it. Every block a layout draws goes through this,
  // which is what keeps content off the footer and out of the page edge.
  ensure(height: number): void {
    if (this.y + height <= this.bottom) return;
    this.newPage();
  }

  newPage(): void {
    this.doc.addPage();
    this.pageCount += 1;
    this.y =
      this.continuation && this.ctx
        ? this.continuation(this.ctx)
        : this.geo.margin;
  }

  get remaining(): number {
    return this.bottom - this.y;
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export function measureText(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  font: string,
  size: number,
): number {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width });
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export type ColumnAlign = 'left' | 'right' | 'center';

export interface TableColumn {
  key: string;
  label: string;
  align: ColumnAlign;
  // Proportional weight of the leftover width after fixed columns are placed.
  flex?: number;
  width?: number;
}

export interface ResolvedColumn extends TableColumn {
  x: number;
  w: number;
}

// Horizontal padding actually usable by a column. A fixed 10pt each side is
// right for a wide description column and nonsense for a 24pt "#" column —
// it left 4pt of usable width, which wrapped "12" onto two lines and silently
// inflated every row height (and so the page count) on a long invoice.
export function columnPad(col: ResolvedColumn, requested: number): number {
  // Reserve ~16pt of usable width before padding gets a say, so a narrow
  // fixed column ("#", "QTY") keeps enough room for its content on one line.
  // At 8pt of padding each side a 24pt "#" column left 8pt of usable width,
  // which wrapped row number "15" onto two lines.
  return Math.max(1, Math.min(requested, (col.w - 16) / 2));
}

// The column a line's description belongs under. NOT simply cols[0] — the
// layouts that lead with a narrow "#" column would measure and draw the
// description into 8pt of usable width, wrapping one sentence onto forty
// lines and quietly turning a 2-page invoice into a 7-page one.
export function descriptionColumn(cols: ResolvedColumn[]): ResolvedColumn {
  return cols.find((col) => col.key === 'name') ?? cols[cols.length > 1 ? 1 : 0];
}

export function resolveColumns(
  columns: TableColumn[],
  x: number,
  totalWidth: number,
): ResolvedColumn[] {
  const fixed = columns.reduce((sum, col) => sum + (col.width ?? 0), 0);
  const flexTotal = columns.reduce((sum, col) => sum + (col.flex ?? 0), 0);
  const free = Math.max(0, totalWidth - fixed);

  let cursor = x;
  return columns.map((col) => {
    const w = col.width ?? (flexTotal > 0 ? (free * (col.flex ?? 0)) / flexTotal : 0);
    const resolved = { ...col, x: cursor, w };
    cursor += w;
    return resolved;
  });
}

export interface TableRowContent {
  cells: Record<string, string>;
  description?: string;
}

export interface TableStyle {
  // Row padding and font sizes, scaled for the dense layout.
  scale: number;
  cellPadX: number;
  headerHeight: number;
  zebra: boolean;
  rowRule: boolean;
  columnRules: boolean;
  outerBorder: boolean;
  headerFill: 'accent' | 'tint' | 'none';
  headerRule: boolean;
}

export const DEFAULT_TABLE_STYLE: TableStyle = {
  scale: 1,
  cellPadX: 10,
  headerHeight: 26,
  zebra: true,
  rowRule: false,
  columnRules: false,
  outerBorder: false,
  headerFill: 'tint',
  headerRule: false,
};

function drawTableHeader(
  ctx: Ctx,
  cols: ResolvedColumn[],
  x: number,
  width: number,
  y: number,
  style: TableStyle,
): number {
  const { doc, colors } = ctx;
  const s = style.scale;
  const height = style.headerHeight * s;

  if (style.headerFill === 'accent') {
    doc.rect(x, y, width, height).fill(colors.primary);
  } else if (style.headerFill === 'tint') {
    doc.rect(x, y, width, height).fill(colors.tintBg);
  }

  const labelColor =
    style.headerFill === 'accent'
      ? colors.onPrimary
      : style.headerFill === 'tint'
        ? colors.tintText
        : colors.textMuted;

  doc.font('Helvetica-Bold').fontSize(8 * s).fillColor(labelColor);
  cols.forEach((col) => {
    const pad = columnPad(col, style.cellPadX * s);
    doc.text(col.label, col.x + pad, y + height / 2 - 4 * s, {
      width: Math.max(1, col.w - pad * 2),
      align: col.align,
      characterSpacing: 0.4,
    });
  });

  if (style.headerRule) {
    doc
      .moveTo(x, y + height)
      .lineTo(x + width, y + height)
      .strokeColor(colors.text)
      .lineWidth(1)
      .stroke();
  }

  return y + height;
}

function measureRow(
  ctx: Ctx,
  cols: ResolvedColumn[],
  row: TableRowContent,
  style: TableStyle,
): { height: number; descTop: number } {
  const { doc } = ctx;
  const s = style.scale;
  const padY = 7 * s;
  const descCol = descriptionColumn(cols);
  const textWidth = Math.max(
    1,
    descCol.w - columnPad(descCol, style.cellPadX * s) * 2,
  );

  let tallest = 0;
  cols.forEach((col) => {
    const value = row.cells[col.key] ?? '';
    const w = Math.max(1, col.w - columnPad(col, style.cellPadX * s) * 2);
    const h = measureText(doc, value, w, 'Helvetica', 9.5 * s);
    if (h > tallest) tallest = h;
  });

  if (!row.description) {
    return { height: Math.max(22 * s, padY * 2 + tallest), descTop: 0 };
  }
  const gap = 3 * s;
  const descHeight = measureText(doc, row.description, textWidth, 'Helvetica', 8 * s);
  return {
    height: Math.max(30 * s, padY * 2 + tallest + gap + descHeight),
    descTop: tallest + gap,
  };
}

// Draws an item table that flows across as many pages as it needs, repeating
// its column header on every continuation page. Returns the y below the table.
export function drawTable(
  ctx: Ctx,
  columns: TableColumn[],
  rows: TableRowContent[],
  style: TableStyle,
): number {
  const { doc, colors, canvas } = ctx;
  const s = style.scale;
  const x = canvas.contentX;
  const width = canvas.contentWidth;
  const cols = resolveColumns(columns, x, width);

  // The header must fit with at least one row under it, or it belongs on the
  // next page rather than stranded at the foot of this one.
  const firstRowHeight = rows.length ? measureRow(ctx, cols, rows[0], style).height : 0;
  canvas.ensure(style.headerHeight * s + firstRowHeight);

  let bodyTop = drawTableHeader(ctx, cols, x, width, canvas.y, style);
  canvas.y = bodyTop;
  let sectionTop = bodyTop;
  let zebraIndex = 0;

  const closeSection = (endY: number) => {
    if (style.columnRules) {
      cols.slice(1).forEach((col) => {
        doc
          .moveTo(col.x, sectionTop)
          .lineTo(col.x, endY)
          .strokeColor(colors.border)
          .lineWidth(0.6)
          .stroke();
      });
    }
    if (style.outerBorder) {
      doc
        .rect(x, sectionTop - style.headerHeight * s, width, endY - sectionTop + style.headerHeight * s)
        .strokeColor(colors.border)
        .lineWidth(0.8)
        .stroke();
    }
  };

  rows.forEach((row) => {
    const metrics = measureRow(ctx, cols, row, style);

    if (canvas.y + metrics.height > canvas.bottom) {
      closeSection(canvas.y);
      canvas.newPage();
      bodyTop = drawTableHeader(ctx, cols, x, width, canvas.y, style);
      canvas.y = bodyTop;
      sectionTop = bodyTop;
      zebraIndex = 0;
    }

    const rowY = canvas.y;
    if (style.zebra && zebraIndex % 2 === 1) {
      doc.rect(x, rowY, width, metrics.height).fill(colors.stripe);
    }

    const textY = rowY + 7 * s;
    cols.forEach((col, colIndex) => {
      const value = row.cells[col.key] ?? '';
      const pad = columnPad(col, style.cellPadX * s);
      doc
        .font(colIndex === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9.5 * s)
        .fillColor(colors.text)
        .text(value, col.x + pad, textY, {
          width: Math.max(1, col.w - pad * 2),
          align: col.align,
        });
    });

    if (row.description) {
      const descCol = descriptionColumn(cols);
      const pad = columnPad(descCol, style.cellPadX * s);
      doc
        .font('Helvetica')
        .fontSize(8 * s)
        .fillColor(colors.textMuted)
        .text(row.description, descCol.x + pad, textY + metrics.descTop, {
          width: Math.max(1, descCol.w - pad * 2),
        });
    }

    if (style.rowRule) {
      doc
        .moveTo(x, rowY + metrics.height)
        .lineTo(x + width, rowY + metrics.height)
        .strokeColor(colors.border)
        .lineWidth(0.5)
        .stroke();
    }

    canvas.y = rowY + metrics.height;
    zebraIndex += 1;
  });

  closeSection(canvas.y);

  if (!style.rowRule && !style.outerBorder) {
    doc
      .moveTo(x, canvas.y)
      .lineTo(x + width, canvas.y)
      .strokeColor(colors.border)
      .lineWidth(1)
      .stroke();
  }

  return canvas.y;
}

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

export function drawLogoBadge(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  mode: 'on-color' | 'on-white',
): void {
  const { doc, colors, business } = ctx;

  if (mode === 'on-color') {
    doc.circle(cx, cy, radius).fill(colors.onPrimary);
  } else {
    doc.circle(cx, cy, radius).lineWidth(1.2).strokeColor(colors.primaryInk).stroke();
  }

  if (business.logo) {
    doc.save();
    doc.circle(cx, cy, radius).clip();
    doc.image(business.logo, cx - radius, cy - radius, {
      fit: [radius * 2, radius * 2],
      align: 'center',
      valign: 'center',
    });
    doc.restore();
    return;
  }

  const initial = (business.name?.trim()?.[0] ?? '?').toUpperCase();
  doc
    .fillColor(colors.primaryInk)
    .font('Helvetica-Bold')
    .fontSize(radius * 0.95)
    .text(initial, cx - radius, cy - radius * 0.45, {
      width: radius * 2,
      align: 'center',
    });
}

export function drawStatusPill(
  ctx: Ctx,
  rightEdge: number,
  y: number,
  scale = 1,
): number {
  const { doc, colors, spec } = ctx;
  const style = statusStyle(spec.status.tone, colors);
  doc.font('Helvetica-Bold').fontSize(8 * scale);
  const textWidth = doc.widthOfString(spec.status.label, { characterSpacing: 0.5 });
  const pillWidth = textWidth + 22 * scale;
  const pillHeight = 19 * scale;
  const pillX = rightEdge - pillWidth;
  doc.roundedRect(pillX, y, pillWidth, pillHeight, pillHeight / 2).fill(style.bg);
  doc.fillColor(style.text).text(spec.status.label, pillX, y + 5.5 * scale, {
    width: pillWidth,
    align: 'center',
    characterSpacing: 0.5,
  });
  return pillWidth;
}

// A small uppercase section label. Returns the y beneath it.
export function drawSectionLabel(
  ctx: Ctx,
  label: string,
  x: number,
  y: number,
  width: number,
  color?: string,
): number {
  const { doc, colors } = ctx;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(color ?? colors.textMuted)
    .text(label, x, y, { width, characterSpacing: 1 });
  return y + 13;
}

// Name / phone / address / tax id. Returns the y beneath the block.
export function drawPartyBlock(
  ctx: Ctx,
  party: { name: string; phone?: string; address?: string; taxId?: string },
  x: number,
  y: number,
  width: number,
  opts: { nameSize?: number; compact?: boolean } = {},
): number {
  const { doc, colors, spec } = ctx;
  const nameSize = opts.nameSize ?? 12;
  const gap = opts.compact ? 2 : 3;
  let cursor = y;

  doc.font('Helvetica-Bold').fontSize(nameSize).fillColor(colors.text);
  doc.text(party.name, x, cursor, { width });
  cursor = doc.y + gap;

  doc.font('Helvetica').fontSize(9).fillColor(colors.textSecondary);
  if (party.phone) {
    doc.text(party.phone, x, cursor, { width });
    cursor = doc.y + 1;
  }
  if (party.address) {
    doc.text(party.address, x, cursor, { width });
    cursor = doc.y + 1;
  }
  if (party.taxId) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(colors.textSecondary)
      .text(`${taxIdLabel(spec.taxType, spec.country)}: ${party.taxId}`, x, cursor + 2, {
        width,
      });
    cursor = doc.y;
  }
  return cursor;
}

export interface TotalsStyle {
  x: number;
  width: number;
  scale?: number;
  inverted?: boolean;
  // 'bar' fills the grand-total row with the accent.
  grand?: 'plain' | 'bar' | 'double';
  labelColor?: string;
  valueColor?: string;
}

export function measureTotals(ctx: Ctx, style: TotalsStyle): number {
  const s = style.scale ?? 1;
  return ctx.spec.totals.reduce((sum, row) => {
    const isStrong = row.style === 'grand' || row.style === 'strong';
    return sum + (isStrong ? 24 : 17) * s + (row.ruleAbove ? 6 * s : 0);
  }, 8 * s);
}

export function drawTotals(ctx: Ctx, top: number, style: TotalsStyle): number {
  const { doc, colors, spec } = ctx;
  const s = style.scale ?? 1;
  const inverted = style.inverted ?? false;
  const grandMode = style.grand ?? 'plain';
  let y = top;

  spec.totals.forEach((row) => {
    const isGrand = row.style === 'grand';
    const isStrong = isGrand || row.style === 'strong';
    const rowHeight = (isStrong ? 24 : 17) * s;

    if (row.ruleAbove) {
      const ruleY = y + 2 * s;
      doc
        .moveTo(style.x, ruleY)
        .lineTo(style.x + style.width, ruleY)
        .strokeColor(inverted ? colors.onPrimaryMuted : colors.border)
        .lineWidth(grandMode === 'double' ? 0.8 : 1)
        .stroke();
      if (grandMode === 'double') {
        doc
          .moveTo(style.x, ruleY + 2.2)
          .lineTo(style.x + style.width, ruleY + 2.2)
          .strokeColor(colors.text)
          .lineWidth(0.8)
          .stroke();
      }
      y += 6 * s;
    }

    const barred = isGrand && grandMode === 'bar';
    if (barred) {
      doc.rect(style.x, y, style.width, rowHeight).fill(colors.primary);
    }

    const labelColor = barred
      ? colors.onPrimary
      : style.labelColor ??
        (inverted
          ? isStrong
            ? colors.onPrimary
            : colors.onPrimaryMuted
          : totalRowColor(
              row.color,
              colors,
              isStrong ? colors.text : colors.textSecondary,
            ));
    const valueColor = barred
      ? colors.onPrimary
      : style.valueColor ?? labelColor;

    const pad = barred ? 10 * s : 0;
    const textY = y + (rowHeight - (isGrand ? 12 : isStrong ? 11 : 9.5) * s) / 2;

    doc
      .font(isStrong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize((isGrand ? 12 : isStrong ? 11 : 9.5) * s)
      .fillColor(labelColor)
      .text(row.label, style.x + pad, textY, { width: style.width / 2 - pad });

    const value = `${row.negative ? '- ' : ''}${formatCurrency(row.value, spec.currency)}`;
    doc
      .fillColor(valueColor)
      .text(value, style.x + style.width / 2, textY, {
        width: style.width / 2 - pad,
        align: 'right',
      });

    y += rowHeight;
  });

  return y;
}

export interface PanelOptions {
  x: number;
  width: number;
  variant: 'filled' | 'boxed' | 'ruled';
  scale?: number;
}

// A labelled block of body text (Notes, Terms). Breaks to a new page as a unit
// when it does not fit, rather than splitting mid-sentence.
export function drawTextPanel(
  ctx: Ctx,
  label: string,
  text: string,
  opts: PanelOptions,
): void {
  const { doc, colors, canvas } = ctx;
  const s = opts.scale ?? 1;
  const pad = 12 * s;
  const textWidth = opts.width - pad * 2;
  const textHeight = measureText(doc, text, textWidth, 'Helvetica', 9 * s);
  const height = textHeight + 32 * s;

  canvas.ensure(height + 10 * s);
  const top = canvas.y;

  if (opts.variant === 'filled') {
    doc.roundedRect(opts.x, top, opts.width, height, 4).fill(colors.stripe);
  } else if (opts.variant === 'boxed') {
    doc
      .rect(opts.x, top, opts.width, height)
      .lineWidth(0.8)
      .strokeColor(colors.border)
      .stroke();
  } else {
    doc
      .moveTo(opts.x, top)
      .lineTo(opts.x + opts.width, top)
      .lineWidth(0.8)
      .strokeColor(colors.border)
      .stroke();
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(8 * s)
    .fillColor(colors.textMuted)
    .text(label, opts.x + pad, top + 10 * s, { characterSpacing: 1 });
  doc
    .font('Helvetica')
    .fontSize(9 * s)
    .fillColor(colors.textSecondary)
    .text(text, opts.x + pad, top + 22 * s, { width: textWidth });

  canvas.y = top + height + 12 * s;
}

export function drawPaymentBlock(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  opts: { scale?: number; labelColor?: string } = {},
): number {
  const { doc, colors, business } = ctx;
  const lines = paymentLines(business);
  if (!lines.length && !business.paymentQrBuffer) return y;
  const s = opts.scale ?? 1;

  let cursor = drawSectionLabel(ctx, 'PAYMENT INFORMATION', x, y, width, opts.labelColor);
  const textWidth = business.paymentQrBuffer ? width - 75 * s : width;
  lines.forEach((line) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5 * s)
      .fillColor(colors.textSecondary)
      .text(`${line.label}`, x, cursor, { width: 60 * s });
    doc
      .font('Helvetica')
      .fontSize(8.5 * s)
      .fillColor(colors.text)
      .text(line.value, x + 62 * s, cursor, { width: textWidth - 62 * s });
    cursor = doc.y + 2;
  });

  if (business.paymentQrBuffer) {
    const qrSize = 65 * s;
    const qrX = x + width - qrSize;
    doc.image(business.paymentQrBuffer, qrX, y, {
      fit: [qrSize, qrSize],
      align: 'center',
      valign: 'center',
    });
    if (y + qrSize > cursor) cursor = y + qrSize + 4;
  }
  return cursor;
}

// Height the signature block will occupy. A business with no uploaded
// signature needs only the rule and its caption — reserving the full image
// slot regardless wasted 40pt at the foot of every document, which was
// enough on its own to push a short invoice onto a second page.
export function measureSignature(ctx: Ctx): number {
  if (ctx.spec.show?.signature === false) return 0;
  return ctx.business.signature ? 74 : 34;
}

export function drawSignatureBlock(
  ctx: Ctx,
  top: number,
  rightEdge: number,
  boxWidth = 150,
): number {
  // Gated here rather than at the five layout call sites, so every layout
  // honours the setting without each having to remember to check it.
  if (ctx.spec.show?.signature === false) return top;
  const { doc, colors, business } = ctx;
  const boxX = rightEdge - boxWidth;
  const imageHeight = business.signature ? 40 : 0;
  if (business.signature) {
    doc.image(business.signature, boxX, top, {
      fit: [boxWidth, imageHeight],
      align: 'center',
    });
  }
  const lineY = top + imageHeight + 6;
  doc
    .moveTo(boxX, lineY)
    .lineTo(boxX + boxWidth, lineY)
    .strokeColor(colors.border)
    .lineWidth(1)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(colors.textMuted)
    .text('Authorised Signatory', boxX, lineY + 5, {
      width: boxWidth,
      align: 'center',
    });
  return lineY + 22;
}

// The single effective tax rate, when every taxed line shares one — which is
// the normal case for a service business, and lets the totals row read
// "GST (18%)" instead of a bare "GST". Returns null for a mixed-rate invoice,
// where naming one rate would misstate the others.
export function uniformTaxRate(items: RenderItem[]): number | null {
  const rates = new Set(items.filter((item) => item.taxRate > 0).map((item) => item.taxRate));
  return rates.size === 1 ? [...rates][0] : null;
}

// Base name for the tax, from the business's configured tax type.
export function taxTypeName(taxType: string): string {
  if (taxType === 'vat') return 'VAT';
  if (taxType === 'gst') return 'GST';
  if (taxType === 'sales_tax') return 'Sales Tax';
  return 'Tax';
}

function rateSuffix(rate: number | null): string {
  if (rate === null) return '';
  // 18 -> "18", 12.5 -> "12.5"
  return ` (${Number(rate.toFixed(2))}%)`;
}

// Builds the tax rows for a totals stack. Shared so an invoice and a quotation
// split GST/VAT identically instead of each deciding for itself. Indian GST on
// an intra-state supply is halved into CGST + SGST, each at half the rate.
export function buildTaxRows(
  taxType: string,
  taxTotal: number,
  items: RenderItem[],
): RenderTotalRow[] {
  if (taxType === 'none' || taxTotal === 0) return [];
  const rate = uniformTaxRate(items);

  if (taxType === 'gst') {
    const half = rate === null ? null : rate / 2;
    return [
      { label: `CGST${rateSuffix(half)}`, value: taxTotal / 2 },
      { label: `SGST${rateSuffix(half)}`, value: taxTotal / 2 },
    ];
  }
  return [{ label: `${taxTypeName(taxType)}${rateSuffix(rate)}`, value: taxTotal }];
}
