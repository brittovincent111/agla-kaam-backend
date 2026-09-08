import { calculateInvoiceTotals, computeDisplayStatus } from './invoice-options';

describe('calculateInvoiceTotals', () => {
  it('returns all zeros for no items and no discount', () => {
    expect(calculateInvoiceTotals([], 0)).toEqual({
      subtotal: 0,
      taxTotal: 0,
      discount: 0,
      total: 0,
    });
  });

  it('sums quantity × rate across items for the subtotal', () => {
    const totals = calculateInvoiceTotals([
      { quantity: 2, rate: 100 },
      { quantity: 1, rate: 250 },
    ]);
    expect(totals.subtotal).toBe(450);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(450);
  });

  it('computes tax per item at that item\'s own taxRate, not a blended rate', () => {
    // 100 @ 18% = 18, 200 @ 5% = 10 — items must not share one rate.
    const totals = calculateInvoiceTotals([
      { quantity: 1, rate: 100, taxRate: 18 },
      { quantity: 1, rate: 200, taxRate: 5 },
    ]);
    expect(totals.subtotal).toBe(300);
    expect(totals.taxTotal).toBe(28);
    expect(totals.total).toBe(328);
  });

  it('treats a missing taxRate as 0, not an error', () => {
    const totals = calculateInvoiceTotals([{ quantity: 1, rate: 100 }]);
    expect(totals.taxTotal).toBe(0);
  });

  it('applies tax to the pre-discount subtotal (discount only reduces the subtotal side)', () => {
    // This documents current, deliberate behaviour — tax is computed on the
    // full item amount, and discount is subtracted from subtotal separately,
    // not from the taxable base.
    const totals = calculateInvoiceTotals(
      [{ quantity: 1, rate: 1000, taxRate: 10 }],
      200,
    );
    expect(totals.subtotal).toBe(1000);
    expect(totals.taxTotal).toBe(100);
    expect(totals.discount).toBe(200);
    // (1000 - 200) + 100, not (1000 - 200) * 1.10
    expect(totals.total).toBe(900);
  });

  it('never lets a discount larger than the subtotal push the total negative', () => {
    const totals = calculateInvoiceTotals(
      [{ quantity: 1, rate: 100, taxRate: 10 }],
      500,
    );
    expect(totals.subtotal).toBe(100);
    expect(totals.taxTotal).toBe(10);
    // subtotal - discount clamps to 0, tax still applies: 0 + 10 = 10.
    expect(totals.total).toBe(10);
  });

  it('rounds to 2 decimal places without floating-point drift', () => {
    // 0.1 + 0.2 style drift: three items whose naive sum is not exactly
    // representable in binary floating point.
    const totals = calculateInvoiceTotals([
      { quantity: 3, rate: 19.99, taxRate: 18 },
      { quantity: 1, rate: 10.1 },
      { quantity: 2, rate: 5.05 },
    ]);
    // Every value must be a clean 2-decimal number — no 1782.9999999999998.
    for (const v of Object.values(totals)) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
    expect(totals.subtotal).toBe(80.17);
  });

  it('rounds a fractional discount to 2 decimal places', () => {
    const totals = calculateInvoiceTotals([{ quantity: 1, rate: 100 }], 33.333);
    expect(totals.discount).toBe(33.33);
  });

  it('is not double-charged when the same items are summed twice (no compounding)', () => {
    const items = [
      { quantity: 2, rate: 150, taxRate: 12 },
      { quantity: 1, rate: 300, taxRate: 12 },
    ];
    const a = calculateInvoiceTotals(items);
    const b = calculateInvoiceTotals(items);
    expect(a).toEqual(b);
    // Tax is 12% of the raw line amounts, not 12% applied on top of itself.
    expect(a.taxTotal).toBe(round2((2 * 150 + 300) * 0.12));
  });
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

describe('computeDisplayStatus', () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

  it('shows "overdue" for an unpaid invoice past its due date', () => {
    expect(computeDisplayStatus('unpaid', past, 100)).toBe('overdue');
  });

  it('shows "overdue" for a partially-paid invoice past its due date', () => {
    expect(computeDisplayStatus('partially_paid', past, 50)).toBe('overdue');
  });

  it('does not show "overdue" once balanceDue is 0, even if past due', () => {
    expect(computeDisplayStatus('unpaid', past, 0)).toBe('unpaid');
  });

  it('does not show "overdue" before the due date', () => {
    expect(computeDisplayStatus('unpaid', future, 100)).toBe('unpaid');
  });

  it('never overrides a terminal status like "paid" or "cancelled"', () => {
    expect(computeDisplayStatus('paid', past, 0)).toBe('paid');
    expect(computeDisplayStatus('cancelled', past, 100)).toBe('cancelled');
  });
});
