import { andFilters } from '../common/pagination/cursor-page';

// Cursor paging for the customer list.
//
// Customers are the one list ordered by NAME rather than by date, and the one
// whose search has to understand phone numbers, so the cursor and the search
// filter live here rather than in common/pagination. The `$and` combining
// rule is shared — see andFilters there for why spreading was a bug.
//
// Customers are ordered by name, which is not unique, so the cursor carries
// both the name and the id of the last row returned. Offset paging (skip/
// limit) would re-scan from the start on every page and can drop or repeat
// a row when the underlying data changes between requests.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface CustomerCursor {
  name: string;
  id: string;
}

export function encodeCursor(cursor: CustomerCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

// Returns null for anything unparseable rather than throwing — a stale or
// hand-edited cursor should quietly start from the beginning, not 500.
export function decodeCursor(raw?: string): CustomerCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.name !== 'string' || typeof parsed?.id !== 'string') {
      return null;
    }
    return { name: parsed.name, id: parsed.id };
  } catch {
    return null;
  }
}

// Rows strictly after the cursor in (name, _id) order.
export function cursorFilter(cursor: CustomerCursor | null): Record<string, unknown> {
  if (!cursor) return {};
  return {
    $or: [
      { name: { $gt: cursor.name } },
      { name: cursor.name, _id: { $gt: cursor.id } },
    ],
  };
}

// Escapes a user-supplied search term so it cannot act as a regular
// expression — "." or "+" in a phone number would otherwise match anything.
export function searchFilter(search?: string): Record<string, unknown> {
  const term = (search ?? '').trim();
  if (!term) return {};
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clauses: Record<string, unknown>[] = [
    { name: { $regex: escaped, $options: 'i' } },
  ];
  // Only a term made *entirely* of phone characters is treated as a phone
  // number, matched on its digits alone so "98100 04242", "+91-98100-04242"
  // and "004242" all find "+919810004242".
  //
  // The digits used to be pulled out of any term, which made a search
  // containing both letters and numbers match on the numbers: "4242zzqq"
  // found customer 4242, and an address-style "Flat 123 Ravi" returned 15
  // unrelated customers whose phone number happened to contain "123".
  const digits = term.replace(/\D/g, '');
  if (PHONE_LIKE.test(term) && digits.length >= 3) {
    clauses.push({ phone: { $regex: digits } });
  } else {
    clauses.push({ phone: { $regex: escaped, $options: 'i' } });
  }
  return { $or: clauses };
}

// Digits plus the punctuation people type inside phone numbers — no letters.
const PHONE_LIKE = /^[0-9+\-()\s.]+$/;

// Re-exported so callers keep importing their query helpers from one place.
export { andFilters };
