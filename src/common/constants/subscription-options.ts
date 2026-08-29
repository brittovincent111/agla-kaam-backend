export const SUBSCRIPTION_TIERS = ['reminders', 'invoicing', 'combo'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const TEAM_SEAT_LIMIT = 5;

// A null tier means no active paid subscription — the free tier.
export function tierHasUnlimitedCustomers(tier: SubscriptionTier | null): boolean {
  return tier === 'reminders' || tier === 'combo';
}

export function tierHasInvoicing(tier: SubscriptionTier | null): boolean {
  return tier === 'invoicing' || tier === 'combo';
}

// The Team add-on is only sold bundled with Combo — a technician needs the
// service-tracking feature to do anything, and invoicing-only would leave
// them with nothing to do either, so Team + Combo is the one offer (₹1299/yr
// flat, not 699+1200 stacked).
export function tierAllowsTeam(tier: SubscriptionTier | null): boolean {
  return tier === 'combo';
}
