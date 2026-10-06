import { amountRangeFilter, cursorValue, splitList } from './list-options';

describe('list options', () => {
  it('splits a comma list and treats a single value as a list of one', () => {
    expect(splitList('a, b,,c ')).toEqual(['a', 'b', 'c']);
    expect(splitList('only')).toEqual(['only']);
    expect(splitList(undefined)).toEqual([]);
    expect(splitList('')).toEqual([]);
  });

  it('caps how many values one parameter can carry', () => {
    expect(
      splitList(Array.from({ length: 80 }, (_, i) => `x${i}`).join(',')),
    ).toHaveLength(50);
  });

  it('builds an amount range with either end open', () => {
    expect(amountRangeFilter('total')).toEqual({});
    expect(amountRangeFilter('total', 500)).toEqual({ total: { $gte: 500 } });
    expect(amountRangeFilter('total', undefined, 2000)).toEqual({
      total: { $lte: 2000 },
    });
    expect(amountRangeFilter('total', 0, 10)).toEqual({
      total: { $gte: 0, $lte: 10 },
    });
  });

  it('puts amounts in the cursor as numbers and dates as ISO text', () => {
    expect(
      cursorValue(
        { total: 1200 },
        { field: 'total', direction: 'desc', keyType: 'number' },
      ),
    ).toBe(1200);
    const d = new Date('2026-09-01T00:00:00.000Z');
    expect(
      cursorValue(
        { dueDate: d },
        { field: 'dueDate', direction: 'asc', keyType: 'date' },
      ),
    ).toBe('2026-09-01T00:00:00.000Z');
  });
});
