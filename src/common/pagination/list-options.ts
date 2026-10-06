import { SortDirection } from './cursor-page';

/**
 * Pieces of the lists' Filters sheet that the invoice, quotation and service
 * lists share: several choices in one parameter, an amount range, and a
 * choice of sort order.
 */

// "a,b,c" → ['a','b','c']. Several technicians, customers or service types
// arrive in one query parameter; a lone value (what older apps send) is a
// list of one.
export function splitList(raw?: string, max = 50): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function amountRangeFilter(
  field: string,
  min?: number,
  max?: number,
): Record<string, unknown> {
  const range: Record<string, number> = {};
  if (typeof min === 'number' && Number.isFinite(min)) range.$gte = min;
  if (typeof max === 'number' && Number.isFinite(max)) range.$lte = max;
  return Object.keys(range).length ? { [field]: range } : {};
}

/** Which field a list is ordered by, and which way. */
export interface SortSpec {
  field: string;
  direction: SortDirection;
  // Numbers (amounts) go in the page cursor as numbers, not dates.
  keyType: 'date' | 'number';
}

export function cursorValue(
  row: Record<string, unknown>,
  spec: SortSpec,
): string | number {
  const v = row[spec.field];
  if (spec.keyType === 'number') return typeof v === 'number' ? v : 0;
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}
