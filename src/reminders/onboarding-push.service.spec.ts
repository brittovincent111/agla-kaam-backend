import { Types } from 'mongoose';
import { OnboardingPushService } from './onboarding-push.service';
import { onboardingNudge } from './onboarding-copy';

// New-owner nudges: right time of day, one step at a time, at most one a
// day, five per step, and silence once the app is set up.

const H = 3600_000;
// 10:30 IST = 05:00 UTC; 19:30 IST = 14:00 UTC; 13:30 IST = 08:00 UTC.
const at = (day: number, utcHour: number) => new Date(Date.UTC(2026, 9, day, utcHour, 0, 0));

function build(o: { business?: any; customers?: any[]; hasService?: boolean } = {}) {
  const business: any = {
    _id: new Types.ObjectId(),
    name: 'Sharma Cooling',
    tradeType: 'AC repair',
    phone: '+919800000001',
    email: 'owner@example.com',
    language: 'en',
    timezone: 'Asia/Kolkata',
    createdAt: at(13, 4), // 09:30 IST on the 13th
    pushTokens: ['ExponentPushToken[a]'],
    ...o.business,
  };
  const updates: any[] = [];
  const exec = (v: unknown) => ({ exec: async () => v });
  const businessModel: any = {
    find: () => ({ select: () => ({ limit: () => ({ lean: () => exec([business]) }) }) }),
    updateOne: (_f: any, u: any) => {
      updates.push(u.$set);
      if (u.$set.onboardingNudge) business.onboardingNudge = u.$set.onboardingNudge;
      return exec({});
    },
  };
  const customers = o.customers ?? [];
  const customerModel: any = {
    findOne: () => ({ sort: () => ({ select: () => ({ lean: () => exec(customers[0] ?? null) }) }) }),
  };
  const serviceModel: any = { exists: () => exec(o.hasService ? { _id: 1 } : null) };
  const sent: any[] = [];
  const push: any = {
    send: async (msgs: any[]) => {
      sent.push(...msgs);
      return { sent: msgs.length, failed: 0, invalidTokens: [] };
    },
  };
  const businesses: any = { clearPushTokens: jest.fn() };
  const emails: any[] = [];
  const email: any = { sendPlain: jest.fn(async (to: string, subject: string) => void emails.push({ to, subject })) };
  const svc = new OnboardingPushService(businessModel, customerModel, serviceModel, businesses, push, email);
  return { svc, business, sent, updates, emails };
}

describe('new-owner nudges', () => {
  it('sends the first "add a customer" nudge at the next 10:30 or 19:30 after sign-up', async () => {
    const { svc, sent } = build();
    expect(await svc.run(at(13, 8))).toBe(0); // 13:30 IST: not a send time
    expect(await svc.run(at(13, 14))).toBe(1); // 19:30 IST, 10 h after sign-up
    expect(sent[0].title).toBe('Add your first customer 👋');
    expect(sent[0].body).toContain('Sharma Cooling');
    expect(sent[0].body).toContain('next AC service');
    expect(sent[0].data).toEqual({ screen: 'AddCustomer', type: 'onboarding' });
  });

  it('never sends twice in a day, and spaces the next ones out', async () => {
    const { svc, sent } = build();
    await svc.run(at(13, 14)); // nudge 1, 19:30 on the 13th
    expect(await svc.run(at(14, 5))).toBe(0); // 10:30 next day: only 15 h later
    expect(await svc.run(at(14, 14))).toBe(1); // 19:30 next day: 24 h later
    expect(sent).toHaveLength(2);
  });

  it('stops after five nudges for a step', async () => {
    const { svc, sent } = build();
    for (let d = 13; d <= 31; d++) for (const h of [5, 14]) await svc.run(at(d, h));
    expect(sent).toHaveLength(5);
  });

  it('moves to "log a service" once a customer is added, naming that customer', async () => {
    const { svc, sent } = build({ customers: [{ name: 'Ramesh Kumar' }] });
    await svc.run(at(13, 14));
    expect(sent[0].title).toBe("When is Ramesh Kumar's next service?");
    expect(sent[0].data.screen).toBe('LogService');
  });

  it('goes quiet for good once a service is logged', async () => {
    const { svc, sent, updates } = build({ customers: [{ name: 'Ramesh' }], hasService: true });
    expect(await svc.run(at(13, 14))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(updates).toContainEqual({ 'onboardingNudge.done': true });
  });

  it('speaks Hindi to a Hindi owner', async () => {
    const { svc, sent } = build({ business: { language: 'hi' } });
    await svc.run(at(13, 14));
    expect(sent[0].title).toBe('अपना पहला कस्टमर जोड़िए 👋');
  });

  it('has five messages per step and none beyond', () => {
    for (const stage of ['customer', 'service'] as const) {
      for (let i = 0; i < 5; i++) expect(onboardingNudge(stage, i, { businessName: 'X' })).not.toBeNull();
      expect(onboardingNudge(stage, 5, { businessName: 'X' })).toBeNull();
    }
  });

  describe('setup not finished (no phone or trade)', () => {
    it('nudges by push and email to finish setup', async () => {
      const { svc, sent, emails } = build({ business: { phone: undefined, tradeType: undefined } });
      expect(await svc.run(at(13, 14))).toBe(1);
      expect(sent[0].title).toBe('Your Agla Kaam account is ready 👋');
      expect(emails).toEqual([{ to: 'owner@example.com', subject: 'Your Agla Kaam account is 1 minute from ready' }]);
    });

    it('emails only on the first and third nudge', async () => {
      const { svc, sent, emails } = build({ business: { tradeType: undefined } });
      for (let d = 13; d <= 31; d++) for (const h of [5, 14]) await svc.run(at(d, h));
      expect(sent).toHaveLength(5);
      expect(emails.map((e) => e.subject)).toEqual([
        'Your Agla Kaam account is 1 minute from ready',
        'Still want reminders for your customers?',
      ]);
    });

    it('reaches an owner with notifications off by email alone', async () => {
      const { svc, sent, emails } = build({ business: { phone: undefined, pushTokens: [] } });
      expect(await svc.run(at(13, 14))).toBe(1);
      expect(sent).toHaveLength(0);
      expect(emails).toHaveLength(1);
    });

    it("never emails Apple's private relay address", async () => {
      const { svc, emails } = build({ business: { phone: undefined, email: 'x1y2@privaterelay.appleid.com' } });
      await svc.run(at(13, 14));
      expect(emails).toHaveLength(0);
    });

    it('moves on to "add a customer" once setup is done', async () => {
      const { svc, business, sent } = build({ business: { phone: undefined } });
      await svc.run(at(13, 14)); // setup nudge 1
      business.phone = '+919800000001';
      expect(await svc.run(at(14, 5))).toBe(0); // only 15 h after the last nudge
      expect(await svc.run(at(14, 14))).toBe(1);
      expect(sent[1].data.screen).toBe('AddCustomer');
    });
  });
});
