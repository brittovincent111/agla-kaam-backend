import {
  APP_STORE_COMMISSION_RATE,
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

      it(`${label}: nets at least the web price after the store's ${APP_STORE_COMMISSION_RATE * 100}% cut`, () => {
        const web = getPlanPricing(tier, teamEnabled, currency);
        const store = getAppStorePricing(tier, teamEnabled, currency);
        const netAfterCommission = store.amount * (1 - APP_STORE_COMMISSION_RATE);
        // Rounding up must never undershoot — a store product priced so the
        // net is even one unit short of the web price is the exact bug this
        // table exists to avoid.
        expect(netAfterCommission).toBeGreaterThanOrEqual(web.amount - 1e-9);
      });

      it(`${label}: currency matches the web price's currency`, () => {
        const web = getPlanPricing(tier, teamEnabled, currency);
        const store = getAppStorePricing(tier, teamEnabled, currency);
        expect(store.currency).toBe(web.currency);
      });
    }
  }

  it('is never more than a small buffer above break-even (catches an accidental over-markup)', () => {
    // A generous cap — real margins here run roughly 0–13%, the high end
    // coming from currencies (KWD) whose table only uses whole units, so
    // rounding up to clear the bar overshoots a bit more than for finer
    // denominations. Anything past 20% suggests a typo in the table, not
    // rounding.
    for (const currency of CURRENCIES) {
      for (const { tier, teamEnabled } of CASES) {
        const web = getPlanPricing(tier, teamEnabled, currency);
        const store = getAppStorePricing(tier, teamEnabled, currency);
        const netAfterCommission = store.amount * (1 - APP_STORE_COMMISSION_RATE);
        expect(netAfterCommission).toBeLessThan(web.amount * 1.2);
      }
    }
  });
});
