import { dateRangeFilter } from './date-range';

describe('dateRangeFilter', () => {
  it('is empty when no range is given, so the list is not narrowed', () => {
    expect(dateRangeFilter('invoiceDate')).toEqual({});
    expect(dateRangeFilter('invoiceDate', '', '')).toEqual({});
  });

  it('includes the start and excludes the end', () => {
    expect(
      dateRangeFilter(
        'invoiceDate',
        '2026-09-01T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z',
      ),
    ).toEqual({
      invoiceDate: {
        $gte: new Date('2026-09-01T00:00:00.000Z'),
        $lt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
  });

  it('allows an open end', () => {
    expect(dateRangeFilter('d', '2026-09-01T00:00:00.000Z')).toEqual({
      d: { $gte: new Date('2026-09-01T00:00:00.000Z') },
    });
  });

  it('ignores a date it cannot read rather than matching nothing', () => {
    expect(
      dateRangeFilter('d', 'not-a-date', '2026-10-01T00:00:00.000Z'),
    ).toEqual({
      d: { $lt: new Date('2026-10-01T00:00:00.000Z') },
    });
  });
});
