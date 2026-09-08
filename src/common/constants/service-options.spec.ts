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

  it('adds 1 month for "1m"', () => {
    expect(resolveNextServiceDate(serviceDate, '1m')).toEqual(
      new Date('2026-03-03T00:00:00.000Z'),
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
