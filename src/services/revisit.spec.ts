import { BadRequestException } from '@nestjs/common';
import { ServicesService } from './services.service';

// Exercises the date rules on a plain object standing in for the document.
function makeService(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    status: 'pending',
    serviceDate: new Date('2026-10-01T00:00:00Z'),
    warrantyPeriod: '90d',
    warrantyExpiry: new Date('2026-12-30T00:00:00Z'),
    nextServiceInterval: '6m',
    nextServiceDate: new Date('2027-04-01T00:00:00Z'),
    revisitCount: 0,
    ...overrides,
  };
  doc.save = jest.fn(async () => doc);
  return doc;
}

function serviceWith(doc: any): ServicesService {
  const svc = Object.create(ServicesService.prototype) as ServicesService;
  (svc as any).findOne = jest.fn(async () => doc);
  (svc as any).amcService = { logVisit: jest.fn() };
  return svc;
}

const inDays = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};

describe('revisit', () => {
  it('moves the job, keeps the first booked date, and re-derives next visit + warranty', async () => {
    const doc = makeService();
    const target = inDays(3);
    await serviceWith(doc).revisitService(
      'b',
      's',
      target.toISOString(),
      {} as any,
    );
    expect(doc.serviceDate.getTime()).toBe(target.getTime());
    expect(doc.originalServiceDate.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(doc.revisitCount).toBe(1);
    // Next visit six months after the revisit — not overwritten with it.
    expect(doc.nextServiceDate.getMonth()).toBe((target.getMonth() + 6) % 12);
    expect(doc.warrantyExpiry.getTime()).toBeGreaterThan(target.getTime());
  });

  it('keeps the first booked date across several revisits', async () => {
    const doc = makeService();
    const svc = serviceWith(doc);
    await svc.revisitService('b', 's', inDays(2).toISOString(), {} as any);
    await svc.revisitService('b', 's', inDays(5).toISOString(), {} as any);
    expect(doc.revisitCount).toBe(2);
    expect(doc.originalServiceDate.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('leaves a custom next date alone', async () => {
    const custom = new Date('2027-01-15T00:00:00Z');
    const doc = makeService({
      nextServiceInterval: 'custom',
      nextServiceDate: custom,
    });
    await serviceWith(doc).revisitService(
      'b',
      's',
      inDays(2).toISOString(),
      {} as any,
    );
    expect(doc.nextServiceDate).toBe(custom);
  });

  it('refuses a completed or cancelled job, and a past date', async () => {
    await expect(
      serviceWith(makeService({ status: 'completed' })).revisitService(
        'b',
        's',
        inDays(2).toISOString(),
        {} as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      serviceWith(makeService({ status: 'cancelled' })).revisitService(
        'b',
        's',
        inDays(2).toISOString(),
        {} as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      serviceWith(makeService()).revisitService(
        'b',
        's',
        inDays(-5).toISOString(),
        {} as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('completing a job', () => {
  it('counts warranty and the next visit from the day it was done', async () => {
    const doc = makeService({ serviceDate: inDays(-14) });
    await serviceWith(doc).completeService('b', 's', {} as any);
    expect(doc.status).toBe('completed');
    const expected = new Date(doc.completedAt);
    expected.setMonth(expected.getMonth() + 6);
    expect(doc.nextServiceDate.toDateString()).toBe(expected.toDateString());
  });
});

describe('callback', () => {
  function svcFor(original: any) {
    const svc = serviceWith(original);
    (svc as any).serviceModel = { create: jest.fn(async (row: any) => row) };
    return svc;
  }

  it('books a free linked visit and leaves the original untouched', async () => {
    const original = makeService({
      _id: 'orig1',
      status: 'completed',
      warrantyExpiry: inDays(30),
      customerId: 'c1',
      serviceType: 'AC Gas Refill',
    });
    const before = { ...original };
    const row: any = await svcFor(original).createCallback(
      'b',
      'orig1',
      { date: inDays(2).toISOString(), notes: 'Leaking again' },
      {} as any,
    );
    expect(row.callbackOf).toBe('orig1');
    expect(row.status).toBe('pending');
    expect(row.underWarranty).toBe(true);
    expect(row.warrantyPeriod).toBe('none');
    expect(row.nextServiceInterval).toBe('none');
    expect(row.amcId).toBeUndefined();
    expect(row.notes).toBe('Leaking again');
    expect(original.nextServiceDate).toBe(before.nextServiceDate);
    expect(original.save).not.toHaveBeenCalled();
  });

  it('marks it out of warranty when the warranty has run out by that day', async () => {
    const original = makeService({
      status: 'completed',
      warrantyExpiry: inDays(1),
    });
    const row: any = await svcFor(original).createCallback(
      'b',
      's',
      { date: inDays(10).toISOString() },
      {} as any,
    );
    expect(row.underWarranty).toBe(false);
  });

  it('refuses an open job', async () => {
    await expect(
      svcFor(makeService()).createCallback(
        'b',
        's',
        { date: inDays(2).toISOString() },
        {} as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('callback from a callback', () => {
  it('links to the original job and uses its warranty', async () => {
    const root = makeService({
      _id: 'root',
      status: 'completed',
      warrantyExpiry: inDays(60),
    });
    const repair = makeService({
      _id: 'cb1',
      status: 'completed',
      callbackOf: 'root',
      warrantyExpiry: null,
    });
    const svc = Object.create(ServicesService.prototype) as ServicesService;
    (svc as any).findOne = jest.fn(async (_b: string, id: string) =>
      id === 'root' ? root : repair,
    );
    (svc as any).serviceModel = { create: jest.fn(async (row: any) => row) };
    const row: any = await svc.createCallback(
      'b',
      'cb1',
      { date: inDays(3).toISOString() },
      {} as any,
    );
    expect(row.callbackOf).toBe('root');
    expect(row.underWarranty).toBe(true);
  });
});
