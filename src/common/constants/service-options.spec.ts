import {
  resolveNextServiceDate,
  resolveWarrantyExpiry,
} from './service-options';

describe('resolveWarrantyExpiry', () => {
  const serviceDate = new Date('2026-01-01T00:00:00.000Z');

  it('returns null for "none"', () => {
    expect(resolveWarrantyExpiry(serviceDate, 'none')).toBeNull();
  });

  it('adds 30 days for "30d"', () => {
    expect(resolveWarrantyExpiry(serviceDate, '30d')).toEqual(
      new Date('2026-01-31T00:00:00.000Z'),
    );
  });

  it('clamps a 29 Feb warranty to 28 Feb the next year', () => {
    expect(resolveWarrantyExpiry(new Date(2028, 1, 29), '1y')).toEqual(
      new Date(2029, 1, 28),
    );
  });

  it('clamps 31 Aug + 6 months to the end of February', () => {
    expect(resolveWarrantyExpiry(new Date(2026, 7, 31), '6m')).toEqual(
      new Date(2027, 1, 28),
    );
  });

  it('adds 12 months for "1y"', () => {
    expect(resolveWarrantyExpiry(serviceDate, '1y')).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
  });

  it('uses the custom date for "custom"', () => {
    const customDate = new Date('2026-06-15T00:00:00.000Z');
    expect(resolveWarrantyExpiry(serviceDate, 'custom', customDate)).toEqual(
      customDate,
    );
  });

  it('throws for "custom" without a custom date', () => {
    expect(() => resolveWarrantyExpiry(serviceDate, 'custom')).toThrow();
  });
});

describe('resolveNextServiceDate', () => {
  const serviceDate = new Date('2026-01-31T00:00:00.000Z');

  it('returns serviceDate for "none"', () => {
    expect(resolveNextServiceDate(serviceDate, 'none')).toEqual(serviceDate);
  });

  // Local-time dates: addMonths works in the server's own calendar, so a
  // UTC midnight would land on a different day in a negative-offset zone.
  it('clamps 31 Jan + 1 month to the end of February, not 3 March', () => {
    expect(resolveNextServiceDate(new Date(2026, 0, 31), '1m')).toEqual(
      new Date(2026, 1, 28),
    );
  });

  it('clamps to 29 February in a leap year', () => {
    expect(resolveNextServiceDate(new Date(2028, 0, 31), '1m')).toEqual(
      new Date(2028, 1, 29),
    );
  });

  it('clamps 31 Aug + 3 months to 30 November', () => {
    expect(resolveNextServiceDate(new Date(2026, 7, 31), '3m')).toEqual(
      new Date(2026, 10, 30),
    );
  });

  it('keeps the day of month when it exists in the target month', () => {
    expect(resolveNextServiceDate(new Date(2026, 0, 15, 10, 30), '1m')).toEqual(
      new Date(2026, 1, 15, 10, 30),
    );
  });

  it('adds 6 months for "6m"', () => {
    expect(resolveNextServiceDate(serviceDate, '6m')).toEqual(
      new Date('2026-07-31T00:00:00.000Z'),
    );
  });

  it('uses the custom date for "custom"', () => {
    const customDate = new Date('2026-09-01T00:00:00.000Z');
    expect(resolveNextServiceDate(serviceDate, 'custom', customDate)).toEqual(
      customDate,
    );
  });

  it('throws for "custom" without a custom date', () => {
    expect(() => resolveNextServiceDate(serviceDate, 'custom')).toThrow();
  });
});
