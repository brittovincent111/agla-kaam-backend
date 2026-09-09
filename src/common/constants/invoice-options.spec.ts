import { calculateInvoiceTotals, computeDisplayStatus } from './invoice-options';

describe('calculateInvoiceTotals', () => {
  it('returns all zeros for no items and no discount', () => {
    expect(calculateInvoiceTotals([], 0)).toEqual({
      subtotal: 0,
      taxTotal: 0,
      discount: 0,
      total: 0,
      lines: [],
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

  it('applies tax to the DISCOUNTED value, not the gross subtotal', () => {
    // This reverses what this file previously documented as deliberate
    // ("tax is computed on the full item amount"). That behaviour was wrong:
    // under CGST s.15(3)(a) a discount given at the time of supply and
    // recorded on the invoice is excluded from the taxable value, so tax on
    // the gross amount both overcharges the customer and misstates the
    // taxable value on a GST invoice.
    const totals = calculateInvoiceTotals(
      [{ quantity: 1, rate: 1000, taxRate: 10 }],
      200,
    );
    expect(totals.subtotal).toBe(1000);
    expect(totals.discount).toBe(200);
    // 10% of 800, not of 1000.
    expect(totals.taxTotal).toBe(80);
    expect(totals.total).toBe(880);
  });

  it('never lets a discount larger than the subtotal push the total negative', () => {
    const totals = calculateInvoiceTotals(
      [{ quantity: 1, rate: 100, taxRate: 10 }],
      500,
    );
    expect(totals.subtotal).toBe(100);
    // The discount is capped at the subtotal, so there is nothing left to
    // tax. Charging tax on a fully discounted invoice (the old behaviour,
    // which returned 10) is not defensible.
    expect(totals.discount).toBe(100);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('rounds to 2 decimal places without floating-point drift', () => {
    // 0.1 + 0.2 style drift: three items whose naive sum is not exactly
    // representable in binary floating point.
    const totals = calculateInvoiceTotals([
      { quantity: 3, rate: 19.99, taxRate: 18 },
      { quantity: 1, rate: 10.1 },
      { quantity: 2, rate: 5.05 },
    ]);
    // Every money value must be a clean 2-decimal number — no
    // 1782.9999999999998. `lines` is skipped here; its own rounding is
    // asserted by the per-line tests below.
    for (const v of Object.values(totals)) {
      if (typeof v !== 'number') continue;
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

// Tax must be charged on the discounted value. The previous implementation
// subtracted the discount from the subtotal but computed tax on the gross
// line amounts, overcharging the customer and misstating the taxable value.
describe('calculateInvoiceTotals — discount and tax interaction', () => {
  it('charges tax on the discounted amount, not the gross', () => {
    const totals = calculateInvoiceTotals(
      [{ quantity: 1, rate: 10000, taxRate: 18 }],
      2000,
    );
    expect(totals.subtotal).toBe(10000);
    expect(totals.discount).toBe(2000);
    // 18% of 8000, not of 10000 (which would have been 1800).
    expect(totals.taxTotal).toBe(1440);
    expect(totals.total).toBe(9440);
  });

  it('spreads the discount across lines in proportion to value', () => {
    const totals = calculateInvoiceTotals(
      [
        { quantity: 1, rate: 750, taxRate: 18 },
        { quantity: 1, rate: 250, taxRate: 18 },
      ],
      100,
    );
    expect(totals.lines[0].discountShare).toBe(75);
    expect(totals.lines[1].discountShare).toBe(25);
    expect(totals.lines[0].taxableAmount).toBe(675);
    expect(totals.lines[1].taxableAmount).toBe(225);
    expect(totals.taxTotal).toBe(162);
    expect(totals.total).toBe(1062);
  });

  it('taxes only the lines that carry a rate, but discounts all of them', () => {
    const totals = calculateInvoiceTotals(
      [
        { quantity: 1, rate: 500, taxRate: 18 },
        { quantity: 1, rate: 500, taxRate: 0 },
      ],
      200,
    );
    // Each line absorbs 100 of discount; only the first is taxed.
    expect(totals.lines[0].taxAmount).toBe(72);
    expect(totals.lines[1].taxAmount).toBe(0);
    expect(totals.taxTotal).toBe(72);
    expect(totals.total).toBe(872);
  });

  it('per-line tax adds up to the tax total (the PDF column must foot)', () => {
    const totals = calculateInvoiceTotals(
      [
        { quantity: 3, rate: 333.33, taxRate: 18 },
        { quantity: 7, rate: 11.11, taxRate: 18 },
        { quantity: 1, rate: 99.99, taxRate: 5 },
      ],
      57.77,
    );
    const summed = totals.lines.reduce((sum, line) => sum + line.taxAmount, 0);
    expect(Math.round(summed * 100) / 100).toBe(totals.taxTotal);
  });

  it('apportioned shares add up to exactly the discount given', () => {
    // 100/3 does not divide evenly — largest-remainder must not lose a paisa.
    const totals = calculateInvoiceTotals(
      [
        { quantity: 1, rate: 100, taxRate: 18 },
        { quantity: 1, rate: 100, taxRate: 18 },
        { quantity: 1, rate: 100, taxRate: 18 },
      ],
      100,
    );
    const summed = totals.lines.reduce((sum, line) => sum + line.discountShare, 0);
    expect(Math.round(summed * 100) / 100).toBe(100);
    expect(totals.discount).toBe(100);
  });

  it('never discounts below zero', () => {
    const totals = calculateInvoiceTotals([{ quantity: 1, rate: 100, taxRate: 18 }], 500);
    expect(totals.discount).toBe(100);
    expect(totals.lines[0].taxableAmount).toBe(0);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('behaves as before when there is no discount', () => {
    const totals = calculateInvoiceTotals(
      [{ quantity: 2, rate: 599, taxRate: 18 }],
      0,
    );
    expect(totals.subtotal).toBe(1198);
    expect(totals.discount).toBe(0);
    expect(totals.taxTotal).toBe(215.64);
    expect(totals.total).toBe(1413.64);
  });

  it('handles a zero-tax invoice with a discount', () => {
    const totals = calculateInvoiceTotals([{ quantity: 1, rate: 1000 }], 100);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(900);
  });
});
