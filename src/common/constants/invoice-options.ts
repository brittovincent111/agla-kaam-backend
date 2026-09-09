export const INVOICE_STATUSES = [
  'draft',
  'unpaid',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// Statuses a business can actually set — 'overdue' is derived (see
// computeDisplayStatus below), never chosen directly.
export const SETTABLE_INVOICE_STATUSES = INVOICE_STATUSES.filter(
  (status) => status !== 'overdue',
);

export const PAYMENT_METHODS = [
  'cash',
  'upi',
  'bank_transfer',
  'card',
  'cheque',
  'other',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Print-ready names — 'bank_transfer' is not something to show a customer.
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  cheque: 'Cheque',
  other: 'Other',
};

export interface InvoiceItemInput {
  quantity: number;
  rate: number;
  taxRate?: number;
}

export interface PricedLine {
  // quantity x rate, before any discount.
  amount: number;
  // This line's share of the invoice-level discount.
  discountShare: number;
  // amount - discountShare. The value tax is actually charged on.
  taxableAmount: number;
  taxAmount: number;
}

export interface InvoiceTotals {
  subtotal: number;
  taxTotal: number;
  discount: number;
  total: number;
  lines: PricedLine[];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Spreads an invoice-level discount across the lines in proportion to their
// value, so tax can be charged on the discounted amount.
//
// Uses largest-remainder apportionment rather than rounding each share
// independently: rounding independently loses or gains paise, and the shares
// then would not add up to the discount the customer was promised.
function allocateDiscount(amounts: number[], discount: number): number[] {
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0);
  if (discount <= 0 || subtotal <= 0) return amounts.map(() => 0);

  // Never discount more than the goods are worth.
  const capped = Math.min(discount, subtotal);
  const exact = amounts.map((amount) => (amount / subtotal) * capped);
  const floored = exact.map((value) => Math.floor(value * 100) / 100);

  let remainder = round2(capped - floored.reduce((sum, value) => sum + value, 0));
  // Hand the leftover paise to the lines with the largest fractional part.
  const order = exact
    .map((value, index) => ({ index, frac: value * 100 - Math.floor(value * 100) }))
    .sort((a, b) => b.frac - a.frac);

  const shares = [...floored];
  for (const { index } of order) {
    if (remainder <= 0) break;
    shares[index] = round2(shares[index] + 0.01);
    remainder = round2(remainder - 0.01);
  }
  return shares;
}

// The single source of truth for invoice math — used on create/update so the
// stored totals can never drift from what the line items add up to.
//
// Tax is charged on the DISCOUNTED value, not the gross. Previously the
// discount was subtracted from the subtotal but tax was still computed on the
// full line amounts, so a Rs.10,000 invoice with 18% GST and a Rs.2,000
// discount charged Rs.1,800 of tax instead of Rs.1,440 — overcharging the
// customer and misstating the taxable value on a GST invoice.
export function calculateInvoiceTotals(
  items: InvoiceItemInput[],
  discount = 0,
): InvoiceTotals {
  const amounts = items.map((item) => round2(item.quantity * item.rate));
  const subtotal = round2(amounts.reduce((sum, amount) => sum + amount, 0));
  const shares = allocateDiscount(amounts, discount);

  const lines: PricedLine[] = items.map((item, index) => {
    const amount = amounts[index];
    const discountShare = shares[index];
    const taxableAmount = round2(amount - discountShare);
    const taxAmount = round2(taxableAmount * ((item.taxRate ?? 0) / 100));
    return { amount, discountShare, taxableAmount, taxAmount };
  });

  // Summed from the rounded per-line figures so the tax column on the PDF
  // adds up to the tax total printed beneath it.
  const taxTotal = round2(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  const appliedDiscount = round2(shares.reduce((sum, share) => sum + share, 0));
  const total = round2(subtotal - appliedDiscount + taxTotal);

  return { subtotal, taxTotal, discount: appliedDiscount, total, lines };
}

// Writes the per-line tax back onto the stored items. The invoice's tax
// column and its tax total must come from the same calculation, or the PDF
// shows a column that does not add up to the figure beneath it.
export function applyLineTax<T extends { taxAmount: number }>(
  items: T[],
  totals: InvoiceTotals,
): T[] {
  items.forEach((item, index) => {
    const line = totals.lines[index];
    if (line) item.taxAmount = line.taxAmount;
  });
  return items;
}

// 'overdue' is a read-time view of an unpaid/partially-paid invoice past its
// due date — never persisted, so there's no cron job needed to keep it fresh.
export function computeDisplayStatus(
  status: InvoiceStatus,
  dueDate: Date,
  balanceDue: number,
): InvoiceStatus {
  if (
    (status === 'unpaid' || status === 'partially_paid') &&
    balanceDue > 0 &&
    dueDate.getTime() < Date.now()
  ) {
    return 'overdue';
  }
  return status;
}
