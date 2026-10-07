import { InvoicingService } from './invoicing.service';

// Home's "Payments to collect". Counted and summed in the database with just
// three invoices fetched — it used to load every unpaid invoice with its
// whole customer to add up one field. The response shape is what installed
// apps read, so it must not change.
describe('InvoicingService.findOutstandingSummary', () => {
  const BUSINESS_ID = '507f1f77bcf86cd799439012';

  function setup(opts: {
    totals: { count: number; outstandingTotal: number }[];
    upcoming: Record<string, unknown>[];
  }) {
    const chain: Record<string, jest.Mock> = {};
    chain.sort = jest.fn(() => chain);
    chain.limit = jest.fn(() => chain);
    chain.populate = jest.fn(() => chain);
    chain.exec = jest.fn(async () =>
      opts.upcoming.map((plain) => ({ toObject: () => ({ ...plain }) })),
    );
    const invoiceModel = {
      aggregate: jest.fn(() => ({ exec: jest.fn(async () => opts.totals) })),
      find: jest.fn(() => chain),
    };
    const service: any = Object.create(InvoicingService.prototype);
    service.invoiceModel = invoiceModel;
    return { service: service as InvoicingService, invoiceModel, chain };
  }

  it('returns the count and total from one aggregate and three invoices', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const { service, invoiceModel, chain } = setup({
      totals: [{ count: 12, outstandingTotal: 4567.899999 }],
      upcoming: [
        { _id: 'i1', status: 'unpaid', dueDate: future, balanceDue: 100 },
        { _id: 'i2', status: 'partially_paid', dueDate: future, balanceDue: 50 },
        { _id: 'i3', status: 'unpaid', dueDate: future, balanceDue: 10 },
      ],
    });

    const result = await service.findOutstandingSummary(BUSINESS_ID);

    expect(result.count).toBe(12);
    expect(result.outstandingTotal).toBe(4567.9);
    expect(result.upcoming.map((i: any) => i._id)).toEqual(['i1', 'i2', 'i3']);

    const [pipeline] = (invoiceModel.aggregate.mock.calls[0] as unknown[][]);
    expect((pipeline as any[])[0].$match.status).toEqual({
      $in: ['unpaid', 'partially_paid'],
    });
    expect((pipeline as any[])[1].$group.count).toEqual({ $sum: 1 });
    expect(chain.limit).toHaveBeenCalledWith(3);
    expect(chain.sort).toHaveBeenCalledWith({ dueDate: 1, _id: 1 });
    expect(chain.populate).toHaveBeenCalledWith('customerId', 'name phone');
  });

  it('shows a past-due invoice as overdue, as before', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);
    const { service } = setup({
      totals: [{ count: 1, outstandingTotal: 100 }],
      upcoming: [{ _id: 'i1', status: 'unpaid', dueDate: past, balanceDue: 100 }],
    });

    const result = await service.findOutstandingSummary(BUSINESS_ID);

    expect(result.upcoming[0].status).toBe('overdue');
  });

  it('answers zero, not an error, when nothing is owed', async () => {
    const { service } = setup({ totals: [], upcoming: [] });

    await expect(service.findOutstandingSummary(BUSINESS_ID)).resolves.toEqual({
      count: 0,
      outstandingTotal: 0,
      upcoming: [],
    });
  });
});
