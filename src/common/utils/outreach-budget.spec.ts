import { istMonthStart, sendingDaysLeft, whatsappBudget } from './outreach-budget';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('whatsappBudget', () => {
  it('₹3,000 with a 20% gap at ₹1.02 a message ≈ 2,352 messages', () => {
    expect(whatsappBudget(env({ OUTREACH_MONTHLY_BUDGET_INR: '3000' }))).toEqual({
      budgetInr: 3000,
      usableInr: 2400,
      costPerMessageInr: 1.02,
      monthlyCap: 2352,
    });
  });

  it('no budget set means no monthly cap', () => {
    expect(whatsappBudget(env({})).monthlyCap).toBeNull();
  });

  it('follows a changed rate or gap', () => {
    expect(whatsappBudget(env({ OUTREACH_MONTHLY_BUDGET_INR: '3000', OUTREACH_BUDGET_GAP_PERCENT: '30', WHATSAPP_COST_PER_MESSAGE_INR: '1.2' })).monthlyCap).toBe(1750);
  });
});

describe('sendingDaysLeft', () => {
  it('counts Mon–Sat left in the India month, today included', () => {
    // Mon 5 Oct 2026, 11:00 IST: 27 days left, minus Sundays 11, 18, 25.
    expect(sendingDaysLeft(env({}), new Date('2026-10-05T05:30:00Z'))).toBe(24);
    expect(sendingDaysLeft(env({ OUTREACH_SEND_DAYS: '0-6' }), new Date('2026-10-05T05:30:00Z'))).toBe(27);
  });

  it('never returns 0, so the last day still gets the rest', () => {
    expect(sendingDaysLeft(env({}), new Date('2026-10-31T13:00:00Z'))).toBe(1);
  });
});

describe('istMonthStart', () => {
  it('is midnight on the 1st, India time', () => {
    expect(istMonthStart(new Date('2026-10-05T05:30:00Z')).toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
});
