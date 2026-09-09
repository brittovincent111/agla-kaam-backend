import {
  andFilters,
  buildPage,
  clampLimit,
  decodePageCursor,
  encodePageCursor,
  escapeRegex,
  pageCursorFilter,
  pageSort,
  textSearchFilter,
} from './cursor-page';

describe('page cursor', () => {
  it('round-trips a cursor', () => {
    const cursor = { v: '2026-09-09T10:00:00.000Z', id: 'abc123' };
    expect(decodePageCursor(encodePageCursor(cursor))).toEqual(cursor);
  });

  it('returns null for junk rather than throwing', () => {
    expect(decodePageCursor('not-base64!!')).toBeNull();
    expect(decodePageCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
    expect(decodePageCursor(undefined)).toBeNull();
  });

  it('is an empty filter on the first page', () => {
    expect(pageCursorFilter(null, 'createdAt')).toEqual({});
  });

  // Newest-first is the normal case for these lists, so "past the cursor"
  // means older, not later.
  it('pages backwards through time when sorting descending', () => {
    const filter = pageCursorFilter(
      { v: '2026-09-09T10:00:00.000Z', id: 'x' },
      'invoiceDate',
      'desc',
    ) as { $or: Record<string, any>[] };
    expect(filter.$or[0].invoiceDate.$lt).toEqual(new Date('2026-09-09T10:00:00.000Z'));
    expect(filter.$or[1]._id.$lt).toBe('x');
  });

  it('pages forwards when sorting ascending', () => {
    const filter = pageCursorFilter({ v: 5, id: 'x' }, 'seq', 'asc') as {
      $or: Record<string, any>[];
    };
    expect(filter.$or[0].seq.$gt).toBe(5);
    expect(filter.$or[1]._id.$gt).toBe('x');
  });

  // A catalogue paged alphabetically carries a name as its sort key. Coercing
  // that to a Date would compare a Date against a string field and match
  // nothing, ending the list early — and plenty of part names parse as dates.
  it('keeps a text sort key as text instead of parsing it as a date', () => {
    const filter = pageCursorFilter({ v: '500', id: 'x' }, 'name', 'asc', 'text') as {
      $or: Record<string, any>[];
    };
    expect(filter.$or[0].name.$gt).toBe('500');
    expect(filter.$or[1].name).toBe('500');
    expect(filter.$or[1]._id.$gt).toBe('x');
  });

  // The same value on the default 'date' key type is what the text mode
  // exists to avoid — proof the two branches really differ.
  it('still parses a date sort key, which is why text mode is needed', () => {
    const filter = pageCursorFilter({ v: '500', id: 'x' }, 'createdAt', 'asc') as {
      $or: Record<string, any>[];
    };
    expect(filter.$or[0].createdAt.$gt).toBeInstanceOf(Date);
  });

  // Two rows sharing a timestamp must not straddle a page boundary — without
  // the _id tie break one of them is never returned.
  it('breaks ties on _id in both the filter and the sort', () => {
    const filter = pageCursorFilter({ v: '2026-01-01T00:00:00.000Z', id: 'm' }, 'd') as {
      $or: Record<string, any>[];
    };
    expect(filter.$or[1]).toHaveProperty('_id');
    expect(pageSort('d', 'desc')).toEqual({ d: -1, _id: -1 });
    expect(pageSort('d', 'asc')).toEqual({ d: 1, _id: 1 });
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(5000)).toBe(100);
  });
});

describe('textSearchFilter', () => {
  it('is empty for a blank term, so the list is not filtered away', () => {
    expect(textSearchFilter('', ['a'])).toEqual({});
    expect(textSearchFilter('   ', ['a'])).toEqual({});
    expect(textSearchFilter('x', [])).toEqual({});
  });

  it('matches every named field case-insensitively', () => {
    const filter = textSearchFilter('ravi', ['invoiceNumber', 'customerName']) as {
      $or: Record<string, any>[];
    };
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0].invoiceNumber.$options).toBe('i');
    expect(filter.$or[1].customerName.$regex).toBe('ravi');
  });

  it('neutralises regex metacharacters so a typed "." is a literal dot', () => {
    expect(escapeRegex('a.b+c')).toBe('a\\.b\\+c');
    // "-" needs no escaping outside a character class, so it stays literal.
    const filter = textSearchFilter('INV-1.2', ['n']) as { $or: Record<string, any>[] };
    expect(filter.$or[0].n.$regex).toBe('INV-1\\.2');
  });
});

describe('andFilters', () => {
  const scope = { $or: [{ assignedTechnicianId: 't1' }] };
  const search = { $or: [{ name: { $regex: 'ravi' } }] };
  const cursor = { $or: [{ createdAt: { $lt: 1 } }] };

  it('is empty when every fragment is empty', () => {
    expect(andFilters({}, {}, {})).toEqual({});
  });

  it('returns a lone fragment unwrapped, so the simple case stays simple', () => {
    expect(andFilters({ businessId: 'b1' }, {})).toEqual({ businessId: 'b1' });
  });

  it('keeps every $or instead of letting the last one win', () => {
    expect(andFilters({ businessId: 'b1' }, scope, search, cursor)).toEqual({
      $and: [{ businessId: 'b1' }, scope, search, cursor],
    });
  });
});

describe('buildPage', () => {
  const key = (row: { _id: string; d: string }) => ({ v: row.d, id: row._id });
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ _id: `id${i}`, d: `2026-01-0${i + 1}` }));

  it('trims the probe row and offers a cursor when more remain', () => {
    const page = buildPage(rows(4), 3, key);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
    expect(decodePageCursor(page.nextCursor!)).toEqual({ v: '2026-01-03', id: 'id2' });
  });

  it('ends the list when the probe row did not come back', () => {
    const page = buildPage(rows(3), 3, key);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result without inventing a cursor', () => {
    expect(buildPage([], 10, key)).toEqual({ items: [], nextCursor: null });
  });

  it('includes a total only when one was counted', () => {
    expect(buildPage(rows(1), 5, key, 42).total).toBe(42);
    expect(buildPage(rows(1), 5, key)).not.toHaveProperty('total');
  });
});
