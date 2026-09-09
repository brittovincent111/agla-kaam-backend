import {
  andFilters,
  cursorFilter,
  decodeCursor,
  encodeCursor,
  searchFilter,
} from './customer-page';

describe('customer cursor', () => {
  it('round-trips a cursor', () => {
    const cursor = { name: "O'Brien & Sons", id: '6aa1295dfc133bd3c0009423' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('returns null for junk rather than throwing', () => {
    // A stale cursor should restart the list, not 500 the request.
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('pages on (name, id) so duplicate names cannot stall or repeat', () => {
    const filter = cursorFilter({ name: 'Ravi Kumar', id: 'abc' }) as {
      $or: Record<string, unknown>[];
    };
    expect(filter.$or).toEqual([
      { name: { $gt: 'Ravi Kumar' } },
      { name: 'Ravi Kumar', _id: { $gt: 'abc' } },
    ]);
  });

  it('is an empty filter on the first page', () => {
    expect(cursorFilter(null)).toEqual({});
  });
});

describe('customer search', () => {
  it('is empty for a blank term, so the list is not filtered away', () => {
    expect(searchFilter(undefined)).toEqual({});
    expect(searchFilter('   ')).toEqual({});
  });

  it('matches name case-insensitively', () => {
    const f = searchFilter('ravi') as { $or: Record<string, any>[] };
    expect(f.$or[0]).toEqual({ name: { $regex: 'ravi', $options: 'i' } });
  });

  it('matches a phone by its tail digits', () => {
    const f = searchFilter('543210') as { $or: Record<string, any>[] };
    expect(f.$or[1]).toEqual({ phone: { $regex: '543210' } });
  });

  it('strips formatting from a typed phone number', () => {
    const f = searchFilter('+91 98765') as { $or: Record<string, any>[] };
    expect(f.$or[1]).toEqual({ phone: { $regex: '9198765' } });
  });

  // Regression: the digits used to be pulled out of ANY term, so a term with
  // both letters and numbers matched on the numbers alone. "4242zzqq" found
  // customer 4242, and an address-style "Flat 123 Ravi" returned every
  // customer whose phone number happened to contain "123".
  it('does not match a phone by digits pulled out of a term containing letters', () => {
    const filter = searchFilter('Flat 123 Ravi') as { $or: Record<string, any>[] };
    const phoneClause = filter.$or.find((clause) => 'phone' in clause);
    expect(phoneClause?.phone.$regex).not.toBe('123');
    expect(phoneClause?.phone.$regex).toContain('Flat 123 Ravi');
  });

  it('still matches a phone typed with formatting, which has no letters', () => {
    // The digits of whatever was typed, punctuation removed — each of these
    // is a substring of the stored "+919810004242".
    const cases: [string, string][] = [
      ['+91 98100 04242', '919810004242'],
      ['98100-04242', '9810004242'],
      ['(98100) 04242.', '9810004242'],
      ['004242', '004242'],
    ];
    for (const [term, expected] of cases) {
      const filter = searchFilter(term) as { $or: Record<string, any>[] };
      const phoneClause = filter.$or.find((clause) => 'phone' in clause);
      expect(phoneClause?.phone.$regex).toBe(expected);
    }
  });

  it('neutralises regex metacharacters in the term', () => {
    // Without escaping, ".*" would match every customer, and a stray "(" is
    // an invalid expression that would throw inside MongoDB.
    const f = searchFilter('.*') as { $or: Record<string, any>[] };
    expect(f.$or[0]).toEqual({ name: { $regex: '\\.\\*', $options: 'i' } });
    expect(() => new RegExp((f.$or[0] as any).name.$regex)).not.toThrow();

    const paren = searchFilter('(test') as { $or: Record<string, any>[] };
    expect(() => new RegExp((paren.$or[0] as any).name.$regex)).not.toThrow();
  });
});

// Regression: each of the three fragments below is a top-level `$or`, and the
// paged read originally merged them with object spread — which keeps only the
// last one. That silently dropped the technician scope when a technician
// searched (they could look up any customer in the business) and dropped the
// search term from page two onwards (scrolling a filtered list returned
// unrelated customers).
describe('andFilters', () => {
  const scope = { $or: [{ assignedTechnicianId: 't1' }] };
  const search = { $or: [{ name: { $regex: 'ravi' } }] };
  const cursor = { $or: [{ name: { $gt: 'Ravi' } }] };

  it('is empty when every fragment is empty', () => {
    expect(andFilters({}, {}, {})).toEqual({});
  });

  it('returns a lone fragment unwrapped, so the simple case stays simple', () => {
    expect(andFilters({ businessId: 'b1' }, {}, {})).toEqual({ businessId: 'b1' });
  });

  it('keeps every $or instead of letting the last one win', () => {
    const filter = andFilters({ businessId: 'b1' }, scope, search, cursor);
    expect(filter).toEqual({ $and: [{ businessId: 'b1' }, scope, search, cursor] });
  });

  it('does not lose the technician scope when a search term is present', () => {
    const filter = andFilters({ businessId: 'b1' }, scope, search) as {
      $and: Record<string, unknown>[];
    };
    expect(filter.$and).toContainEqual(scope);
    expect(filter.$and).toContainEqual(search);
  });

  it('does not lose the search term when paging past the first page', () => {
    const filter = andFilters({ businessId: 'b1' }, search, cursor) as {
      $and: Record<string, unknown>[];
    };
    expect(filter.$and).toContainEqual(search);
    expect(filter.$and).toContainEqual(cursor);
  });

  it('drops empty fragments rather than wrapping them', () => {
    expect(andFilters({ businessId: 'b1' }, {}, search)).toEqual({
      $and: [{ businessId: 'b1' }, search],
    });
  });
});
