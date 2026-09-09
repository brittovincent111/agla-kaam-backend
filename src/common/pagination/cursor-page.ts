// Cursor paging, shared by every list that grows with the size of a business:
// services, invoices, quotations, proforma invoices, purchases and AMCs.
//
// Offset paging (skip/limit) re-scans from the start on every page and can
// drop or repeat a row when the data changes between requests — for these
// lists it changes constantly, because logging a job inserts at the top.
// A cursor names the last row returned, so the next page continues from
// exactly there.
//
// The sort key (a date, usually) is not unique, so the cursor carries the
// key AND the row's id, and the query breaks ties on _id. Without the tie
// break, two rows sharing a timestamp can straddle a page boundary and one
// of them is never returned.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageCursor {
  /** The sort key of the last row on the previous page, ISO string or number. */
  v: string | number;
  /** That row's id, breaking ties when several rows share a key. */
  id: string;
}

export function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

// Returns null for anything unparseable rather than throwing — a stale or
// hand-edited cursor should quietly start from the beginning, not 500.
export function decodePageCursor(raw?: string): PageCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const value = parsed?.v;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof parsed?.id !== 'string') return null;
    return { v: value, id: parsed.id };
  } catch {
    return null;
  }
}

export type SortDirection = 'asc' | 'desc';

/**
 * What the cursor's sort key actually is.
 *
 * Most of these lists sort on a date, which arrives as an ISO string and has
 * to be compared as a Date. A list sorted alphabetically (the inventory
 * catalogue, by item name) must NOT be: `new Date('500')` is a valid date —
 * the year 500 — so an item genuinely named "500" would be compared as a
 * Date against a string field, match nothing, and silently end the list.
 */
export type CursorKeyType = 'date' | 'text';

/**
 * Rows strictly after the cursor, in (field, _id) order.
 *
 * Descending is the normal case here — newest first — and the comparison
 * flips with it, so "after the cursor" always means "further down the list
 * the user is looking at", never "later in time".
 */
export function pageCursorFilter(
  cursor: PageCursor | null,
  field: string,
  direction: SortDirection = 'desc',
  keyType: CursorKeyType = 'date',
): Record<string, unknown> {
  if (!cursor) return {};
  const beyond = direction === 'desc' ? '$lt' : '$gt';
  const value =
    keyType === 'date' && typeof cursor.v === 'string' ? new Date(cursor.v) : cursor.v;
  // A cursor whose key is not a valid date would make Mongo match nothing at
  // all, silently ending the list early; fall back to id-only paging.
  const usable = value instanceof Date && Number.isNaN(value.getTime()) ? cursor.v : value;
  return {
    $or: [
      { [field]: { [beyond]: usable } },
      { [field]: usable, _id: { [beyond]: cursor.id } },
    ],
  };
}

export function pageSort(
  field: string,
  direction: SortDirection = 'desc',
): Record<string, 1 | -1> {
  const order = direction === 'desc' ? -1 : 1;
  return { [field]: order, _id: order };
}

/**
 * Combines query fragments without letting one silently overwrite another.
 *
 * The visibility scope, the search term and the cursor each express
 * themselves as a top-level `$or`, so merging them with object spread keeps
 * only the LAST one. On the customer list that dropped the technician scope
 * whenever a technician searched (they could look up any customer in the
 * business) and dropped the search term from page two onwards (scrolling a
 * filtered list returned unrelated rows). Every fragment has to hold, which
 * is what `$and` says.
 */
export function andFilters(
  ...fragments: Record<string, unknown>[]
): Record<string, unknown> {
  const parts = fragments.filter((fragment) => Object.keys(fragment).length > 0);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { ...parts[0] };
  return { $and: parts };
}

export function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
}

// Escapes a user-supplied term so it cannot act as a regular expression —
// "." or "+" typed into a search box would otherwise match anything.
export function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds an `$or` matching the term against several string fields.
 *
 * Returns an empty filter for a blank term, so an untouched search box does
 * not filter the list away.
 */
export function textSearchFilter(
  search: string | undefined,
  fields: string[],
): Record<string, unknown> {
  const term = (search ?? '').trim();
  if (!term || fields.length === 0) return {};
  const escaped = escapeRegex(term);
  return {
    $or: fields.map((field) => ({ [field]: { $regex: escaped, $options: 'i' } })),
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Sent only with the first page — see buildPage. */
  total?: number;
}

/**
 * Turns a limit+1 result set into a page.
 *
 * Fetching one row more than asked for is how "is there another page?" is
 * answered without a second count query on every scroll.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => PageCursor,
  total?: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodePageCursor(keyOf(last)) : null,
    ...(total === undefined ? {} : { total }),
  };
}
