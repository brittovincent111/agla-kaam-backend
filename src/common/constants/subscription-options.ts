export const SUBSCRIPTION_TIERS = ['reminders', 'invoicing', 'combo'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const TEAM_SEAT_LIMIT = 5;

// Lifetime caps (not per-year, never reset) for a business without an active
// Invoicing/Combo subscription — purchasing Invoicing/Combo removes both caps.
export const FREE_TIER_INVOICE_LIMIT = 25;
export const FREE_TIER_QUOTATION_LIMIT = 25;

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
// them with nothing to do either, so Team + Combo is the one offer (₹1499/yr
// flat, not 999+500 stacked).
export function tierAllowsTeam(tier: SubscriptionTier | null): boolean {
  return tier === 'combo';
}

// Prices in whole rupees, mirroring mobile/src/screens/PaywallScreen.tsx.
// Combo + Team is a flat ₹1499, not 999 + 500 stacked — see tierAllowsTeam.
export function getPlanAmountRupees(
  tier: SubscriptionTier,
  teamEnabled: boolean,
): number {
  if (tier === 'combo') return teamEnabled ? 1499 : 999;
  return 699;
}

// Neither Play nor App Store subscription products carry a computable
// amount like Razorpay orders do — each is a fixed-price product configured
// by hand in Play Console / App Store Connect. Deliberately using the same
// ID strings for both stores (nothing requires this — it just keeps the
// mobile and backend product-mapping code identical instead of duplicated).
// These IDs must be created in both consoles (yearly plan, price matching
// getPlanAmountRupees above) before purchases on either store can verify.
export const SUBSCRIPTION_PRODUCT_IDS: Record<
  string,
  { tier: SubscriptionTier; teamEnabled: boolean }
> = {
  reminders_yearly: { tier: 'reminders', teamEnabled: false },
  invoicing_yearly: { tier: 'invoicing', teamEnabled: false },
  combo_yearly: { tier: 'combo', teamEnabled: false },
  combo_team_yearly: { tier: 'combo', teamEnabled: true },
};
