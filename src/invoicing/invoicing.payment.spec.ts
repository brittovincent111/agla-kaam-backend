import { Types } from 'mongoose';
import { InvoicingService } from './invoicing.service';

// Invoice.businessId (like every @Prop({ type: Types.ObjectId }) here) is a
// Mixed path, so Mongoose does not cast a string filter to an ObjectId. The
// payment's invoice update used to filter on the raw string businessId from
// the JWT: for an invoice stored with an ObjectId businessId it matched
// nothing, so the payment row was saved and then the API threw
// "Invoice not found" with the balance never updated.

const BIZ = '507f1f77bcf86cd799439012';
const CUSTOMER = '507f1f77bcf86cd799439013';
const INVOICE = '507f1f77bcf86cd799439014';

const execOf = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});

// MongoDB equality as it applies to a Mixed path: an ObjectId never equals a
// string, whatever its hex.
function bsonEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) {
    return (
      a instanceof Types.ObjectId && b instanceof Types.ObjectId && a.equals(b)
    );
  }
  return a === b;
}

// Evaluates a flat filter against a stored document. _id is a real ObjectId
// path that Mongoose does cast, so it is compared by value; every other key
// is compared without casting, as Mongoose leaves a Mixed path.
function matches(
  stored: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, want]) => {
    const have = stored[key];
    if (key === '_id') return String(have) === String(want);
    if (want && typeof want === 'object' && '$in' in want) {
      return (want as { $in: unknown[] }).$in.some((c) => bsonEquals(c, have));
    }
    return bsonEquals(want, have);
  });
}

function build(storedBusinessId: string | Types.ObjectId) {
  const stored: any = {
    _id: new Types.ObjectId(INVOICE),
    businessId: storedBusinessId,
    customerId: new Types.ObjectId(CUSTOMER),
    status: 'unpaid',
    total: 1000,
    amountPaid: 0,
    balanceDue: 1000,
  };
  const invoiceModel: any = {
    findById: jest.fn().mockReturnValue(execOf(stored)),
    findOneAndUpdate: jest
      .fn()
      .mockImplementation((filter) =>
        execOf(
          matches(stored, filter)
            ? { ...stored, amountPaid: 400, balanceDue: 600 }
            : null,
        ),
      ),
  };
  const paymentModel: any = {
    create: jest
      .fn()
      .mockImplementation((doc) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
      ),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue(execOf([])),
    }),
  };
  const service = new InvoicingService(
    invoiceModel,
    paymentModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, invoiceModel, paymentModel };
}

const dto = { amount: 400, paymentMethod: 'cash' } as any;

describe('InvoicingService.recordPayment invoice filter', () => {
  it('matches the business in both stored forms', async () => {
    const { service, invoiceModel } = build(new Types.ObjectId(BIZ));
    await service.recordPayment(BIZ, INVOICE, dto);

    const [filter] = invoiceModel.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe(INVOICE);
    expect(filter.businessId).toEqual({
      $in: [BIZ, new Types.ObjectId(BIZ)],
    });
  });

  it('updates an invoice stored with an ObjectId businessId', async () => {
    const { service } = build(new Types.ObjectId(BIZ));
    const { invoice, payment } = await service.recordPayment(BIZ, INVOICE, dto);
    expect(invoice.balanceDue).toBe(600);
    expect(payment.amount).toBe(400);
  });

  it('updates an invoice stored with a string businessId', async () => {
    const { service } = build(BIZ);
    const { invoice } = await service.recordPayment(BIZ, INVOICE, dto);
    expect(invoice.balanceDue).toBe(600);
  });

  it('a bare string filter would have missed the ObjectId-stored invoice', () => {
    // Guards the fake above: without idFilter the old filter matched nothing.
    const stored = {
      _id: new Types.ObjectId(INVOICE),
      businessId: new Types.ObjectId(BIZ),
    };
    expect(matches(stored, { _id: INVOICE, businessId: BIZ })).toBe(false);
  });

  it('still refuses an invoice of another business', async () => {
    const { service } = build(new Types.ObjectId(BIZ));
    await expect(
      service.recordPayment('507f1f77bcf86cd799439099', INVOICE, dto),
    ).rejects.toThrow('Invoice not found');
  });
});

describe('InvoicingService.findPaymentsForInvoice filter', () => {
  it('matches business and invoice in both stored forms', async () => {
    const { service, paymentModel } = build(BIZ);
    await service.findPaymentsForInvoice(BIZ, INVOICE);
    expect(paymentModel.find).toHaveBeenCalledWith({
      businessId: { $in: [BIZ, new Types.ObjectId(BIZ)] },
      invoiceId: { $in: [INVOICE, new Types.ObjectId(INVOICE)] },
    });
  });
});
