import { escapeRegex } from './cursor-page';

/**
 * How many customers a name search may expand to before it stops widening.
 *
 * Invoices, quotations, proforma invoices and services all store only a
 * customer id, so searching them by customer name means resolving names to
 * ids first. A term like "kumar" can match the whole book, and an unbounded
 * `$in` would put every id in the business into the query — a term that
 * broad is not how anyone finds one document.
 */
export const SEARCH_CUSTOMER_CAP = 500;

/**
 * Matches a term against a document's own number field and, via a bounded id
 * lookup, against its customer.
 *
 * These lists used to fetch every row and filter in JavaScript, which is why
 * search covered the customer's name and phone for free. Keeping that reach
 * once the list is paged is what this is for.
 */
export function numberOrCustomerFilter(
  search: string | undefined,
  numberField: string,
  customerIds: string[],
  customerIdMatcher: (ids: string[]) => unknown,
): Record<string, unknown> {
  const term = (search ?? '').trim();
  if (!term) return {};
  const clauses: Record<string, unknown>[] = [
    { [numberField]: { $regex: escapeRegex(term), $options: 'i' } },
  ];
  if (customerIds.length) {
    clauses.push({ customerId: customerIdMatcher(customerIds) });
  }
  return { $or: clauses };
}
