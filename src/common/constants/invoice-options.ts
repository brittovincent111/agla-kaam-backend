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

export interface InvoiceTotals {
  subtotal: number;
  taxTotal: number;
  discount: number;
  total: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// The single source of truth for invoice math — used on create/update so the
// stored totals can never drift from what the line items actually add up to.
export function calculateInvoiceTotals(
  items: InvoiceItemInput[],
  discount = 0,
): InvoiceTotals {
  const subtotal = round2(
    items.reduce((sum, item) => sum + item.quantity * item.rate, 0),
  );
  const taxTotal = round2(
    items.reduce(
      (sum, item) => sum + item.quantity * item.rate * ((item.taxRate ?? 0) / 100),
      0,
    ),
  );
  const total = round2(Math.max(0, subtotal - discount) + taxTotal);
  return { subtotal, taxTotal, discount: round2(discount), total };
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
