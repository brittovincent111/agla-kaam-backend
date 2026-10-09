import {
  SubscriptionTier,
  getAppStorePricing,
  getPlanPricing,
} from './subscription-options';

const CURRENCIES = ['INR', 'AED', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'USD'];
const CASES: { tier: SubscriptionTier; teamEnabled: boolean }[] = [
  { tier: 'reminders', teamEnabled: false },
  { tier: 'invoicing', teamEnabled: false },
  { tier: 'combo', teamEnabled: false },
  { tier: 'combo', teamEnabled: true },
];

describe('getAppStorePricing', () => {
  for (const currency of CURRENCIES) {
    for (const { tier, teamEnabled } of CASES) {
      const label = `${currency} ${tier}${teamEnabled ? '+team' : ''}`;

      it(`${label}: store list price is not lower than the web price`, () => {
        const web = getPlanPricing(tier, teamEnabled, currency);
        const store = getAppStorePricing(tier, teamEnabled, currency);
        expect(store.amount).toBeGreaterThanOrEqual(web.amount);
      });

      it(`${label}: currency matches the web price's currency`, () => {
        const web = getPlanPricing(tier, teamEnabled, currency);
        const store = getAppStorePricing(tier, teamEnabled, currency);
        expect(store.currency).toBe(web.currency);
      });
    }
  }

  it('keeps the store premium within a reasonable bound (catches a typo)', () => {
    for (const currency of CURRENCIES) {
      for (const { tier, teamEnabled } of CASES) {
        const web = getPlanPricing(tier, teamEnabled, currency);
        const store = getAppStorePricing(tier, teamEnabled, currency);
        // Whole-unit currencies can require a larger step to reach an
        // available store tier (for example KWD 6 → 8).
        expect(store.amount).toBeLessThanOrEqual(web.amount * 1.4);
      }
    }
  });
});
