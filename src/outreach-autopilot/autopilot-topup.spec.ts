import { AutopilotService } from './autopilot.service';
import { Types } from 'mongoose';

const MAIN_CAMPAIGN_ID = '6acdbeda81b7c09b9d117a1c';

// The hourly WhatsApp top-up, on plain stand-ins for its collaborators.
function build(o: {
  open?: boolean;
  approved?: number;
  live?: number;
  monthlyCap?: number | null;
  sentThisMonth?: number;
  waiting?: number;
  fresh?: number;
  stringCampaignId?: boolean;
}) {
  const plan: any = {
    regionId: 'r1',
    name: 'Kerala',
    whatsapp: { count: o.approved ?? 100, leadIds: ['L0'], sample: [], campaignId: MAIN_CAMPAIGN_ID, template: 't', languageCode: 'ml' },
  };
  const day: any = { regions: [plan], markModified: jest.fn(), save: jest.fn() };
  const leads = Array.from({ length: o.fresh ?? 500 }, (_, i) => ({
    _id: { toString: () => `F${i}` },
    phoneNormalized: `+9190000${String(i).padStart(5, '0')}`,
  }));
  const created: any[] = [];
  const svc = Object.create(AutopilotService.prototype) as any;
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  svc.waCloud = { isConfigured: () => true };
  svc.emailQueue = { sendWindow: () => ({ open: o.open ?? true }) };
  svc.dayModel = { findOne: () => ({ exec: async () => day }) };
  svc.waQueue = {
    budget: () => ({ monthlyCap: o.monthlyCap === undefined ? 3370 : o.monthlyCap }),
    sentThisMonth: async () => o.sentThisMonth ?? 0,
  };
  svc.waRecipientModel = {
    countDocuments: async (q: any) => {
      if (!q.campaignId) return o.waiting ?? 0;
      // MongoDB distinguishes a stored ObjectId from the same ID as text.
      // campaignId is currently Mixed, so Mongoose does not cast this query.
      const stored = o.stringCampaignId ? MAIN_CAMPAIGN_ID : new Types.ObjectId(MAIN_CAMPAIGN_ID);
      const matches = q.campaignId.$in.some(
        (id: string | Types.ObjectId) => typeof id === typeof stored && id.toString() === stored.toString(),
      );
      return matches ? o.live ?? 0 : 0;
    },
    distinct: () => ({ exec: async () => [] }),
  };
  svc.config ??= { get: () => undefined };
  svc.regions = async () => [{ id: 'r1', enabled: true, useWhatsapp: true }];
  svc.regionLeadMatch = () => ({});
  svc.leadModel = {
    find: () => ({ sort: () => ({ select: () => ({ limit: (n: number) => ({ exec: async () => leads.slice(0, n) }) }) }) }),
  };
  svc.waCampaignModel = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ headerImageUrl: 'h.jpg' }) }) }) }) };
  svc.waCampaigns = {
    create: jest.fn(async (dto: any) => {
      created.push(dto);
      return { id: `c-top-${created.length}` };
    }),
    start: jest.fn(),
  };
  return { svc, plan, created };
}

describe('WhatsApp top-up', () => {
  it('replaces the ones that failed, with the same message', async () => {
    const { svc, plan, created } = build({ approved: 130, live: 100 });
    expect(await svc.topUpWhatsapp('2026-10-12')).toBe(30);
    expect(created[0].selectedLeadIds).toHaveLength(30);
    expect(created[0]).toMatchObject({ templateName: 't', languageCode: 'ml', headerImageUrl: 'h.jpg' });
    expect(plan.whatsapp.toppedUp).toBe(30);
    expect(plan.whatsapp.topUpCampaignIds).toEqual(['c-top-1']);
  });

  it('adds nothing when the day is already at its approved number', async () => {
    const { svc, created } = build({ approved: 130, live: 130 });
    expect(await svc.topUpWhatsapp('2026-10-12')).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('counts queued recipients with legacy string campaign IDs too', async () => {
    const { svc, created } = build({ approved: 67, live: 67, stringCampaignId: true });
    expect(await svc.topUpWhatsapp('2026-10-13')).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('never goes past the month budget', async () => {
    const { svc, created } = build({ approved: 130, live: 100, monthlyCap: 3370, sentThisMonth: 3350, waiting: 10 });
    expect(await svc.topUpWhatsapp('2026-10-12')).toBe(10);
    expect(created[0].selectedLeadIds).toHaveLength(10);
  });

  it('does nothing outside sending hours', async () => {
    const { svc, created } = build({ open: false, approved: 130, live: 10 });
    expect(await svc.topUpWhatsapp('2026-10-12')).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('sends only as many as there are fresh numbers', async () => {
    const { svc } = build({ approved: 130, live: 100, fresh: 4 });
    expect(await svc.topUpWhatsapp('2026-10-12')).toBe(4);
  });
});
