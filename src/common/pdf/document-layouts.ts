import {
  ContinuationPainter,
  Ctx,
  DEFAULT_TABLE_STYLE,
  RenderItem,
  TableColumn,
  TableRowContent,
  businessTaxId,
  customerTaxId,
  drawLogoBadge,
  drawPartyBlock,
  drawPaymentBlock,
  drawSectionLabel,
  drawSignatureBlock,
  drawStatusPill,
  drawTable,
  drawTextPanel,
  drawTotals,
  formatAmount,
  measureText,
  measureSignature,
  measureTotals,
  metaRowsWithNumber,
  paymentLines,
  taxIdLabel,
} from './document-render';
import { DocumentLayoutId } from './document-templates';
import { amountInWords } from './amount-in-words';

// The five document archetypes.
//
// Each is a genuinely different document, not a recolour: the masthead's shape
// and position, whether the sending business appears as its own block, how the
// item table is ruled, where the totals land, and how the supporting
// information (payment, notes, terms, signature) is grouped all differ. The
// brand accent is applied to whatever each layout uses it for — it is never
// the thing that tells them apart.
//
// All five read the same DocumentSpec and never recompute a figure.

export interface LayoutDefinition {
  draw: (ctx: Ctx) => void;
  // Top of every page after the first.
  continuation: ContinuationPainter;
  footer: (ctx: Ctx, page: number, pageCount: number) => void;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function contactLines(ctx: Ctx): string[] {
  const { business } = ctx;
  return [business.address, business.phone, business.email, business.website].filter(
    Boolean,
  ) as string[];
}

// Item columns, adapted to the invoice: the tax column disappears entirely on
// a zero-tax invoice rather than printing a column of "0%". Currency is named
// once in the column header so cells stay narrow.
function itemColumns(
  ctx: Ctx,
  opts: { index?: boolean; tax?: boolean; taxAmount?: boolean; label?: string } = {},
): TableColumn[] {
  const code = ctx.spec.currency.toUpperCase();
  const cols: TableColumn[] = [];
  if (opts.index) cols.push({ key: 'index', label: '#', align: 'left', width: 30 });
  cols.push({
    key: 'name',
    label: opts.label ?? 'SERVICE / ITEM',
    align: 'left',
    flex: 1,
  });
  cols.push({ key: 'qty', label: 'QTY', align: 'right', width: 40 });
  cols.push({ key: 'rate', label: 'RATE (' + code + ')', align: 'right', width: 82 });
  if (opts.tax && ctx.spec.hasTax) {
    cols.push({ key: 'taxRate', label: 'TAX', align: 'right', width: 40 });
  }
  if (opts.taxAmount && ctx.spec.hasTax) {
    cols.push({ key: 'taxAmount', label: 'TAX AMT', align: 'right', width: 60 });
  }
  // Wide enough for 'AMOUNT (AED)' on one line — a 3-letter currency code
  // is the longest case, and a wrapped column header looks broken.
  cols.push({ key: 'amount', label: 'AMOUNT (' + code + ')', align: 'right', width: 96 });
  return cols;
}

function itemRows(ctx: Ctx): TableRowContent[] {
  const { spec } = ctx;
  return spec.items.map((item: RenderItem, i: number) => ({
    description: item.description,
    cells: {
      index: String(i + 1),
      name: item.name,
      qty: String(item.quantity),
      rate: formatAmount(item.rate, spec.currency),
      taxRate: item.taxRate ? Number(item.taxRate.toFixed(2)) + '%' : '—',
      taxAmount: formatAmount(item.taxAmount, spec.currency),
      // Line amount excludes tax — the tax column and the totals stack carry
      // it, so adding it here too would double-count it to a reader.
      amount: formatAmount(item.amount, spec.currency),
    },
  }));
}

// "Page 2 of 3" plus the layout's closing line. Page count is only known once
// every page exists, so this is painted at the end over buffered pages.
function standardFooter(
  ctx: Ctx,
  page: number,
  pageCount: number,
  opts: { x?: number; width?: number; rule?: boolean } = {},
): void {
  const { doc, colors, geo, spec } = ctx;
  const x = opts.x ?? geo.margin;
  const width = opts.width ?? geo.width - geo.margin * 2;
  const y = geo.height - 40;

  if (opts.rule !== false) {
    doc
      .moveTo(x, y - 12)
      .lineTo(x + width, y - 12)
      .strokeColor(colors.border)
      .lineWidth(0.8)
      .stroke();
  }

  doc.font('Helvetica').fontSize(8).fillColor(colors.textMuted);
  // The closing line belongs on the last page only; earlier pages say the
  // document continues, so a reader can tell when a page is missing.
  const note = page === pageCount ? spec.footerNote : spec.number + ' — continued';
  doc.text(note, x, y, { width: width * 0.72 });
  if (pageCount > 1) {
    doc.text('Page ' + page + ' of ' + pageCount, x + width * 0.72, y, {
      width: width * 0.28,
      align: 'right',
    });
  }
}

// Compact continuation header, shared by every layout whose page-1 masthead is
// too tall to repeat.
function slimContinuation(ctx: Ctx, accentRule: boolean): number {
  const { doc, colors, geo, business, spec } = ctx;
  const x = geo.margin;
  const width = geo.width - geo.margin * 2;

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(colors.text)
    .text(business.name, x, geo.margin, { width: width * 0.58 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(colors.textSecondary)
    .text(spec.title + ' ' + spec.number + ' (continued)', x + width * 0.58, geo.margin + 1, {
      width: width * 0.42,
      align: 'right',
    });

  const ruleY = geo.margin + 20;
  doc
    .moveTo(x, ruleY)
    .lineTo(x + width, ruleY)
    .strokeColor(accentRule ? colors.primary : colors.border)
    .lineWidth(accentRule ? 1.5 : 0.8)
    .stroke();

  return ruleY + 18;
}

// ---------------------------------------------------------------------------
// 1. CLASSIC — traditional horizontal structure.
//    Filled masthead, title with metadata opposite, two-column party row,
//    numbered striped table, payment instructions beside the totals.
// ---------------------------------------------------------------------------

const classic: LayoutDefinition = {
  continuation: (ctx) => slimContinuation(ctx, true),
  footer: (ctx, page, pageCount) => standardFooter(ctx, page, pageCount),
  draw: (ctx) => {
    const { doc, colors, geo, business, customer, spec, canvas } = ctx;
    const x = geo.margin;
    const width = canvas.contentWidth;
    const HEADER_H = 92;

    // --- Masthead -------------------------------------------------------
    doc.rect(0, 0, geo.width, HEADER_H).fill(colors.primary);
    drawLogoBadge(ctx, x + 20, 40, 20, 'on-color');
    doc
      .fillColor(colors.onPrimary)
      .font('Helvetica-Bold')
      .fontSize(17)
      .text(business.name, x + 52, 24, { width: 270 });
    if (business.tradeType) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(colors.onPrimaryMuted)
        .text(business.tradeType, x + 52, doc.y + 1, { width: 270 });
    }

    const contact = contactLines(ctx);
    if (contact.length) {
      doc.font('Helvetica').fontSize(8).fillColor(colors.onPrimaryMuted);
      doc.text(contact.join('\n'), geo.width - geo.margin - 205, 20, {
        width: 205,
        align: 'right',
        lineGap: 1.5,
      });
    }

    // --- Title + metadata ----------------------------------------------
    let y = HEADER_H + 22;
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(colors.text)
      .text(spec.title, x, y, { characterSpacing: 0.5 });
    drawStatusPill(ctx, x + 190, y + 4, 0.9);

    const metaW = 186;
    const metaX = geo.width - geo.margin - metaW;
    let metaY = y + 1;
    metaRowsWithNumber(spec).forEach((row) => {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(colors.textMuted)
        .text(row.label, metaX, metaY, { width: 84 });
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(colors.text)
        .text(row.value, metaX + 84, metaY, { width: metaW - 84, align: 'right' });
      metaY += 14;
    });

    y = Math.max(y + 34, metaY + 6);
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .strokeColor(colors.border)
      .lineWidth(0.8)
      .stroke();

    // --- Parties --------------------------------------------------------
    y += 16;
    const colW = (width - 34) / 2;
    let leftEnd = drawSectionLabel(ctx, spec.recipientLabel, x, y, colW);
    leftEnd = drawPartyBlock(
      ctx,
      {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        taxId: customerTaxId(customer),
      },
      x,
      leftEnd,
      colW,
    );

    const rightX = x + colW + 34;
    let rightEnd = drawSectionLabel(ctx, 'SERVICE ADDRESS', rightX, y, colW);
    doc.font('Helvetica').fontSize(9).fillColor(colors.textSecondary);
    // The app keeps one address per customer, and for a field-service call it
    // is where the work happens — so this states that rather than reprinting
    // the same lines under a second heading.
    doc.text(
      customer.address ? 'Same as billing address' : 'Not recorded',
      rightX,
      rightEnd,
      { width: colW },
    );
    rightEnd = doc.y + 4;
    if (spec.paymentTerms) {
      rightEnd = drawSectionLabel(ctx, 'PAYMENT TERMS', rightX, rightEnd + 6, colW);
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(colors.text)
        .text(spec.paymentTerms, rightX, rightEnd, { width: colW });
      rightEnd = doc.y;
    }

    canvas.y = Math.max(leftEnd, rightEnd) + 20;

    // --- Items ----------------------------------------------------------
    drawTable(ctx, itemColumns(ctx, { index: true, tax: true }), itemRows(ctx), {
      ...DEFAULT_TABLE_STYLE,
      headerFill: 'tint',
    });
    canvas.y += 18;

    // --- Payment instructions beside the totals ------------------------
    const totalsW = 232;
    const totalsX = x + width - totalsW;
    const totalsH = measureTotals(ctx, { x: totalsX, width: totalsW });
    const payLines = paymentLines(business);
    const payH = payLines.length ? 16 + payLines.length * 13 : 0;
    canvas.ensure(Math.max(totalsH, payH) + 12);

    const blockTop = canvas.y;
    if (payLines.length) {
      drawPaymentBlock(ctx, x, blockTop, width - totalsW - 30);
    }
    const totalsEnd = drawTotals(ctx, blockTop, {
      x: totalsX,
      width: totalsW,
      grand: 'bar',
    });
    canvas.y = Math.max(totalsEnd, blockTop + payH) + 20;

    // --- Notes / terms --------------------------------------------------
    if (spec.notes) {
      drawTextPanel(ctx, 'NOTES', spec.notes, { x, width, variant: 'filled' });
    }
    if (spec.terms) {
      drawTextPanel(ctx, 'TERMS & CONDITIONS', spec.terms, {
        x,
        width,
        variant: 'filled',
      });
    }

    // --- Signature ------------------------------------------------------
    canvas.ensure(measureSignature(ctx));
    drawSignatureBlock(ctx, canvas.y, x + width);
  },
};

// ---------------------------------------------------------------------------
// 2. MODERN — brand/sidebar structure.
//    A full-height accent column carries the identity and the standing
//    payment details; the main column stays uncluttered and minimally ruled,
//    closing on a filled total bar.
// ---------------------------------------------------------------------------

const BAR_W = 168;
const MODERN_BODY_X = 196;

const modern: LayoutDefinition = {
  continuation: (ctx) => {
    // The bar continues on every page so the document stays recognisable,
    // without repeating the whole identity block.
    const { doc, colors, geo, canvas } = ctx;
    doc.rect(0, 0, BAR_W, geo.height).fill(colors.primary);
    canvas.contentX = MODERN_BODY_X;
    canvas.contentWidth = geo.width - MODERN_BODY_X - geo.margin;
    const { doc: d } = ctx;
    d
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(colors.text)
      .text(ctx.business.name, canvas.contentX, geo.margin, {
        width: canvas.contentWidth * 0.55,
      });
    d
      .font('Helvetica')
      .fontSize(9)
      .fillColor(colors.textSecondary)
      .text(
        ctx.spec.title + ' ' + ctx.spec.number + ' (continued)',
        canvas.contentX + canvas.contentWidth * 0.55,
        geo.margin + 1,
        { width: canvas.contentWidth * 0.45, align: 'right' },
      );
    const ruleY = geo.margin + 20;
    d
      .moveTo(canvas.contentX, ruleY)
      .lineTo(canvas.contentX + canvas.contentWidth, ruleY)
      .strokeColor(colors.border)
      .lineWidth(0.8)
      .stroke();
    return ruleY + 18;
  },
  footer: (ctx, page, pageCount) =>
    standardFooter(ctx, page, pageCount, {
      x: MODERN_BODY_X,
      width: ctx.geo.width - MODERN_BODY_X - ctx.geo.margin,
    }),
  draw: (ctx) => {
    const { doc, colors, geo, business, customer, spec, canvas } = ctx;
    const pad = 20;
    const barInner = BAR_W - pad * 2;

    canvas.contentX = MODERN_BODY_X;
    canvas.contentWidth = geo.width - canvas.contentX - geo.margin;
    const x = canvas.contentX;
    const width = canvas.contentWidth;

    // --- Brand column ---------------------------------------------------
    doc.rect(0, 0, BAR_W, geo.height).fill(colors.primary);
    drawLogoBadge(ctx, pad + 21, 52, 21, 'on-color');
    doc
      .fillColor(colors.onPrimary)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(business.name, pad, 88, { width: barInner });
    if (business.tradeType) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(colors.onPrimaryMuted)
        .text(business.tradeType, pad, doc.y + 2, { width: barInner });
    }

    let barY = doc.y + 14;
    doc
      .moveTo(pad, barY)
      .lineTo(pad + barInner, barY)
      .strokeColor(colors.onPrimaryMuted)
      .lineWidth(0.6)
      .stroke();
    barY += 12;

    doc.font('Helvetica').fontSize(8.5).fillColor(colors.onPrimaryMuted);
    contactLines(ctx).forEach((line) => {
      doc.text(line, pad, barY, { width: barInner, lineGap: 1 });
      barY = doc.y + 5;
    });

    const taxId = businessTaxId(business);
    if (taxId) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(colors.onPrimaryMuted)
        .text(taxIdLabel(spec.taxType, spec.country), pad, barY + 6, { width: barInner });
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(colors.onPrimary)
        .text(taxId, pad, doc.y, { width: barInner });
      barY = doc.y;
    }

    // Payment instructions live in the bar — the standing information a
    // customer looks for, kept out of the invoice body.
    const payLines = paymentLines(business);
    if (payLines.length) {
      barY += 18;
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(colors.onPrimaryMuted)
        .text('HOW TO PAY', pad, barY, { width: barInner, characterSpacing: 1 });
      barY = doc.y + 6;
      payLines.forEach((line) => {
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor(colors.onPrimaryMuted)
          .text(line.label, pad, barY, { width: barInner });
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(colors.onPrimary)
          .text(line.value, pad, doc.y, { width: barInner });
        barY = doc.y + 5;
      });
    }

    // --- Document identity ---------------------------------------------
    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor(colors.text)
      .text(spec.title, x, 46, { width: width * 0.55, characterSpacing: 0.4 });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(colors.primaryInk)
      .text(spec.number, x, 70, { width: width * 0.55 });
    drawStatusPill(ctx, geo.width - geo.margin, 46);

    let metaY = 70;
    const metaW = 164;
    const metaX = geo.width - geo.margin - metaW;
    spec.metaRows.forEach((row) => {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(colors.textMuted)
        .text(row.label, metaX, metaY, { width: 78 });
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(colors.text)
        .text(row.value, metaX + 78, metaY, { width: metaW - 78, align: 'right' });
      metaY += 13;
    });

    // --- Recipient ------------------------------------------------------
    let y = Math.max(98, metaY + 16);
    let end = drawSectionLabel(ctx, spec.recipientLabel, x, y, width * 0.62);
    end = drawPartyBlock(
      ctx,
      {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        taxId: customerTaxId(customer),
      },
      x,
      end,
      width * 0.62,
      { nameSize: 13 },
    );
    canvas.y = end + 22;

    // --- Items: minimal ruling, no zebra -------------------------------
    drawTable(ctx, itemColumns(ctx), itemRows(ctx), {
      ...DEFAULT_TABLE_STYLE,
      zebra: false,
      rowRule: true,
      headerFill: 'tint',
    });
    canvas.y += 20;

    // --- Totals ---------------------------------------------------------
    const totalsW = 228;
    canvas.ensure(measureTotals(ctx, { x, width: totalsW }) + 16);
    canvas.y = drawTotals(ctx, canvas.y, {
      x: x + width - totalsW,
      width: totalsW,
      grand: 'bar',
    });
    canvas.y += 22;

    if (spec.notes) {
      drawTextPanel(ctx, 'NOTES', spec.notes, { x, width, variant: 'ruled' });
    }
    if (spec.terms) {
      drawTextPanel(ctx, 'TERMS & CONDITIONS', spec.terms, { x, width, variant: 'ruled' });
    }
    if (business.signature) {
      canvas.ensure(measureSignature(ctx));
      drawSignatureBlock(ctx, canvas.y, x + width);
    }
  },
};

// ---------------------------------------------------------------------------
// 3. MINIMAL — typography and whitespace.
//    No fills, no boxes. Letterhead masthead, hairline table, totals held
//    together by rules alone.
// ---------------------------------------------------------------------------

const minimal: LayoutDefinition = {
  continuation: (ctx) => slimContinuation(ctx, false),
  footer: (ctx, page, pageCount) => standardFooter(ctx, page, pageCount, { rule: false }),
  draw: (ctx) => {
    const { doc, colors, geo, business, customer, spec, canvas } = ctx;
    const x = geo.margin;
    const width = canvas.contentWidth;

    // --- Letterhead -----------------------------------------------------
    const headY = 44;
    if (business.logo) {
      drawLogoBadge(ctx, x + 16, headY + 10, 16, 'on-white');
    }
    const nameX = business.logo ? x + 42 : x;
    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor(colors.text)
      .text(business.name, nameX, headY, { width: width * 0.5 });
    let leftEnd = doc.y;
    if (business.tradeType) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(colors.textMuted)
        .text(business.tradeType, nameX, leftEnd + 3, {
          width: width * 0.5,
          characterSpacing: 0.6,
        });
      leftEnd = doc.y;
    }

    const rightW = 232;
    const rightX = geo.width - geo.margin - rightW;
    doc.font('Helvetica').fontSize(8.5).fillColor(colors.textSecondary);
    doc.text(contactLines(ctx).join('\n'), rightX, headY + 2, {
      width: rightW,
      align: 'right',
      lineGap: 2,
    });
    let rightEnd = doc.y;
    const taxId = businessTaxId(business);
    if (taxId) {
      doc
        .fontSize(8)
        .fillColor(colors.textMuted)
        .text(taxIdLabel(spec.taxType, spec.country) + ' ' + taxId, rightX, rightEnd + 2, {
          width: rightW,
          align: 'right',
        });
      rightEnd = doc.y;
    }

    let y = Math.max(leftEnd, rightEnd) + 16;
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .strokeColor(colors.primaryInk)
      .lineWidth(1)
      .stroke();

    // --- Title, set large and airy --------------------------------------
    y += 30;
    doc
      .font('Helvetica')
      .fontSize(21)
      .fillColor(colors.primaryInk)
      .text(spec.title, x, y, { characterSpacing: 4 });

    const metaW = 190;
    const metaX = geo.width - geo.margin - metaW;
    let metaY = y + 3;
    metaRowsWithNumber(spec).forEach((row) => {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(colors.textMuted)
        .text(row.label, metaX, metaY, { width: 92 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(colors.text)
        .text(row.value, metaX + 92, metaY, { width: metaW - 92, align: 'right' });
      metaY += 14;
    });

    // --- Recipient ------------------------------------------------------
    y = Math.max(y + 38, metaY + 14);
    let end = drawSectionLabel(ctx, spec.recipientLabel, x, y, width * 0.55);
    end = drawPartyBlock(
      ctx,
      {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        taxId: customerTaxId(customer),
      },
      x,
      end,
      width * 0.55,
      { nameSize: 13 },
    );
    canvas.y = end + 26;

    // --- Items: hairlines only ------------------------------------------
    drawTable(ctx, itemColumns(ctx, { label: 'DESCRIPTION' }), itemRows(ctx), {
      ...DEFAULT_TABLE_STYLE,
      cellPadX: 0,
      headerHeight: 20,
      zebra: false,
      rowRule: true,
      headerFill: 'none',
      headerRule: true,
    });
    canvas.y += 22;

    // --- Totals ---------------------------------------------------------
    const totalsW = 218;
    canvas.ensure(measureTotals(ctx, { x, width: totalsW }) + 20);
    canvas.y = drawTotals(ctx, canvas.y, {
      x: x + width - totalsW,
      width: totalsW,
      grand: 'plain',
    });
    doc
      .moveTo(x + width - totalsW, canvas.y + 3)
      .lineTo(x + width, canvas.y + 3)
      .strokeColor(colors.text)
      .lineWidth(0.6)
      .stroke();
    canvas.y += 24;

    // Payment and notes as plain labelled paragraphs — no panels.
    const payLines = paymentLines(business);
    if (payLines.length) {
      canvas.ensure(20 + payLines.length * 13);
      canvas.y = drawPaymentBlock(ctx, x, canvas.y, width * 0.6) + 18;
    }
    if (spec.notes) {
      drawTextPanel(ctx, 'NOTES', spec.notes, { x, width, variant: 'ruled' });
    }
    if (spec.terms) {
      drawTextPanel(ctx, 'TERMS', spec.terms, { x, width, variant: 'ruled' });
    }
    if (business.signature) {
      canvas.ensure(measureSignature(ctx));
      drawSignatureBlock(ctx, canvas.y, x + width);
    }
  },
};

// ---------------------------------------------------------------------------
// 4. FORMAL — corporate grid.
//    Centred masthead, boxed Bill From / Bill To, a ruled metadata strip, a
//    fully bordered table with per-line tax, amount in words, boxed terms.
//    The only layout that states the sending party as its own block.
// ---------------------------------------------------------------------------

const formal: LayoutDefinition = {
  continuation: (ctx) => slimContinuation(ctx, false),
  footer: (ctx, page, pageCount) => standardFooter(ctx, page, pageCount),
  draw: (ctx) => {
    const { doc, colors, geo, business, customer, spec, canvas } = ctx;
    const x = geo.margin;
    const width = canvas.contentWidth;

    // --- Masthead: identity left, title centre, registration right ------
    if (business.logo) drawLogoBadge(ctx, x + 17, 46, 17, 'on-white');
    const nameX = business.logo ? x + 42 : x;
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(colors.text)
      .text(business.name, nameX, 34, { width: width * 0.32 });
    if (business.tradeType) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(colors.textMuted)
        .text(business.tradeType, nameX, doc.y + 1, { width: width * 0.32 });
    }
    const leftBottom = doc.y;

    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(colors.primaryInk)
      .text(spec.title, x + width * 0.34, 40, {
        width: width * 0.32,
        align: 'center',
        characterSpacing: 1.6,
      });

    const regW = width * 0.32;
    const regX = x + width - regW;
    const regLines = [
      business.address,
      business.phone,
      business.email,
      businessTaxId(business)
        ? taxIdLabel(spec.taxType, spec.country) + ': ' + businessTaxId(business)
        : undefined,
    ].filter(Boolean) as string[];
    doc.font('Helvetica').fontSize(7.5).fillColor(colors.textSecondary);
    doc.text(regLines.join('\n'), regX, 32, { width: regW, align: 'right', lineGap: 1.5 });

    let y = Math.max(doc.y, leftBottom, 76) + 14;
    doc.moveTo(x, y).lineTo(x + width, y).strokeColor(colors.text).lineWidth(1).stroke();
    doc
      .moveTo(x, y + 2.5)
      .lineTo(x + width, y + 2.5)
      .strokeColor(colors.text)
      .lineWidth(0.6)
      .stroke();
    y += 18;

    // --- Bill From / Bill To boxes --------------------------------------
    const gap = 12;
    const panelW = (width - gap) / 2;
    const parties = [
      {
        px: x,
        label: 'BILL FROM',
        party: {
          name: business.name,
          phone: business.phone,
          address: business.address,
          taxId: businessTaxId(business),
        },
      },
      {
        px: x + panelW + gap,
        label: spec.recipientLabel,
        party: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          taxId: customerTaxId(customer),
        },
      },
    ];

    // Both boxes take the height of the taller content, so the grid stays
    // square whatever the address lengths are.
    const panelHeights = parties.map(({ party }) => {
      const lines = [party.phone, party.address].filter(Boolean) as string[];
      const nameH = measureText(doc, party.name, panelW - 20, 'Helvetica-Bold', 11);
      const bodyH = lines.reduce(
        (sum, line) => sum + measureText(doc, line, panelW - 20, 'Helvetica', 9) + 1,
        0,
      );
      return nameH + bodyH + (party.taxId ? 16 : 0) + 34;
    });
    const panelH = Math.max(Math.max(...panelHeights), 74);

    parties.forEach(({ px, label, party }) => {
      doc.rect(px, y, panelW, panelH).lineWidth(0.8).strokeColor(colors.border).stroke();
      doc.rect(px, y, panelW, 17).fill(colors.tintBg);
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(colors.tintText)
        .text(label, px + 10, y + 5, { width: panelW - 20, characterSpacing: 1 });
      drawPartyBlock(ctx, party, px + 10, y + 24, panelW - 20, {
        nameSize: 11,
        compact: true,
      });
    });
    y += panelH + 12;

    // --- Metadata strip -------------------------------------------------
    const stripRows = metaRowsWithNumber(spec);
    if (spec.paymentTerms) {
      stripRows.push({ label: 'Payment Terms', value: spec.paymentTerms });
    }
    if (stripRows.length) {
      const stripH = 30;
      doc.rect(x, y, width, stripH).lineWidth(0.8).strokeColor(colors.border).stroke();
      const cellW = width / stripRows.length;
      stripRows.forEach((row, i) => {
        const cx = x + cellW * i;
        if (i > 0) {
          doc
            .moveTo(cx, y)
            .lineTo(cx, y + stripH)
            .strokeColor(colors.border)
            .lineWidth(0.6)
            .stroke();
        }
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(colors.textMuted)
          .text(row.label.toUpperCase(), cx + 9, y + 6, {
            width: cellW - 18,
            characterSpacing: 0.6,
          });
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(colors.text)
          .text(row.value, cx + 9, y + 16, { width: cellW - 18 });
      });
      y += stripH + 14;
    }
    canvas.y = y;

    // --- Fully ruled table, with per-line tax --------------------------
    drawTable(
      ctx,
      itemColumns(ctx, { index: true, tax: true, taxAmount: true, label: 'DESCRIPTION' }),
      itemRows(ctx),
      {
        ...DEFAULT_TABLE_STYLE,
        cellPadX: 7,
        headerHeight: 24,
        zebra: false,
        rowRule: true,
        columnRules: true,
        outerBorder: true,
        headerFill: 'accent',
      },
    );
    canvas.y += 14;

    // --- Totals, aligned to the table's right edge ----------------------
    const totalsW = 248;
    canvas.ensure(measureTotals(ctx, { x, width: totalsW }) + 16);
    canvas.y = drawTotals(ctx, canvas.y, {
      x: x + width - totalsW,
      width: totalsW,
      grand: 'double',
    });
    canvas.y += 16;

    // --- Amount in words ------------------------------------------------
    const words = amountInWords(spec.grandTotal, spec.currency);
    const wordsH = measureText(doc, words, width - 20, 'Helvetica-Bold', 9) + 30;
    canvas.ensure(wordsH + 10);
    doc
      .rect(x, canvas.y, width, wordsH)
      .lineWidth(0.8)
      .strokeColor(colors.border)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(colors.textMuted)
      .text('AMOUNT IN WORDS', x + 10, canvas.y + 8, { characterSpacing: 1 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(colors.text)
      .text(words, x + 10, canvas.y + 19, { width: width - 20 });
    canvas.y += wordsH + 14;

    // --- Payment details box --------------------------------------------
    const payLines = paymentLines(business);
    if (payLines.length) {
      const boxH = 24 + payLines.length * 13;
      canvas.ensure(boxH + 10);
      doc
        .rect(x, canvas.y, width, boxH)
        .lineWidth(0.8)
        .strokeColor(colors.border)
        .stroke();
      drawPaymentBlock(ctx, x + 10, canvas.y + 8, width - 20);
      canvas.y += boxH + 14;
    }

    if (spec.terms) {
      drawTextPanel(ctx, 'TERMS & CONDITIONS', spec.terms, { x, width, variant: 'boxed' });
    }
    if (spec.notes) {
      drawTextPanel(ctx, 'NOTES', spec.notes, { x, width, variant: 'boxed' });
    }

    canvas.ensure(measureSignature(ctx));
    drawSignatureBlock(ctx, canvas.y, x + width, 170);
  },
};

// ---------------------------------------------------------------------------
// 5. COMPACT — information-dense, built for field service.
//    A slim strip instead of a masthead, then the three things a technician
//    and their customer actually check — who, where, which job — before the
//    items. Service and payment context is surfaced, not buried in notes.
// ---------------------------------------------------------------------------

function formatShortDate(date: Date, country: string): string {
  return date.toLocaleDateString(country === 'US' ? 'en-US' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const compact: LayoutDefinition = {
  continuation: (ctx) => slimContinuation(ctx, true),
  footer: (ctx, page, pageCount) => standardFooter(ctx, page, pageCount),
  draw: (ctx) => {
    const { doc, colors, geo, business, customer, spec, canvas } = ctx;
    const s = ctx.theme.fontScale;
    const x = geo.margin;
    const width = canvas.contentWidth;
    const STRIP_H = 52;

    // --- Strip: identity left, document identity right ------------------
    doc.rect(0, 0, geo.width, STRIP_H).fill(colors.primary);
    drawLogoBadge(ctx, x + 15, STRIP_H / 2, 15, 'on-color');
    doc
      .fillColor(colors.onPrimary)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(business.name, x + 38, 12, { width: 230 });
    const stripMeta = [business.phone, businessTaxId(business)]
      .filter(Boolean)
      .join('  ·  ');
    if (stripMeta) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(colors.onPrimaryMuted)
        .text(stripMeta, x + 38, 31, { width: 250 });
    }

    const insetW = 170;
    const insetX = geo.width - geo.margin - insetW;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(colors.onPrimaryMuted)
      .text(spec.title, insetX, 11, { width: insetW, align: 'right', characterSpacing: 1 });
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(colors.onPrimary)
      .text(spec.number, insetX, 22, { width: insetW, align: 'right' });
    if (spec.metaRows[0]) {
      // The document date. The number is already the headline directly above,
      // so this row must not repeat it.
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(colors.onPrimaryMuted)
        .text(spec.metaRows[0].value, insetX, 39, { width: insetW, align: 'right' });
    }

    // --- Three-cell context row: who / where / which job ----------------
    const svc = spec.serviceContext;
    const cells: { label: string; lines: string[] }[] = [
      {
        label: 'CUSTOMER',
        lines: [customer.name, customer.phone].filter(Boolean) as string[],
      },
      {
        label: 'SERVICE ADDRESS',
        lines: [customer.address ?? 'Not recorded'],
      },
    ];
    const jobLines: string[] = [];
    if (svc?.technicianName) jobLines.push(svc.technicianName);
    if (svc?.jobReference) jobLines.push('Job ' + svc.jobReference);
    spec.metaRows.slice(1).forEach((row) => jobLines.push(row.label + ': ' + row.value));
    cells.push({
      label: svc?.technicianName ? 'TECHNICIAN / JOB' : 'INVOICE DETAILS',
      lines: jobLines.length ? jobLines : ['—'],
    });

    const y = STRIP_H + 12;
    const cellW = width / cells.length;
    const cellHeights = cells.map((cell) =>
      cell.lines.reduce(
        (sum, line) => sum + measureText(doc, line, cellW - 22, 'Helvetica', 8.5) + 1,
        0,
      ),
    );
    const rowH = Math.max(Math.max(...cellHeights), 20) + 24;
    doc.rect(x, y, width, rowH).fill(colors.stripe);
    cells.forEach((cell, i) => {
      const cx = x + cellW * i;
      if (i > 0) {
        doc
          .moveTo(cx, y + 6)
          .lineTo(cx, y + rowH - 6)
          .strokeColor(colors.border)
          .lineWidth(0.6)
          .stroke();
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(colors.tintText)
        .text(cell.label, cx + 11, y + 7, { width: cellW - 22, characterSpacing: 0.8 });
      let ly = y + 18;
      cell.lines.forEach((line, index) => {
        doc
          .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .fillColor(index === 0 ? colors.text : colors.textSecondary)
          .text(line, cx + 11, ly, { width: cellW - 22 });
        ly = doc.y + 1;
      });
    });
    canvas.y = y + rowH + 12;

    // --- Dense items ----------------------------------------------------
    drawTable(ctx, itemColumns(ctx, { index: true }), itemRows(ctx), {
      ...DEFAULT_TABLE_STYLE,
      scale: s,
      cellPadX: 8,
      headerHeight: 22,
      zebra: true,
      headerFill: 'tint',
    });
    canvas.y += 10;

    // --- Totals, tight, right ------------------------------------------
    const totalsW = 214;
    canvas.ensure(measureTotals(ctx, { x, width: totalsW, scale: 0.95 }) + 10);
    canvas.y = drawTotals(ctx, canvas.y, {
      x: x + width - totalsW,
      width: totalsW,
      scale: 0.95,
      grand: 'bar',
    });
    canvas.y += 14;

    // --- Field-service grid: payment / dates / notes --------------------
    const payLines = paymentLines(business);
    const gridCells: { label: string; lines: string[]; pill?: boolean }[] = [];

    const paymentValue: string[] = [];
    if (spec.payment?.method) paymentValue.push(spec.payment.method);
    if (spec.payment?.paidLabel) paymentValue.push(spec.payment.paidLabel);
    // Skip an instruction line that just restates the method already shown
    // above it ("UPI" then "UPI: name@bank").
    const extraPayLine = payLines.find(
      (line) => line.label.toLowerCase() !== (spec.payment?.method ?? '').toLowerCase(),
    );
    if (extraPayLine) {
      paymentValue.push(extraPayLine.label + ': ' + extraPayLine.value);
    }
    gridCells.push({
      label: 'PAYMENT',
      lines: paymentValue.length ? paymentValue : ['—'],
      pill: true,
    });

    const dateLines: string[] = [];
    if (svc?.serviceDate) {
      dateLines.push('Service: ' + formatShortDate(svc.serviceDate, spec.country));
    }
    if (svc?.nextServiceDate) {
      dateLines.push('Next due: ' + formatShortDate(svc.nextServiceDate, spec.country));
    }
    if (dateLines.length) gridCells.push({ label: 'SERVICE DATES', lines: dateLines });

    const noteLines = [svc?.serviceNotes, spec.notes].filter(Boolean) as string[];
    if (noteLines.length) gridCells.push({ label: 'NOTES', lines: noteLines });

    const gCellW = width / gridCells.length;
    const gridHeights = gridCells.map(
      (cell) =>
        cell.lines.reduce(
          (sum, line) => sum + measureText(doc, line, gCellW - 22, 'Helvetica', 8) + 1,
          0,
        ) + (cell.pill ? 18 : 0),
    );
    const gridH = Math.max(Math.max(...gridHeights), 26) + 22;
    canvas.ensure(gridH + 10);
    const gridTop = canvas.y;
    doc.rect(x, gridTop, width, gridH).lineWidth(0.8).strokeColor(colors.border).stroke();
    gridCells.forEach((cell, i) => {
      const cx = x + gCellW * i;
      if (i > 0) {
        doc
          .moveTo(cx, gridTop)
          .lineTo(cx, gridTop + gridH)
          .strokeColor(colors.border)
          .lineWidth(0.6)
          .stroke();
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(colors.textMuted)
        .text(cell.label, cx + 11, gridTop + 7, {
          width: gCellW - 22,
          characterSpacing: 0.8,
        });
      let ly = gridTop + 17;
      cell.lines.forEach((line) => {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(colors.text)
          .text(line, cx + 11, ly, { width: gCellW - 22 });
        ly = doc.y + 1;
      });
      if (cell.pill) {
        drawStatusPill(ctx, cx + gCellW - 11, ly + 2, 0.8);
      }
    });
    canvas.y = gridTop + gridH + 12;

    if (spec.terms) {
      drawTextPanel(ctx, 'TERMS', spec.terms, {
        x,
        width,
        variant: 'filled',
        scale: 0.92,
      });
    }
    if (business.signature) {
      canvas.ensure(measureSignature(ctx));
      drawSignatureBlock(ctx, canvas.y, x + width, 140);
    }
  },
};

export const DOCUMENT_LAYOUTS: Record<DocumentLayoutId, LayoutDefinition> = {
  banded: classic,
  sidebar: modern,
  letterhead: minimal,
  formal,
  dense: compact,
};
