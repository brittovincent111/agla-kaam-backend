import { ProviderUsageService } from './provider-usage.service';

const make = (env: Record<string, string>) =>
  new ProviderUsageService({} as any, { get: (k: string) => env[k] } as any);

describe('ProviderUsageService limits', () => {
  it('defaults to the global free 1,000 minus a 20% gap, spread over 30 days', () => {
    const u = make({});
    expect(u.monthlyLimit).toBe(800);
    expect((u as any).dailyMaxRequests).toBe(27);
  });

  it('India: 7,000 free, kept to 5,600 with the gap', () => {
    const u = make({ LEAD_FINDER_FREE_MONTHLY: '7000', LEAD_FINDER_MONTHLY_LIMIT: '10000' });
    expect(u.monthlyLimit).toBe(5600);
    expect((u as any).dailyMaxRequests).toBe(187);
  });

  it('a monthly setting can never eat into the gap', () => {
    expect(make({ LEAD_FINDER_FREE_MONTHLY: '7000', LEAD_FINDER_MONTHLY_LIMIT: '6900' }).monthlyLimit).toBe(5600);
    expect(make({ LEAD_FINDER_MONTHLY_LIMIT: '10000', LEAD_FINDER_DAILY_LIMIT: '500' }).monthlyLimit).toBe(800);
  });

  it('the gap can be widened, not removed below zero', () => {
    expect(make({ LEAD_FINDER_FREE_MONTHLY: '7000', LEAD_FINDER_SAFETY_GAP_PERCENT: '30' }).monthlyLimit).toBe(4900);
  });

  it('allows more only when paid searches are switched on', () => {
    expect(make({ LEAD_FINDER_MONTHLY_LIMIT: '3000', LEAD_FINDER_ALLOW_PAID: 'true' }).monthlyLimit).toBe(3000);
  });

  it('never lets the daily cap exceed the monthly one', () => {
    expect((make({ LEAD_FINDER_MONTHLY_LIMIT: '50', LEAD_FINDER_DAILY_LIMIT: '500' }) as any).dailyMaxRequests).toBe(50);
  });
});
