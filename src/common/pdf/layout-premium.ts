import {
  Ctx,
  DEFAULT_TABLE_STYLE,
  RenderItem,
  RenderTotalRow,
  TableColumn,
  TableRowContent,
  businessTaxId,
  customerTaxId,
  drawTable,
  drawTopMessage,
  drawTotals,
  formatAmount,
  formatCurrency,
  formatDate,
  measureText,
  measureTotals,
  metaRowsWithNumber,
  paymentLines,
  resolveColumns,
  gstHalves,
  splitGst,
  statusStyle,
  taxIdLabel,
  taxSummary,
  taxTypeName,
} from './document-render';
import { amountInWords } from './amount-in-words';
import { gstStateCode } from './place-of-supply';
import type { LayoutDefinition } from './document-layouts';

// PREMIUM — the showcase tax invoice, for paid plans.
//
// A full-bleed brand band carries the identity and the document's own facts
// (number, dates, place of supply); Bill From and Bill To sit in matching
// boxes under it; then a bordered item table that closes on a totals row, the
// amount in words beside the totals, a grand-total bar, and a per-rate tax
// summary. Payment details, terms and the signatory close the document.
//
// What varies by country is decided upstream and only presented here: the
// tax id's name (GSTIN / TRN / VAT No.), CGST + SGST versus IGST versus VAT,
// the place-of-supply row, the currency and its decimals, and the amount in
// words' numbering system.

const BAND_TOP_PAD = 30;
const BOX_GAP = 14;
const SIDE_GAP = 18;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words[0][0] + words[1][0]
      : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function stateLine(state?: string): string | undefined {
  if (!state) return undefined;
  const code = gstStateCode(state);
  return code ? `State: ${state} (${code})` : `State: ${state}`;
}

// ---------------------------------------------------------------------------
// Masthead
// ---------------------------------------------------------------------------

function drawLogoTile(ctx: Ctx, x: number, y: number, size: number): void {
  const { doc, colors, business } = ctx;
  if (business.logo) {
    doc.roundedRect(x, y, size, size, 9).fill('#FFFFFF');
    doc.save();
    doc.roundedRect(x + 3, y + 3, size - 6, size - 6, 7).clip();
    doc.image(business.logo, x + 3, y + 3, {
      fit: [size - 6, size - 6],
      align: 'center',
      valign: 'center',
    });
    doc.restore();
    return;
  }
  doc.save();
  doc.fillOpacity(0.18).roundedRect(x, y, size, size, 9).fill(colors.onPrimary);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(size * 0.38)
    .fillColor(colors.onPrimary)
    .text(initials(business.name), x, y + size * 0.31, {
      width: size,
      align: 'center',
    });
}

function drawMasthead(ctx: Ctx): number {
  const { doc, colors, geo, business, spec } = ctx;
  const x = geo.margin;
  const width = geo.width - geo.margin * 2;
  const leftW = width * 0.52;
  const rightW = width * 0.44;
  const rightX = x + width - rightW;

  // Measure both halves first: the band has to be painted before the text
  // that sits on it, and it must be tall enough for whichever half is longer.
  // Logo beside the name rather than above it: stacked, the band grew tall
  // enough on its own to push a three-line invoice onto a second page.
  const LOGO = 46;
  const nameX = x + LOGO + 12;
  const nameW = leftW - LOGO - 12;
  const nameH = measureText(doc, business.name, nameW, 'Helvetica-Bold', 17);
  const subLines = [business.tradeType, business.website].filter(
    Boolean,
  ) as string[];
  const subH = subLines.reduce(
    (sum, line) => sum + measureText(doc, line, nameW, 'Helvetica', 8.5) + 1,
    0,
  );
  const textH = nameH + (subLines.length ? 3 + subH : 0);
  const nameTop = BAND_TOP_PAD + Math.max(0, (LOGO - textH) / 2);
  const leftBottom = Math.max(BAND_TOP_PAD + LOGO, nameTop + textH);

  const meta = metaRowsWithNumber(spec);
  if (spec.paymentTerms)
    meta.push({ label: 'Payment Terms', value: spec.paymentTerms });
  const titleSize = spec.title.length > 12 ? 20 : 25;
  const metaTop = BAND_TOP_PAD + titleSize + 14;
  const rightBottom = metaTop + meta.length * 14;

  const bandH = Math.max(leftBottom, rightBottom) + 16;
  doc.rect(0, 0, geo.width, bandH).fill(colors.primary);

  // --- Identity ---------------------------------------------------------
  drawLogoTile(ctx, x, BAND_TOP_PAD, LOGO);
  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(colors.onPrimary)
    .text(business.name, nameX, nameTop, { width: nameW });
  let ly = doc.y + 3;
  subLines.forEach((line) => {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(colors.onPrimaryMuted)
      .text(line, nameX, ly, { width: nameW });
    ly = doc.y + 1;
  });

  // --- Title, status and the document's facts ----------------------------
  doc.font('Helvetica-Bold').fontSize(titleSize);
  const titleW = doc.widthOfString(spec.title, { characterSpacing: 0.6 });
  doc.fillColor(colors.onPrimary).text(spec.title, rightX, BAND_TOP_PAD - 2, {
    width: rightW,
    align: 'right',
    characterSpacing: 0.6,
    lineBreak: false,
  });
  // The status sits beside the title, on its baseline side.
  drawBandPill(ctx, x + width - titleW - 10, BAND_TOP_PAD + titleSize * 0.2);

  let my = metaTop;
  meta.forEach((row) => {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(colors.onPrimaryMuted)
      .text(row.label, rightX, my, { width: rightW * 0.45, lineBreak: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(colors.onPrimary)
      .text(row.value, rightX + rightW * 0.45, my, {
        width: rightW * 0.55,
        align: 'right',
        lineBreak: false,
      });
    my += 14;
  });

  return bandH;
}

// The status, as a solid pill that reads on any brand colour.
function drawBandPill(ctx: Ctx, rightEdge: number, y: number): void {
  const { doc, colors, spec } = ctx;
  const style = statusStyle(spec.status.tone, colors);
  doc.font('Helvetica-Bold').fontSize(7.5);
  const w =
    doc.widthOfString(spec.status.label, { characterSpacing: 0.8 }) + 20;
  const h = 17;
  doc.roundedRect(rightEdge - w, y, w, h, h / 2).fill(style.bg);
  doc.fillColor(style.text).text(spec.status.label, rightEdge - w, y + 5, {
    width: w,
    align: 'center',
    characterSpacing: 0.8,
    lineBreak: false,
  });
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

interface PartyContent {
  label: string;
  name: string;
  lines: string[];
  taxLine?: string;
  state?: string;
}

function partyHeight(ctx: Ctx, party: PartyContent, w: number): number {
  const { doc } = ctx;
  let h = 24 + measureText(doc, party.name, w, 'Helvetica-Bold', 12) + 4;
  party.lines.forEach((line) => {
    h += measureText(doc, line, w, 'Helvetica', 9) + 2;
  });
  if (party.taxLine) h += 14;
  if (party.state) h += 13;
  return h + 4;
}

function drawPartyBox(
  ctx: Ctx,
  party: PartyContent,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const { doc, colors } = ctx;
  const pad = 13;
  const inner = w - pad * 2;
  doc.rect(x, y, w, h).fill(colors.stripe);
  doc.rect(x, y, w, h).lineWidth(0.8).strokeColor(colors.border).stroke();
  doc.rect(x, y, w, 3).fill(colors.primary);

  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(colors.primaryInk)
    .text(party.label, x + pad, y + 12, {
      width: inner,
      characterSpacing: 1.1,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(colors.text)
    .text(party.name, x + pad, y + 26, { width: inner });
  let cy = doc.y + 4;
  party.lines.forEach((line) => {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(colors.textSecondary)
      .text(line, x + pad, cy, { width: inner });
    cy = doc.y + 2;
  });
  if (party.taxLine) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(colors.text)
      .text(party.taxLine, x + pad, cy + 2, { width: inner });
    cy = doc.y;
  }
  if (party.state) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(colors.textSecondary)
      .text(party.state, x + pad, cy + 2, { width: inner });
  }
}

function drawParties(ctx: Ctx, top: number): number {
  const { geo, business, customer, spec } = ctx;
  const x = geo.margin;
  const width = geo.width - geo.margin * 2;
  const boxW = (width - BOX_GAP) / 2;
  const idLabel = taxIdLabel(spec.taxType, spec.country);
  const bizId = businessTaxId(business);
  const custId = customerTaxId(customer);

  const from: PartyContent = {
    label: spec.senderLabel ?? 'BILL FROM',
    name: business.name,
    lines: [
      business.address,
      business.phone ? `Mobile: ${business.phone}` : undefined,
      business.email ? `Email: ${business.email}` : undefined,
    ].filter(Boolean) as string[],
    taxLine: bizId ? `${idLabel}: ${bizId}` : undefined,
    state: stateLine(spec.supply?.businessState),
  };
  const to: PartyContent = {
    label: spec.recipientLabel,
    name: customer.name,
    lines: [
      customer.phone ? `Mobile: ${customer.phone}` : undefined,
      customer.address,
    ].filter(Boolean) as string[],
    taxLine: custId ? `${idLabel}: ${custId}` : undefined,
    state: stateLine(spec.supply?.customerState),
  };

  const h = Math.max(
    partyHeight(ctx, from, boxW - 26),
    partyHeight(ctx, to, boxW - 26),
    84,
  );
  drawPartyBox(ctx, from, x, top, boxW, h);
  drawPartyBox(ctx, to, x + boxW + BOX_GAP, top, boxW, h);
  return top + h;
}

// The field-service facts of the job, when the invoice bills a logged visit.
function drawServiceStrip(ctx: Ctx, top: number): number {
  const { doc, colors, geo, spec } = ctx;
  const svc = spec.serviceContext;
  if (!svc || spec.show?.serviceAddress === false) return top;
  const cells = [
    svc.serviceDate
      ? {
          label: 'SERVICE DATE',
          value: formatDate(svc.serviceDate, spec.country),
        }
      : null,
    svc.technicianName
      ? { label: 'TECHNICIAN', value: svc.technicianName }
      : null,
    svc.jobReference ? { label: 'JOB', value: svc.jobReference } : null,
    svc.nextServiceDate
      ? {
          label: 'NEXT SERVICE',
          value: formatDate(svc.nextServiceDate, spec.country),
        }
      : null,
  ].filter(Boolean) as { label: string; value: string }[];
  if (!cells.length) return top;

  const x = geo.margin;
  const width = geo.width - geo.margin * 2;
  const y = top + 8;
  const h = 32;
  const cellW = width / cells.length;
  doc.roundedRect(x, y, width, h, 4).fill(colors.tintBg);
  cells.forEach((cell, i) => {
    const cx = x + cellW * i + 12;
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(colors.tintText)
      .text(cell.label, cx, y + 7, {
        width: cellW - 20,
        characterSpacing: 0.9,
        lineBreak: false,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(colors.text)
      .text(cell.value, cx, y + 17, {
        width: cellW - 20,
        lineBreak: false,
        ellipsis: true,
      });
  });
  return y + h;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function showHsn(ctx: Ctx): boolean {
  return (
    ctx.spec.show?.hsn === true &&
    ctx.spec.items.some((item: RenderItem) => !!item.hsn)
  );
}

function columns(ctx: Ctx): TableColumn[] {
  const { spec } = ctx;
  const code = spec.currency.toUpperCase();
  const cols: TableColumn[] = [
    { key: 'index', label: '#', align: 'center', width: 22 },
    {
      key: 'name',
      label: spec.itemLabel ?? 'ITEM / DESCRIPTION',
      align: 'left',
      flex: 1,
    },
  ];
  if (showHsn(ctx))
    cols.push({ key: 'hsn', label: 'HSN/SAC', align: 'center', width: 56 });
  cols.push({ key: 'qty', label: 'QTY', align: 'right', width: 32 });
  cols.push({
    key: 'rate',
    label: `RATE (${code})`,
    align: 'right',
    width: 66,
  });
  if (spec.hasTax) {
    cols.push({ key: 'taxRate', label: 'TAX %', align: 'right', width: 40 });
    cols.push({
      key: 'taxAmount',
      label: 'TAX AMT',
      align: 'right',
      width: 58,
    });
  }
  cols.push({
    key: 'amount',
    label: `AMOUNT (${code})`,
    align: 'right',
    width: 78,
  });
  return cols;
}

function rows(ctx: Ctx): TableRowContent[] {
  const { spec } = ctx;
  return spec.items.map((item: RenderItem, i: number) => ({
    description: item.description,
    cells: {
      index: String(i + 1),
      name: item.name,
      hsn: item.hsn ?? '—',
      qty: String(Number(item.quantity.toFixed(3))),
      rate: formatAmount(item.rate, spec.currency),
      taxRate: item.taxRate ? `${Number(item.taxRate.toFixed(2))}%` : '—',
      taxAmount: item.taxRate
        ? formatAmount(item.taxAmount, spec.currency)
        : '—',
      // Before tax: the tax column carries it, so adding it here would count
      // it twice to anyone reading down the table.
      amount: formatAmount(item.amount, spec.currency),
    },
  }));
}

// The row that closes the table. Its amount is the sum of the amounts above
// it — the subtotal — so the column adds up to what it says. (A total that
// disagreed with its own column was the one thing the reference got wrong.)
function drawTableTotalRow(ctx: Ctx, cols: TableColumn[]): void {
  const { doc, colors, canvas, spec } = ctx;
  const x = canvas.contentX;
  const width = canvas.contentWidth;
  const resolved = resolveColumns(cols, x, width);
  const h = 22;
  canvas.ensure(h);
  const y = canvas.y;
  doc.rect(x, y, width, h).fill(colors.tintBg);
  doc.rect(x, y, width, h).lineWidth(0.8).strokeColor(colors.border).stroke();

  const count = spec.items.length;
  const values: Record<string, string> = {
    name: `Total: ${count} item${count === 1 ? '' : 's'}`,
    taxAmount: formatAmount(
      spec.items.reduce((sum, item) => sum + item.taxAmount, 0),
      spec.currency,
    ),
    amount: formatAmount(
      spec.items.reduce((sum, item) => sum + item.amount, 0),
      spec.currency,
    ),
  };
  resolved.forEach((col) => {
    const value = values[col.key];
    if (!value) return;
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(colors.tintText)
      .text(value, col.x + 7, y + 7, {
        width: col.w - 14,
        align: col.align,
        lineBreak: false,
      });
  });
  canvas.y = y + h;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

function splitTotals(ctx: Ctx): {
  before: RenderTotalRow[];
  grand?: RenderTotalRow;
  after: RenderTotalRow[];
} {
  const rowsIn = ctx.spec.totals;
  const gi = rowsIn.findIndex((row) => row.style === 'grand');
  if (gi < 0) return { before: rowsIn, after: [] };
  const before: RenderTotalRow[] = rowsIn
    .slice(0, gi)
    .map((row) => ({ ...row, ruleAbove: false }));

  // "Taxable value" between the discount and the tax, as a tax invoice
  // states it: what the tax rows below were charged on.
  const discountAt = before.findIndex((row) => row.negative);
  if (discountAt >= 0 && ctx.spec.hasTax && before[0]) {
    const taxable =
      Math.round((before[0].value - before[discountAt].value) * 1000) / 1000;
    before.splice(discountAt + 1, 0, {
      label: 'Taxable Value',
      value: taxable,
    });
  }
  return { before, grand: rowsIn[gi], after: rowsIn.slice(gi + 1) };
}

function withTotals(ctx: Ctx, totals: RenderTotalRow[]): Ctx {
  return { ...ctx, spec: { ...ctx.spec, totals } };
}

function measureTotalsBlock(ctx: Ctx, w: number): number {
  const { before, grand, after } = splitTotals(ctx);
  let h = measureTotals(withTotals(ctx, before), { x: 0, width: w });
  if (grand) h += 44;
  after.forEach((row) => {
    h += row.style === 'strong' ? 40 : 18;
  });
  return h;
}

function drawTotalsBlock(ctx: Ctx, x: number, top: number, w: number): number {
  const { doc, colors, spec } = ctx;
  const { before, grand, after } = splitTotals(ctx);
  let y = drawTotals(withTotals(ctx, before), top, { x: x + 8, width: w - 16 });

  if (grand) {
    y += 6;
    const h = 38;
    doc.rect(x, y, w, h).fill(colors.primary);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(colors.onPrimary)
      .text('GRAND TOTAL', x + 14, y + 14, {
        width: w / 2,
        characterSpacing: 0.8,
        lineBreak: false,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(
        formatCurrency(grand.value, spec.currency),
        x + w / 2 - 14,
        y + 11.5,
        {
          width: w / 2,
          align: 'right',
          lineBreak: false,
        },
      );
    y += h;
  }

  after.forEach((row) => {
    const value = `${row.negative ? '- ' : ''}${formatCurrency(row.value, spec.currency)}`;
    if (row.style === 'strong') {
      y += 6;
      const h = 32;
      const settled = row.color === 'success';
      doc.rect(x, y, w, h).fill(settled ? colors.tintBg : colors.dangerBg);
      const ink = settled ? colors.tintText : colors.dangerText;
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(ink)
        .text(row.label, x + 14, y + 11, { width: w / 2, lineBreak: false });
      doc.fontSize(13).text(value, x + w / 2 - 14, y + 9.5, {
        width: w / 2,
        align: 'right',
        lineBreak: false,
      });
      y += h;
    } else {
      y += 6;
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(colors.textSecondary)
        .text(row.label, x + 8, y, { width: w / 2, lineBreak: false });
      doc.text(value, x + w / 2 - 8, y, {
        width: w / 2,
        align: 'right',
        lineBreak: false,
      });
      y += 12;
    }
  });
  return y;
}

function measureWords(ctx: Ctx, w: number): { text: string; h: number } {
  const text = amountInWords(ctx.spec.grandTotal, ctx.spec.currency);
  return {
    text,
    h: measureText(ctx.doc, text, w - 28, 'Helvetica-Oblique', 10) + 36,
  };
}

function drawWords(ctx: Ctx, x: number, y: number, w: number): number {
  const { doc, colors } = ctx;
  const { text, h } = measureWords(ctx, w);
  doc.rect(x, y, w, h).fill(colors.stripe);
  doc.rect(x, y, 3, h).fill(colors.primary);
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(colors.primaryInk)
    .text('AMOUNT IN WORDS', x + 14, y + 11, { characterSpacing: 1.1 });
  doc
    .font('Helvetica-Oblique')
    .fontSize(10)
    .fillColor(colors.text)
    .text(text, x + 14, y + 24, { width: w - 28 });
  return y + h;
}

// ---------------------------------------------------------------------------
// Tax summary
// ---------------------------------------------------------------------------

function drawTaxSummary(ctx: Ctx): void {
  const { doc, colors, canvas, spec } = ctx;
  if (!spec.hasTax) return;
  const summary = taxSummary(spec);
  // With one rate the totals above already say all of it — the taxable
  // value and each tax at its rate — so a summary would just repeat them.
  // It earns its space when an invoice mixes rates.
  if (summary.length < 2) return;

  const gst = spec.taxType === 'gst';
  const inter = !!spec.supply?.interState;
  const name = taxTypeName(spec.taxType);
  const heads = gst
    ? inter
      ? ['TAX RATE', 'TAXABLE VALUE', 'IGST', 'TOTAL TAX']
      : ['TAX RATE', 'TAXABLE VALUE', 'CGST', 'SGST', 'TOTAL TAX']
    : ['TAX RATE', 'TAXABLE VALUE', name.toUpperCase(), 'TOTAL TAX'];

  const cells = (rate: string, taxable: number, tax: number): string[] => {
    const amt = (n: number) => formatAmount(n, spec.currency);
    if (gst && !inter) {
      const { central, state } = splitGst(tax);
      return [rate, amt(taxable), amt(central), amt(state), amt(tax)];
    }
    return [rate, amt(taxable), amt(tax), amt(tax)];
  };

  const body = summary.map((row) => {
    const shown =
      gst && !inter
        ? `${Number(row.rate.toFixed(2))}% (${Number((row.rate / 2).toFixed(2))}% + ${Number((row.rate / 2).toFixed(2))}%)`
        : `${Number(row.rate.toFixed(2))}%`;
    return cells(shown, row.taxable, row.tax);
  });
  const totalTax = summary.reduce((s, r) => s + r.tax, 0);
  const totalTaxable = summary.reduce((s, r) => s + r.taxable, 0);
  const amt = (n: number) => formatAmount(n, spec.currency);
  // The total row is the column sums, so it can never disagree with the
  // rows above it — or with the CGST / SGST in the totals stack, which come
  // from the same per-rate halving (gstHalves).
  const total =
    gst && !inter
      ? (() => {
          const { central, state } = gstHalves(spec.items, totalTax);
          return [
            'TOTAL',
            amt(totalTaxable),
            amt(central),
            amt(state),
            amt(totalTax),
          ];
        })()
      : cells('TOTAL', totalTaxable, totalTax);

  const x = canvas.contentX;
  const width = canvas.contentWidth;
  const headH = 20;
  const rowH = 18;
  const blockH = 18 + headH + rowH * (body.length + 1);
  canvas.ensure(blockH + 8);

  let y = canvas.y;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(colors.primaryInk)
    .text(`${gst ? 'GST' : name.toUpperCase()} SUMMARY`, x, y, {
      characterSpacing: 1.1,
    });
  y += 14;

  const firstW = gst && !inter ? width * 0.28 : width * 0.22;
  const restW = (width - firstW) / (heads.length - 1);
  const colX = (i: number) => (i === 0 ? x : x + firstW + restW * (i - 1));
  const colW = (i: number) => (i === 0 ? firstW : restW);

  doc.rect(x, y, width, headH).fill(colors.primary);
  heads.forEach((head, i) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(colors.onPrimary)
      .text(head, colX(i) + 8, y + 6.5, {
        width: colW(i) - 16,
        align: i === 0 ? 'left' : 'right',
        characterSpacing: 0.5,
        lineBreak: false,
      });
  });
  y += headH;

  [...body, total].forEach((row, r) => {
    const isTotal = r === body.length;
    if (isTotal) doc.rect(x, y, width, rowH).fill(colors.stripe);
    row.forEach((cell, i) => {
      doc
        .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.5)
        .fillColor(colors.text)
        .text(cell, colX(i) + 8, y + 5, {
          width: colW(i) - 16,
          align: i === 0 ? 'left' : 'right',
          lineBreak: false,
        });
    });
    y += rowH;
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .strokeColor(colors.border)
      .lineWidth(0.6)
      .stroke();
  });
  canvas.y = y + 18;
}

// ---------------------------------------------------------------------------
// Closing blocks
// ---------------------------------------------------------------------------

function drawAccentPanel(ctx: Ctx, label: string, text: string): void {
  const { doc, colors, canvas } = ctx;
  const x = canvas.contentX;
  const width = canvas.contentWidth;
  const h = measureText(doc, text, width - 30, 'Helvetica', 9) + 36;
  canvas.ensure(h + 12);
  const y = canvas.y;
  doc.rect(x, y, width, h).fill(colors.stripe);
  doc.rect(x, y, 3, h).fill(colors.primary);
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(colors.primaryInk)
    .text(label, x + 15, y + 11, { characterSpacing: 1.1 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(colors.textSecondary)
    .text(text, x + 15, y + 25, { width: width - 30, lineGap: 1.5 });
  canvas.y = y + h + 14;
}

function measurePayment(ctx: Ctx, width: number): number {
  const { doc, business } = ctx;
  const lines = paymentLines(business);
  const qr = business.paymentQrBuffer;
  if (!lines.length && !qr) return 0;
  const qrSize = qr ? 64 : 0;
  const textW = width - 30 - (qr ? qrSize + 20 : 0);
  const linesH = lines.reduce(
    (sum, line) =>
      sum +
      measureText(doc, line.value, textW - PAY_LABEL_W, 'Helvetica', 9) +
      4,
    0,
  );
  return Math.max(linesH + 36, qr ? qrSize + 24 : 0);
}

const PAY_LABEL_W = 46;

function drawPayment(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  h: number,
): void {
  const { doc, colors, business } = ctx;
  const lines = paymentLines(business);
  const qr = business.paymentQrBuffer;
  const qrSize = qr ? 64 : 0;
  const textW = width - 30 - (qr ? qrSize + 20 : 0);

  doc.rect(x, y, width, h).fill(colors.stripe);
  doc.rect(x, y, 3, h).fill(colors.primary);
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(colors.primaryInk)
    .text('PAYMENT INFORMATION', x + 15, y + 11, { characterSpacing: 1.1 });
  let ly = y + 26;
  lines.forEach((line) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(colors.textSecondary)
      .text(line.label, x + 15, ly, { width: PAY_LABEL_W - 6 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(colors.text)
      .text(line.value, x + 15 + PAY_LABEL_W, ly, {
        width: textW - PAY_LABEL_W,
      });
    ly = doc.y + 4;
  });
  if (qr) {
    const qx = x + width - qrSize - 14;
    doc.image(qr, qx, y + 8, { fit: [qrSize, qrSize] });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(colors.textMuted)
      .text('Scan to pay', qx, y + 10 + qrSize, {
        width: qrSize,
        align: 'center',
      });
  }
}

function signatureHeight(ctx: Ctx): number {
  if (ctx.spec.show?.signature === false) return 0;
  return ctx.business.signature ? 96 : 76;
}

function drawSignatory(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { doc, colors, business } = ctx;
  doc.rect(x, y, w, h).lineWidth(0.8).strokeColor(colors.border).stroke();
  doc.rect(x, y, w, 3).fill(colors.primary);
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(colors.primaryInk)
    .text(`For ${business.name}`, x + 10, y + 13, {
      width: w - 20,
      align: 'center',
    });
  const lineY = y + h - 24;
  if (business.signature) {
    doc.image(business.signature, x + 20, lineY - 44, {
      fit: [w - 40, 40],
      align: 'center',
      valign: 'bottom',
    });
  }
  doc
    .moveTo(x + 18, lineY)
    .lineTo(x + w - 18, lineY)
    .dash(3, { space: 3 })
    .strokeColor(colors.textMuted)
    .lineWidth(0.7)
    .stroke()
    .undash();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(colors.textMuted)
    .text('Authorised Signatory', x, lineY + 6, { width: w, align: 'center' });
}

function drawTermsBox(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { doc, colors, spec } = ctx;
  doc.rect(x, y, w, h).lineWidth(0.8).strokeColor(colors.border).stroke();
  doc.rect(x, y, w, 3).fill(colors.primary);
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(colors.primaryInk)
    .text('TERMS & CONDITIONS', x + 13, y + 13, { characterSpacing: 1.1 });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(colors.textSecondary)
    .text(spec.terms ?? '', x + 13, y + 28, { width: w - 26, lineGap: 1.5 });
}

// Payment, terms and the signatory. The signatory takes the right-hand end
// of the last row, beside whichever block comes last — terms when there are
// any, otherwise the payment details — so a short invoice closes in one row
// instead of three stacked blocks and a second page.
function drawClosing(ctx: Ctx, paymentDone = false): void {
  const { doc, canvas, spec } = ctx;
  const x = canvas.contentX;
  const width = canvas.contentWidth;
  const sigH = signatureHeight(ctx);
  const sigW = sigH ? 180 : 0;
  const sideW = width - (sigW ? sigW + BOX_GAP : 0);
  const hasPay = !paymentDone && measurePayment(ctx, width) > 0;

  // Payment on its own full row only when terms need the row beside the
  // signatory.
  if (hasPay && spec.terms) {
    const h = measurePayment(ctx, width);
    canvas.ensure(h + 12);
    drawPayment(ctx, x, canvas.y, width, h);
    canvas.y += h + 14;
  }

  const lastIsPay = hasPay && !spec.terms;
  const blockH = lastIsPay
    ? measurePayment(ctx, sideW)
    : spec.terms
      ? measureText(doc, spec.terms, sideW - 26, 'Helvetica', 8.5) + 36
      : 0;
  const h = Math.max(blockH, sigH);
  if (!h) return;
  canvas.ensure(h + 8);
  const y = canvas.y;
  const blockW = sigW ? sideW : width;
  if (lastIsPay) drawPayment(ctx, x, y, blockW, h);
  else if (spec.terms) drawTermsBox(ctx, x, y, blockW, h);
  if (sigH) drawSignatory(ctx, x + width - sigW, y, sigW, h);
  canvas.y = y + h + 12;
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

function continuation(ctx: Ctx): number {
  const { doc, colors, geo, business, spec } = ctx;
  const x = geo.margin;
  const width = geo.width - geo.margin * 2;
  doc.rect(0, 0, geo.width, 6).fill(colors.primary);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(colors.text)
    .text(business.name, x, geo.margin - 8, {
      width: width * 0.58,
      lineBreak: false,
    });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(colors.textSecondary)
    .text(
      `${spec.title} ${spec.number} (continued)`,
      x + width * 0.42,
      geo.margin - 7,
      {
        width: width * 0.58,
        align: 'right',
        lineBreak: false,
      },
    );
  return geo.margin + 22;
}

// A faint diagonal stamp for the states that change what the document means:
// a draft is not yet a demand for payment, a paid one no longer is, and a
// cancelled one is void. Drawn in the footer pass, over page one only, where
// it cannot collide with a signature on a later page.
const STAMPED = new Set(['DRAFT', 'PAID', 'CANCELLED']);

function drawStamp(ctx: Ctx): void {
  const { doc, colors, geo, spec } = ctx;
  if (!STAMPED.has(spec.status.label)) return;
  const ink =
    spec.status.tone === 'positive'
      ? colors.tintText
      : spec.status.label === 'CANCELLED'
        ? colors.dangerText
        : colors.textMuted;
  const cx = geo.width / 2;
  const cy = geo.height * 0.56;
  doc.save();
  doc.rotate(-28, { origin: [cx, cy] });
  doc.fillOpacity(0.07);
  doc
    .font('Helvetica-Bold')
    .fontSize(96)
    .fillColor(ink)
    .text(spec.status.label, cx - 300, cy - 48, {
      width: 600,
      align: 'center',
      lineBreak: false,
    });
  doc.restore();
}

function footer(ctx: Ctx, page: number, pageCount: number): void {
  const { doc, colors, geo, spec } = ctx;
  if (page === 1) drawStamp(ctx);
  const x = geo.margin;
  const width = geo.width - geo.margin * 2;
  const ruleY = geo.height - 44;
  doc.rect(x, ruleY, width, 1.5).fill(colors.primary);

  const y = ruleY + 12;
  const note =
    page === pageCount
      ? spec.footerNote
      : `${spec.number} — continued overleaf`;
  doc
    .font('Helvetica-Oblique')
    .fontSize(8.5)
    .fillColor(colors.textSecondary)
    .text(note, x, y, { width: width * 0.6, height: 22, ellipsis: true });
  const right =
    pageCount > 1
      ? `${spec.number}  ·  Page ${page} of ${pageCount}`
      : spec.number;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(colors.textMuted)
    .text(right, x + width * 0.6, y + 0.5, {
      width: width * 0.4,
      align: 'right',
      lineBreak: false,
    });
}

// ---------------------------------------------------------------------------

export const premiumLayout: LayoutDefinition = {
  continuation,
  footer,
  draw: (ctx) => {
    const { canvas, spec } = ctx;

    const bandBottom = drawMasthead(ctx);
    let y = drawParties(ctx, bandBottom + 16);
    y = drawServiceStrip(ctx, y);
    canvas.y = y + 14;

    // --- Items ------------------------------------------------------------
    const cols = columns(ctx);
    drawTopMessage(ctx);
    drawTable(ctx, cols, rows(ctx), {
      ...DEFAULT_TABLE_STYLE,
      scale: 0.95,
      cellPadX: 7,
      headerHeight: 26,
      zebra: true,
      rowRule: false,
      columnRules: true,
      outerBorder: true,
      headerFill: 'accent',
      boldColumn: 'name',
    });
    drawTableTotalRow(ctx, cols);
    canvas.y += 14;

    // --- Amount in words beside the totals ---------------------------------
    const width = canvas.contentWidth;
    const x = canvas.contentX;
    const totalsW = 238;
    const wordsW = width - totalsW - SIDE_GAP;
    const totalsH = measureTotalsBlock(ctx, totalsW);
    const words = measureWords(ctx, wordsW);
    // Payment details go under the amount in words, beside the totals — that
    // column is otherwise empty, and giving payment a row of its own was what
    // pushed an ordinary invoice onto a second page.
    // Beside the totals is always shorter than a row of its own.
    const payLeftH = measurePayment(ctx, wordsW);
    const payBeside = payLeftH > 0;
    canvas.ensure(
      Math.max(totalsH, payBeside ? words.h + 12 + payLeftH : words.h) + 8,
    );
    const top = canvas.y;
    let leftEnd = drawWords(ctx, x, top, wordsW);
    if (payBeside) {
      drawPayment(ctx, x, leftEnd + 12, wordsW, payLeftH);
      leftEnd += 12 + payLeftH;
    }
    const totalsEnd = drawTotalsBlock(ctx, x + width - totalsW, top, totalsW);
    canvas.y = Math.max(leftEnd, totalsEnd) + 18;

    // --- Tax summary, notes, payment, terms --------------------------------
    drawTaxSummary(ctx);
    if (spec.notes) drawAccentPanel(ctx, 'NOTES', spec.notes);
    drawClosing(ctx, payBeside);
  },
};
