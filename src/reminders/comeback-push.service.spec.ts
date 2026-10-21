import { Types } from 'mongoose';
import { ComebackPushService } from './comeback-push.service';
import { comebackNudge } from './comeback-copy';

// Owners who set up and went quiet: a push after 3, 7, 14 and 30 quiet
// days at 19:30, then silence; any use of the app starts the series over.

const DAY = 86400_000;
// 19:30 IST = 14:00 UTC.
const evening = (day: number) => new Date(Date.UTC(2026, 9, day, 14, 0, 0));

function build(o: { business?: any; lastUpdate?: Date; customers?: number; dueSoon?: number } = {}) {
  const business: any = {
    _id: new Types.ObjectId(),
    name: 'Sharma Cooling',
    tradeType: 'AC repair',
    language: 'en',
    timezone: 'Asia/Kolkata',
    pushTokens: ['ExponentPushToken[a]'],
    onboardingNudge: { done: true },
    lastSeenAt: new Date(Date.UTC(2026, 9, 1, 6)),
    ...o.business,
  };
  const exec = (v: unknown) => ({ exec: async () => v });
  const businessModel: any = {
    find: () => ({ select: () => ({ limit: () => ({ lean: () => exec([business]) }) }) }),
    updateOne: (_f: any, u: any) => {
      Object.assign(business, u.$set);
      return exec({});
    },
  };
  const newest = (d?: Date): any => ({
    findOne: () => ({ sort: () => ({ select: () => ({ lean: () => exec(d ? { updatedAt: d } : null) }) }) }),
  });
  const customerModel: any = { ...newest(o.lastUpdate), countDocuments: () => exec(o.customers ?? 4) };
  const serviceModel: any = { ...newest(o.lastUpdate), countDocuments: () => exec(o.dueSoon ?? 0) };
  const invoiceModel: any = newest();
  const sent: any[] = [];
  const push: any = {
    send: async (msgs: any[]) => {
      sent.push(...msgs);
      return { sent: msgs.length, failed: 0, invalidTokens: [] };
    },
  };
  const svc = new ComebackPushService(businessModel, customerModel, serviceModel, invoiceModel, { clearPushTokens: jest.fn() } as any, push);
  return { svc, business, sent };
}

describe('come-back pushes', () => {
  it('waits 3 quiet days, then sends at 19:30 only', async () => {
    const { svc, sent } = build();
    expect(await svc.run(evening(3))).toBe(0); // 2 days quiet
    expect(await svc.run(new Date(Date.UTC(2026, 9, 4, 5, 0)))).toBe(0); // 10:30, not the hour
    expect(await svc.run(evening(4))).toBe(1);
    expect(sent[0].title).toBe('Add the rest of your customers');
    expect(sent[0].data).toEqual({ screen: 'AddCustomer', type: 'comeback' });
  });

  it('sends four in all — 3, 7, 14 and 30 days — then stops', async () => {
    const { svc, sent } = build();
    const days: number[] = [];
    for (let d = 2; d <= 60; d++) if (await svc.run(new Date(Date.UTC(2026, 9, 1, 14) + d * DAY))) days.push(d);
    expect(days).toEqual([3, 7, 14, 30]);
    expect(sent.map((m) => m.data.screen)).toEqual(['AddCustomer', 'InvoiceList', 'LogService', 'Home']);
  });

  it('spaces pushes at least 3 days apart for an owner already long quiet', async () => {
    const { svc } = build({ business: { lastSeenAt: new Date(Date.UTC(2026, 8, 20, 6)) } });
    const days: number[] = [];
    for (let d = 1; d <= 20; d++) if (await svc.run(evening(d))) days.push(d);
    expect(days).toEqual([1, 4, 7, 20]); // the last still waits for 30 quiet days
  });

  it('leaves an owner who is using the app alone', async () => {
    const { svc, sent } = build({ business: { lastSeenAt: new Date(Date.UTC(2026, 9, 9, 6)) } });
    expect(await svc.run(evening(10))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('starts over when the owner comes back', async () => {
    const { svc, business, sent } = build();
    await svc.run(evening(4)); // first push
    business.lastSeenAt = new Date(Date.UTC(2026, 9, 5, 6)); // they opened the app
    expect(await svc.run(evening(7))).toBe(0); // 2 days quiet again
    expect(await svc.run(evening(8))).toBe(1);
    expect(sent[1].data.screen).toBe('AddCustomer'); // the first push again
  });

  it('counts a customer or service added as being back', async () => {
    const { svc } = build({ lastUpdate: new Date(Date.UTC(2026, 9, 8, 6)) });
    expect(await svc.run(evening(10))).toBe(0);
  });

  it('leads with customers due soon when there are some', async () => {
    const { svc, sent } = build({ dueSoon: 2 });
    await svc.run(evening(4));
    expect(sent[0].title).toBe('2 customers due in the next 30 days');
    expect(sent[0].data.screen).toBe('Services');
  });

  it('speaks Malayalam and Hindi', () => {
    expect(comebackNudge(1, { businessName: 'X', language: 'ml', customers: 3, dueSoon: 0 })!.title).toContain('WhatsApp');
    expect(comebackNudge(1, { businessName: 'X', language: 'ml', customers: 3, dueSoon: 0 })!.title).toMatch(/[ഀ-ൿ]/);
    expect(comebackNudge(2, { businessName: 'X', language: 'hi', customers: 3, dueSoon: 0 })!.title).toMatch(/[ऀ-ॿ]/);
    expect(comebackNudge(4, { businessName: 'X', customers: 3, dueSoon: 0 })).toBeNull();
  });
});
