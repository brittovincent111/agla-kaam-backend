import { Types } from 'mongoose';
import { InvoicingService } from './invoicing.service';

// Correcting and removing a payment from the invoice screen. The invoice
// update is a MongoDB pipeline; the fake below evaluates the operators it
// uses, so these tests check the real paid / due / status arithmetic rather
// than a copy of it.

const BIZ = '507f1f77bcf86cd799439012';
const OTHER_BIZ = '507f1f77bcf86cd799439099';
const CUSTOMER = '507f1f77bcf86cd799439013';
const INVOICE = '507f1f77bcf86cd799439014';
const PAYMENT = '507f1f77bcf86cd799439015';

const execOf = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});

function bsonEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) {
    return (
      a instanceof Types.ObjectId && b instanceof Types.ObjectId && a.equals(b)
    );
  }
  return a === b;
}

// Flat filter match, as for a Mixed path: _id (a real ObjectId path) is
// compared by value, everything else without casting.
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

// The aggregation operators the payment pipeline uses.
function evaluate(expr: any, doc: Record<string, any>): any {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return doc[expr.slice(1)];
  }
  if (Array.isArray(expr) || expr === null || typeof expr !== 'object') {
    return expr;
  }
  const [op, raw] = Object.entries(expr)[0] as [string, any[]];
  const args = raw.map((a) => evaluate(a, doc));
  switch (op) {
    case '$add':
      return args[0] + args[1];
    case '$subtract':
      return args[0] - args[1];
    case '$max':
      return Math.max(...args);
    case '$round':
      return Math.round(args[0] * 10 ** args[1]) / 10 ** args[1];
    case '$lte':
      return args[0] <= args[1];
    case '$gt':
      return args[0] > args[1];
    case '$cond':
      return args[0] ? args[1] : args[2];
    default:
      throw new Error(`unsupported operator ${op}`);
  }
}

function runPipeline(doc: Record<string, any>, stages: any[]) {
  for (const stage of stages) {
    const set = stage.$set as Record<string, unknown>;
    const next: Record<string, any> = {};
    for (const [field, expr] of Object.entries(set)) {
      next[field] = evaluate(expr, doc);
    }
    Object.assign(doc, next);
  }
}

function build(
  invoiceFields: Record<string, unknown> = {},
  options: { paymentAmount?: number; fromJob?: boolean } = {},
) {
  const invoice: any = {
    _id: new Types.ObjectId(INVOICE),
    businessId: new Types.ObjectId(BIZ),
    customerId: new Types.ObjectId(CUSTOMER),
    status: 'partially_paid',
    total: 1000,
    amountPaid: 400,
    balanceDue: 600,
    ...invoiceFields,
  };
  let payment: any = {
    _id: new Types.ObjectId(PAYMENT),
    // Payments store their references as strings (from the JWT / params).
    businessId: BIZ,
    invoiceId: INVOICE,
    customerId: invoice.customerId,
    amount: options.paymentAmount ?? 400,
    paymentMethod: 'cash',
    paymentDate: new Date('2026-10-01'),
  };

  const invoiceModel: any = {
    findById: jest.fn().mockImplementation(() => execOf({ ...invoice })),
    findOneAndUpdate: jest.fn().mockImplementation((filter, stages) => {
      if (!matches(invoice, filter)) return execOf(null);
      runPipeline(invoice, stages);
      return execOf({ ...invoice });
    }),
  };
  const paymentModel: any = {
    findOne: jest
      .fn()
      .mockImplementation((filter) =>
        execOf(payment && matches(payment, filter) ? { ...payment } : null),
      ),
    findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
      if (!payment || !matches(payment, filter)) return execOf(null);
      payment = { ...payment, ...update.$set };
      return execOf({ ...payment });
    }),
    findOneAndDelete: jest.fn().mockImplementation((filter) => {
      if (!payment || !matches(payment, filter)) return execOf(null);
      const removed = payment;
      payment = null;
      return execOf(removed);
    }),
  };
  const serviceModel: any = {
    exists: jest
      .fn()
      .mockReturnValue(
        execOf(options.fromJob ? { _id: new Types.ObjectId() } : null),
      ),
  };
  const service = new InvoicingService(
    invoiceModel,
    paymentModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    serviceModel,
  );
  return {
    service,
    invoice,
    getPayment: () => payment,
    invoiceModel,
    paymentModel,
    serviceModel,
  };
}

describe('InvoicingService.updatePayment', () => {
  it('raises the amount: only the difference moves the invoice', async () => {
    const { service, invoice } = build();
    const result = await service.updatePayment(BIZ, INVOICE, PAYMENT, {
      amount: 700,
    });
    expect(invoice.amountPaid).toBe(700);
    expect(invoice.balanceDue).toBe(300);
    expect(invoice.status).toBe('partially_paid');
    expect(result.payment.amount).toBe(700);
  });

  it('raising it to the full total marks the invoice paid', async () => {
    const { service, invoice } = build();
    await service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 1000 });
    expect(invoice.balanceDue).toBe(0);
    expect(invoice.status).toBe('paid');
  });

  it('allows an overpayment as recordPayment does: the balance stops at 0', async () => {
    const { service, invoice } = build();
    await service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 1200.5 });
    expect(invoice.amountPaid).toBe(1200.5);
    expect(invoice.balanceDue).toBe(0);
    expect(invoice.status).toBe('paid');
  });

  it('lowers the amount: a paid invoice goes back to part-paid', async () => {
    const { service, invoice } = build(
      { status: 'paid', amountPaid: 1000, balanceDue: 0 },
      { paymentAmount: 1000 },
    );
    await service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 800 });
    expect(invoice.amountPaid).toBe(800);
    expect(invoice.balanceDue).toBe(200);
    expect(invoice.status).toBe('partially_paid');
  });

  it('rounds to paise', async () => {
    const { service, invoice } = build();
    await service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 333.333 });
    expect(invoice.amountPaid).toBe(333.33);
    expect(invoice.balanceDue).toBe(666.67);
  });

  it('changing only the method or date leaves the invoice alone', async () => {
    const { service, invoiceModel, getPayment } = build();
    await service.updatePayment(BIZ, INVOICE, PAYMENT, {
      paymentMethod: 'upi',
      paymentDate: '2026-10-02',
    });
    expect(invoiceModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(getPayment().paymentMethod).toBe('upi');
    expect(getPayment().paymentDate).toEqual(new Date('2026-10-02'));
  });

  it('claims the payment on the amount it read, so racing edits cannot both apply', async () => {
    const { service, paymentModel } = build();
    await service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 500 });
    const [filter] = paymentModel.findOneAndUpdate.mock.calls[0];
    expect(filter.amount).toBe(400);
  });

  it('refuses when the payment changed underneath it', async () => {
    const { service, paymentModel, invoiceModel } = build();
    paymentModel.findOneAndUpdate.mockReturnValueOnce(execOf(null));
    await expect(
      service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 500 }),
    ).rejects.toThrow('This payment was just changed');
    expect(invoiceModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses on a cancelled invoice', async () => {
    const { service, paymentModel } = build({ status: 'cancelled' });
    await expect(
      service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 500 }),
    ).rejects.toThrow('cancelled invoice');
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses another business — the invoice is not theirs', async () => {
    const { service, paymentModel } = build();
    await expect(
      service.updatePayment(OTHER_BIZ, INVOICE, PAYMENT, { amount: 500 }),
    ).rejects.toThrow('Invoice not found');
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('looks the payment up by business and invoice in both stored forms', async () => {
    const { service, paymentModel } = build();
    await service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 500 });
    expect(paymentModel.findOne).toHaveBeenCalledWith({
      _id: PAYMENT,
      businessId: { $in: [BIZ, new Types.ObjectId(BIZ)] },
      invoiceId: { $in: [INVOICE, new Types.ObjectId(INVOICE)] },
    });
  });

  it('refuses a payment that belongs to another invoice', async () => {
    const { service, getPayment } = build();
    getPayment().invoiceId = '507f1f77bcf86cd799439088';
    await expect(
      service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 500 }),
    ).rejects.toThrow('Payment not found');
  });

  it('refuses a payment taken at a job visit — it is changed on the job', async () => {
    const { service, serviceModel, invoice, paymentModel } = build(
      {},
      { fromJob: true },
    );
    await expect(
      service.updatePayment(BIZ, INVOICE, PAYMENT, { amount: 500 }),
    ).rejects.toThrow('Change this on the job');
    expect(serviceModel.exists).toHaveBeenCalledWith({
      businessId: { $in: [BIZ, new Types.ObjectId(BIZ)] },
      collectionPaymentId: PAYMENT,
    });
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(invoice.amountPaid).toBe(400);
  });
});

describe('InvoicingService.removePayment', () => {
  it('takes the payment off: nothing paid any more reads unpaid', async () => {
    const { service, invoice, getPayment } = build();
    const result = await service.removePayment(BIZ, INVOICE, PAYMENT);
    expect(getPayment()).toBeNull();
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.balanceDue).toBe(1000);
    expect(invoice.status).toBe('unpaid');
    expect(result.invoice.status).toBe('unpaid');
  });

  it('leaves other payments counted', async () => {
    const { service, invoice } = build(
      { status: 'paid', amountPaid: 1000, balanceDue: 0 },
      { paymentAmount: 250 },
    );
    await service.removePayment(BIZ, INVOICE, PAYMENT);
    expect(invoice.amountPaid).toBe(750);
    expect(invoice.balanceDue).toBe(250);
    expect(invoice.status).toBe('partially_paid');
  });

  it('never takes amountPaid below zero', async () => {
    const { service, invoice } = build(
      { status: 'partially_paid', amountPaid: 100, balanceDue: 900 },
      { paymentAmount: 400 },
    );
    await service.removePayment(BIZ, INVOICE, PAYMENT);
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.balanceDue).toBe(1000);
    expect(invoice.status).toBe('unpaid');
  });

  it('a second delete of the same payment subtracts nothing', async () => {
    const { service, invoice, paymentModel } = build();
    paymentModel.findOneAndDelete.mockReturnValueOnce(execOf(null));
    await expect(service.removePayment(BIZ, INVOICE, PAYMENT)).rejects.toThrow(
      'Payment not found',
    );
    expect(invoice.amountPaid).toBe(400);
  });

  it('refuses on a cancelled invoice', async () => {
    const { service, getPayment } = build({ status: 'cancelled' });
    await expect(service.removePayment(BIZ, INVOICE, PAYMENT)).rejects.toThrow(
      'cancelled invoice',
    );
    expect(getPayment()).not.toBeNull();
  });

  it('refuses another business', async () => {
    const { service, getPayment } = build();
    await expect(
      service.removePayment(OTHER_BIZ, INVOICE, PAYMENT),
    ).rejects.toThrow('Invoice not found');
    expect(getPayment()).not.toBeNull();
  });

  it('refuses a payment taken at a job visit', async () => {
    const { service, getPayment } = build({}, { fromJob: true });
    await expect(service.removePayment(BIZ, INVOICE, PAYMENT)).rejects.toThrow(
      'Change this on the job',
    );
    expect(getPayment()).not.toBeNull();
  });

  it('a malformed payment id is not found, not a cast error', async () => {
    const { service } = build();
    await expect(
      service.removePayment(BIZ, INVOICE, 'not-an-id'),
    ).rejects.toThrow('Payment not found');
  });
});
