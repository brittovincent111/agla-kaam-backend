import { Types } from 'mongoose';
import { InvoicingService } from './invoicing.service';

// Money taken at the door belongs to the job, and has to follow the job from
// invoice to invoice in normal work: an invoice cancelled and made again, a
// job added to or taken off a sent invoice. These run cancel() and update()
// against a small in-memory store so the paid / due / status figures are the
// ones the real pipelines produce.

const BIZ = '507f1f77bcf86cd799439012';
const CUSTOMER = '507f1f77bcf86cd799439013';
const JOB_A = '507f1f77bcf86cd7994390a1';
const JOB_B = '507f1f77bcf86cd7994390b1';

const execOf = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});
const leanOf = (value: unknown) => ({
  select: () => ({ lean: () => Promise.resolve(value) }),
});

function evaluate(expr: any, doc: Record<string, any>): any {
  if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)];
  if (Array.isArray(expr) || expr === null || typeof expr !== 'object') return expr;
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
    const next: Record<string, any> = {};
    for (const [field, expr] of Object.entries(stage.$set)) {
      next[field] = evaluate(expr, doc);
    }
    Object.assign(doc, next);
  }
}

interface Job {
  _id: Types.ObjectId;
  collectionMethod: 'cash' | 'upi';
  collectionAmount: number;
  collectedAt: Date;
  collectionAppliedAt?: Date;
  collectionPaymentId?: string;
  collectionAppliedAmount?: number;
}

function world() {
  const invoices: any[] = [];
  const payments: any[] = [];
  const jobs: Job[] = [];

  const byId = (id: unknown) => invoices.find((i) => String(i._id) === String(id));
  const inIds = (want: any, have: unknown) =>
    want?.$in ? want.$in.some((w: unknown) => String(w) === String(have)) : String(want) === String(have);

  const invoiceModel: any = {
    findById: jest.fn((id) => execOf(byId(id) ?? null)),
    findOne: jest.fn((filter) => ({
      sort: () =>
        execOf(
          invoices.find(
            (i) =>
              filter.status.$in.includes(i.status) &&
              i.balanceDue > filter.balanceDue.$gt &&
              i.items.some((it: any) => inIds(filter['items.serviceId'], it.serviceId)),
          ) ?? null,
        ),
    })),
    findOneAndUpdate: jest.fn((filter, update, opts) => {
      const inv = byId(filter._id);
      if (!inv) return execOf(null);
      if (Array.isArray(update)) {
        runPipeline(inv, update);
        return execOf(inv);
      }
      if (filter.status?.$nin?.includes(inv.status)) return execOf(null);
      const before = { ...inv };
      Object.assign(inv, update.$set);
      return execOf(opts?.new === false ? before : inv);
    }),
    updateOne: jest.fn((filter, update) => {
      const inv = byId(filter._id);
      for (const [k, v] of Object.entries(update.$inc ?? {})) inv[k] += v as number;
      return execOf({});
    }),
  };

  const paymentModel: any = {
    find: jest.fn((filter) =>
      leanOf(payments.filter((p) => inIds(filter.invoiceId, p.invoiceId))),
    ),
    deleteOne: jest.fn((filter) => {
      const at = payments.findIndex((p) => String(p._id) === String(filter._id));
      if (at >= 0) payments.splice(at, 1);
      return execOf({});
    }),
    create: jest.fn(async (doc) => {
      const payment = { _id: new Types.ObjectId(), ...doc };
      payments.push(payment);
      return payment;
    }),
  };

  const serviceModel: any = {
    find: jest.fn((filter) =>
      leanOf(
        jobs.filter((j) => j.collectionPaymentId && inIds(filter.collectionPaymentId, j.collectionPaymentId)),
      ),
    ),
  };

  // The job side of the hand-off, as ServicesService does it.
  const job = (id: string) => jobs.find((j) => String(j._id) === id)!;
  const servicesService: any = {
    claimCollection: jest.fn(async (_biz: string, id: string) => {
      const j = job(id);
      if (!j || j.collectionAppliedAt || !(j.collectionAmount > 0)) return null;
      j.collectionAppliedAt = new Date();
      return { amount: j.collectionAmount, method: j.collectionMethod, collectedAt: j.collectedAt };
    }),
    finishCollectionClaim: jest.fn(async (id: string, paymentId: string | null, applied?: number) => {
      const j = job(id);
      if (paymentId) {
        j.collectionPaymentId = paymentId;
        j.collectionAppliedAmount = applied;
      } else {
        delete j.collectionAppliedAt;
        delete j.collectionAppliedAmount;
      }
    }),
    releaseCollection: jest.fn(async (id: string) => {
      const j = job(id);
      delete j.collectionAppliedAt;
      delete j.collectionPaymentId;
      delete j.collectionAppliedAmount;
    }),
  };

  const service = new InvoicingService(
    invoiceModel,
    paymentModel,
    {} as any,
    servicesService,
    {} as any,
    {} as any,
    {} as any,
    serviceModel,
  );
  jest.spyOn(service as any, 'restoreStock').mockResolvedValue(undefined);
  // Lines go through as given; the tests set rate and quantity directly.
  jest
    .spyOn(service as any, 'buildItems')
    .mockImplementation(async (...args: any[]) =>
      args[2].map((i: any) => ({ ...i, serviceId: i.serviceId ? new Types.ObjectId(i.serviceId) : undefined })),
    );

  const addInvoice = (fields: Record<string, any>) => {
    const inv: any = {
      _id: new Types.ObjectId(),
      businessId: new Types.ObjectId(BIZ),
      customerId: new Types.ObjectId(CUSTOMER),
      status: 'unpaid',
      amountPaid: 0,
      discount: 0,
      stockDeductions: [],
      invoiceDate: new Date(),
      ...fields,
    };
    inv.balanceDue = inv.total - inv.amountPaid;
    inv.items = (fields.items ?? []).map((it: any) => ({
      taxRate: 0,
      quantity: 1,
      ...it,
      serviceId: it.serviceId ? new Types.ObjectId(it.serviceId) : undefined,
    }));
    inv.save = jest.fn(async () => inv);
    invoices.push(inv);
    return inv;
  };

  const addJob = (id: string, amount: number) => {
    const j: Job = {
      _id: new Types.ObjectId(id),
      collectionMethod: 'cash',
      collectionAmount: amount,
      collectedAt: new Date('2026-10-01'),
    };
    jobs.push(j);
    return j;
  };

  return { service, invoices, payments, jobs, addInvoice, addJob, servicesService };
}

describe('door collections follow the job', () => {
  it('sending an invoice puts the cash collected at the job on it', async () => {
    const w = world();
    const j = w.addJob(JOB_A, 500);
    const inv = w.addInvoice({ total: 800, items: [{ name: 'AC service', rate: 800, serviceId: JOB_A }] });

    await w.service.applyJobCollections(BIZ, [JOB_A]);

    expect(inv.amountPaid).toBe(500);
    expect(inv.balanceDue).toBe(300);
    expect(inv.status).toBe('partially_paid');
    expect(j.collectionAppliedAmount).toBe(500);
    expect(w.payments).toHaveLength(1);
  });

  it('collected more than the invoice: the invoice takes what it owes and the job remembers how much', async () => {
    const w = world();
    const j = w.addJob(JOB_A, 1000);
    const inv = w.addInvoice({ total: 800, items: [{ name: 'AC service', rate: 800, serviceId: JOB_A }] });

    await w.service.applyJobCollections(BIZ, [JOB_A]);

    expect(inv.status).toBe('paid');
    expect(inv.amountPaid).toBe(800);
    expect(j.collectionAmount).toBe(1000);
    expect(j.collectionAppliedAmount).toBe(800);
  });

  it('cancelling the invoice frees the cash, and the replacement invoice gets it', async () => {
    const w = world();
    const j = w.addJob(JOB_A, 500);
    const first = w.addInvoice({ total: 900, items: [{ name: 'AC service', rate: 900, serviceId: JOB_A }] });
    await w.service.applyJobCollections(BIZ, [JOB_A]);
    expect(first.amountPaid).toBe(500);

    await w.service.cancel(BIZ, String(first._id));

    // Off the cancelled one, which stays cancelled.
    expect(first.status).toBe('cancelled');
    expect(first.amountPaid).toBe(0);
    expect(w.payments).toHaveLength(0);
    expect(j.collectionPaymentId).toBeUndefined();
    expect(j.collectionAppliedAt).toBeUndefined();

    // The corrected invoice, made and sent afterwards.
    const second = w.addInvoice({ total: 800, items: [{ name: 'AC service', rate: 800, serviceId: JOB_A }] });
    await w.service.applyJobCollections(BIZ, [JOB_A]);
    expect(second.amountPaid).toBe(500);
    expect(second.balanceDue).toBe(300);
    expect(w.payments).toHaveLength(1);
    expect(String(w.payments[0].invoiceId)).toBe(String(second._id));
  });

  it('cancelling when the replacement is already sent moves the cash straight onto it', async () => {
    const w = world();
    w.addJob(JOB_A, 500);
    const first = w.addInvoice({ total: 900, items: [{ name: 'AC service', rate: 900, serviceId: JOB_A }] });
    await w.service.applyJobCollections(BIZ, [JOB_A]);
    const second = w.addInvoice({ total: 800, items: [{ name: 'AC service', rate: 800, serviceId: JOB_A }] });

    await w.service.cancel(BIZ, String(first._id));

    expect(first.amountPaid).toBe(0);
    expect(second.amountPaid).toBe(500);
    expect(second.status).toBe('partially_paid');
  });

  it('cancelling leaves payments the owner recorded by hand alone', async () => {
    const w = world();
    const inv = w.addInvoice({ total: 900, amountPaid: 200, status: 'partially_paid', items: [{ name: 'Repair', rate: 900 }] });
    w.payments.push({ _id: new Types.ObjectId(), invoiceId: String(inv._id), amount: 200 });

    await w.service.cancel(BIZ, String(inv._id));

    expect(inv.amountPaid).toBe(200);
    expect(w.payments).toHaveLength(1);
  });

  it('a job added to a sent invoice brings its cash with it', async () => {
    const w = world();
    w.addJob(JOB_B, 300);
    const inv = w.addInvoice({ total: 800, items: [{ name: 'AC service', rate: 800 }] });

    await w.service.update(BIZ, String(inv._id), {
      items: [
        { name: 'AC service', rate: 800, quantity: 1, taxRate: 0 },
        { name: 'Gas top-up', rate: 400, quantity: 1, taxRate: 0, serviceId: JOB_B },
      ],
    } as any);

    expect(inv.total).toBe(1200);
    expect(inv.amountPaid).toBe(300);
    expect(inv.balanceDue).toBe(900);
    expect(inv.status).toBe('partially_paid');
  });

  it('a job taken off a sent invoice takes its cash back for its own next invoice', async () => {
    const w = world();
    const j = w.addJob(JOB_A, 500);
    const inv = w.addInvoice({
      total: 1300,
      items: [
        { name: 'AC service', rate: 800, serviceId: JOB_A },
        { name: 'Fan repair', rate: 500 },
      ],
    });
    await w.service.applyJobCollections(BIZ, [JOB_A]);
    expect(inv.amountPaid).toBe(500);

    await w.service.update(BIZ, String(inv._id), {
      items: [{ name: 'Fan repair', rate: 500, quantity: 1, taxRate: 0 }],
    } as any);

    expect(inv.total).toBe(500);
    expect(inv.amountPaid).toBe(0);
    expect(inv.status).toBe('unpaid');
    expect(j.collectionPaymentId).toBeUndefined();
  });

  it('editing a sent invoice without touching its jobs changes nothing about the cash', async () => {
    const w = world();
    w.addJob(JOB_A, 500);
    const inv = w.addInvoice({ total: 800, items: [{ name: 'AC service', rate: 800, serviceId: JOB_A }] });
    await w.service.applyJobCollections(BIZ, [JOB_A]);

    await w.service.update(BIZ, String(inv._id), {
      items: [{ name: 'AC service', rate: 900, quantity: 1, taxRate: 0, serviceId: JOB_A }],
    } as any);

    expect(inv.total).toBe(900);
    expect(inv.amountPaid).toBe(500);
    expect(inv.balanceDue).toBe(400);
    expect(w.payments).toHaveLength(1);
  });

  it('a draft is never touched: the cash waits for it to be sent', async () => {
    const w = world();
    const j = w.addJob(JOB_A, 500);
    const draft = w.addInvoice({ total: 800, status: 'draft', items: [{ name: 'AC service', rate: 800 }] });

    await w.service.update(BIZ, String(draft._id), {
      items: [{ name: 'AC service', rate: 800, quantity: 1, taxRate: 0, serviceId: JOB_A }],
    } as any);

    expect(draft.amountPaid).toBe(0);
    expect(j.collectionAppliedAt).toBeUndefined();
  });
});
