export const SUBSCRIPTION_TIERS = ['reminders', 'invoicing', 'combo'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

// Combo + Team: 4 seats in all — the owner's and 3 for technicians or
// managers. Seats granted to a business (Business.teamSeatLimit) count the
// same way, owner included.
export const TEAM_SEAT_LIMIT = 4;

// Lifetime caps (not per-year, never reset) for a business without an active
// Invoicing/Combo subscription — purchasing Invoicing/Combo removes both caps.
export const FREE_TIER_INVOICE_LIMIT = 25;
export const FREE_TIER_QUOTATION_LIMIT = 25;
export const FREE_TIER_AMC_LIMIT = 2;
export const FREE_TIER_TEAM_LIMIT = 1;

// A null tier means no active paid subscription — the free tier.
export function tierHasUnlimitedCustomers(
  tier: SubscriptionTier | null,
): boolean {
  return tier === 'reminders' || tier === 'combo';
}

export function tierHasInvoicing(tier: SubscriptionTier | null): boolean {
  return tier === 'invoicing' || tier === 'combo';
}

// The Team add-on is only sold bundled with Combo — a technician needs the
// service-tracking feature to do anything, and invoicing-only would leave
// them with nothing to do either, so Team + Combo is the one offer (₹1599/yr
// flat, not 1149+450 stacked).
export function tierAllowsTeam(tier: SubscriptionTier | null): boolean {
  return tier === 'combo';
}

export interface PlanPricing {
  amount: number;
  currency: string;
}

export function getPlanPricing(
  tier: SubscriptionTier,
  teamEnabled: boolean,
  currencyCode = 'INR',
): PlanPricing {
  const currency = currencyCode.toUpperCase();
  if (currency === 'AED') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 119 : 79, currency: 'AED' };
    return { amount: 49, currency: 'AED' };
  }
  if (currency === 'SAR') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 119 : 79, currency: 'SAR' };
    return { amount: 49, currency: 'SAR' };
  }
  if (currency === 'QAR') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 119 : 79, currency: 'QAR' };
    return { amount: 49, currency: 'QAR' };
  }
  if (currency === 'OMR') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 12 : 8, currency: 'OMR' };
    return { amount: 5, currency: 'OMR' };
  }
  if (currency === 'KWD') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 10 : 6, currency: 'KWD' };
    return { amount: 4, currency: 'KWD' };
  }
  if (currency === 'BHD') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 12 : 8, currency: 'BHD' };
    return { amount: 5, currency: 'BHD' };
  }
  if (currency === 'USD') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 35 : 25, currency: 'USD' };
    return { amount: 15, currency: 'USD' };
  }
  if (tier === 'combo')
    return { amount: teamEnabled ? 1599 : 1149, currency: 'INR' };
  return { amount: 799, currency: 'INR' };
}

// Neither Play nor App Store subscription products carry a computable
// amount like Razorpay orders do — each is a fixed-price product configured
// by hand in Play Console / App Store Connect. Deliberately using the same
// ID strings for both stores (nothing requires this — it just keeps the
// mobile and backend product-mapping code identical instead of duplicated).
// These IDs must be created in both consoles (yearly plan) with the price
// from getAppStorePricing below — NOT the plain getPlanPricing row — before
// purchases on either store can verify.
export const SUBSCRIPTION_PRODUCT_IDS: Record<
  string,
  { tier: SubscriptionTier; teamEnabled: boolean }
> = {
  reminders_yearly: { tier: 'reminders', teamEnabled: false },
  invoicing_yearly: { tier: 'invoicing', teamEnabled: false },
  combo_yearly: { tier: 'combo', teamEnabled: false },
  combo_team_yearly: { tier: 'combo', teamEnabled: true },
};

// Apple and Google both keep a cut of every in-app purchase — 15% under
// Apple's Small Business Program and Google Play's standard rate for a
// developer's first $1M/year. Store prices are intentionally higher than the
// web price to help absorb that fee, but they are separately configured in
// the stores and are not required to produce identical net proceeds.
export const APP_STORE_COMMISSION_RATE = 0.15;

// These are expected store list prices. The app still displays the price
// returned live by Play/App Store when available, because the consoles are
// the authority for the actual charge.
export function getAppStorePricing(
  tier: SubscriptionTier,
  teamEnabled: boolean,
  currencyCode = 'INR',
): PlanPricing {
  const currency = currencyCode.toUpperCase();
  if (currency === 'AED') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 140 : 95, currency: 'AED' };
    return { amount: 60, currency: 'AED' };
  }
  if (currency === 'SAR') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 140 : 95, currency: 'SAR' };
    return { amount: 60, currency: 'SAR' };
  }
  if (currency === 'QAR') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 140 : 95, currency: 'QAR' };
    return { amount: 60, currency: 'QAR' };
  }
  if (currency === 'OMR') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 15 : 10, currency: 'OMR' };
    return { amount: 6, currency: 'OMR' };
  }
  if (currency === 'KWD') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 12 : 8, currency: 'KWD' };
    return { amount: 5, currency: 'KWD' };
  }
  if (currency === 'BHD') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 15 : 10, currency: 'BHD' };
    return { amount: 6, currency: 'BHD' };
  }
  if (currency === 'USD') {
    if (tier === 'combo')
      return { amount: teamEnabled ? 42 : 30, currency: 'USD' };
    return { amount: 18, currency: 'USD' };
  }
  if (tier === 'combo')
    return { amount: teamEnabled ? 1799 : 1199, currency: 'INR' };
  return { amount: 899, currency: 'INR' };
}
