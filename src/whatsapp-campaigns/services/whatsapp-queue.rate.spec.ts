import { Types } from 'mongoose';
import { ERR_THROUGHPUT, WhatsappQueueService } from './whatsapp-queue.service';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

// One pace for the whole number, however many campaigns run, and a message
// Meta refused for "too fast" (130429) goes back in line instead of being lost.

function queue(rate?: string) {
  const campaignUpdates: any[] = [];
  const campaignModel: any = {
    updateOne: (f: any, u: any) => {
      campaignUpdates.push({ f, u });
      return { exec: async () => ({}) };
    },
  };
  const q = new WhatsappQueueService(
    { get: (k: string) => (k === 'WHATSAPP_RATE_PER_SECOND' ? rate : undefined) } as any,
    campaignModel,
    {} as any,
    {} as any,
    {} as any,
  );
  const started: string[] = [];
  (q as any).start = (id: string) => started.push(id);
  return { q, campaignUpdates, started };
}

function recipient(o: any = {}) {
  return {
    campaignId: new Types.ObjectId(),
    status: 'SENT',
    retryCount: 0,
    sentAt: new Date(),
    save: jest.fn(async () => undefined),
    ...o,
  } as any;
}

describe('WhatsApp pace for the whole number', () => {
  it('defaults to 1 a second and never goes above 5', () => {
    expect(queue().q.ratePerSecond).toBe(1);
    expect(queue('20').q.ratePerSecond).toBe(5);
  });

  it('spaces sends from different campaigns, not each on its own clock', async () => {
    jest.useFakeTimers();
    const { q } = queue('2');
    const times: number[] = [];
    const t0 = Date.now();
    const go = () => (q as any).takeSlot().then(() => times.push(Date.now() - t0));
    const all = Promise.all([go(), go(), go(), go()]); // four campaigns at once
    await jest.advanceTimersByTimeAsync(2000);
    await all;
    expect(times).toEqual([0, 500, 1000, 1500]);
    jest.useRealTimers();
  });
});

describe('"Rate limit hit" (130429) reported by webhook', () => {
  it('queues the message again, unbilled, and pauses the number', async () => {
    const { q, campaignUpdates, started } = queue();
    const r = recipient();
    const before = (q as any).nextSendAt;
    expect(await q.retryRateLimited(r)).toBe(true);
    expect(r.status).toBe('QUEUED');
    expect(r.sentAt).toBeUndefined();
    expect(r.retryCount).toBe(1);
    expect((q as any).nextSendAt).toBeGreaterThan(Math.max(before, Date.now() + 20_000));
    expect(campaignUpdates[0].u.$set.status).toBe('SENDING');
    expect(started).toEqual([String(r.campaignId)]);
  });

  it('gives up after three tries', async () => {
    const { q } = queue();
    expect(await q.retryRateLimited(recipient({ retryCount: 3 }))).toBe(false);
  });

  it('the webhook retries a 130429 instead of marking it failed', async () => {
    const r = recipient({ waMessageId: 'wamid.1' });
    const retryRateLimited = jest.fn(async () => true);
    const svc = new WhatsappWebhookService(
      { findOne: () => ({ exec: async () => r }) } as any,
      {} as any,
      {} as any,
      { retryRateLimited, syncCounters: jest.fn() } as any,
      {} as any,
    );
    await svc.handle({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'failed', errors: [{ code: ERR_THROUGHPUT }] }] } }] }] });
    expect(retryRateLimited).toHaveBeenCalledWith(r);
    expect(r.status).toBe('SENT'); // not marked FAILED
  });
});
