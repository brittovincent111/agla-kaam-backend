/**
 * The "This month / Last month / Custom" part of a list filter.
 *
 * `from` is inclusive and `to` exclusive, both ISO instants: the phone works
 * out where the business's day starts (its own timezone) and sends those
 * instants, so the server never has to guess what "this month" means.
 * Either end may be left open.
 */
export function dateRangeFilter(
  field: string,
  from?: string,
  to?: string,
): Record<string, unknown> {
  const range: Record<string, Date> = {};
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if (start && !Number.isNaN(start.getTime())) range.$gte = start;
  if (end && !Number.isNaN(end.getTime())) range.$lt = end;
  return Object.keys(range).length ? { [field]: range } : {};
}
