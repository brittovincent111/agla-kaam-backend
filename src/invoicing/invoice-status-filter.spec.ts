import { InvoicingService } from './invoicing.service';

// The list filters: "To collect" must cover everything still owed — the
// same invoices Home's "Payments to collect" counts — late or not.
const filterFor = (status: string) =>
  (Object.create(InvoicingService.prototype) as any).statusFilter(status);

describe('invoice list status filter', () => {
  it('"to_collect" is every unpaid or part-paid invoice with a balance, overdue included', () => {
    expect(filterFor('to_collect')).toEqual({
      status: { $in: ['unpaid', 'partially_paid'] },
      balanceDue: { $gt: 0 },
    });
  });

  it('keeps "unpaid" and "overdue" as separate, non-overlapping buckets', () => {
    expect(filterFor('overdue')).toMatchObject({ dueDate: { $lt: expect.any(Date) } });
    expect(filterFor('unpaid')).toHaveProperty('$or');
  });
});
