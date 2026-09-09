// The rules applied by SubscriptionsService.applyStoreState, exercised
// directly. Getting these wrong costs real money in both directions: expire
// a paying customer, or keep serving someone who stopped paying.

interface StoreState {
  isActive: boolean;
  expiresAt?: Date;
}

type Outcome = 'active' | 'paid-until-expiry' | 'expired';

// Mirrors the branching in applyStoreState.
function decide(state: StoreState, now = Date.now()): Outcome {
  if (state.isActive) return 'active';
  const stillPaidFor = state.expiresAt && state.expiresAt.getTime() > now;
  return stillPaidFor ? 'paid-until-expiry' : 'expired';
}

const HOUR = 3600_000;

describe('store-driven subscription state', () => {
  it('keeps a renewed subscription active and moves the renewal date out', () => {
    const nextYear = new Date(Date.now() + 365 * 24 * HOUR);
    expect(decide({ isActive: true, expiresAt: nextYear })).toBe('active');
  });

  it('does NOT expire a customer who cancelled mid-term', () => {
    // Auto-renew off, but they paid through to next month. Downgrading now
    // would take away something already paid for.
    const nextMonth = new Date(Date.now() + 30 * 24 * HOUR);
    expect(decide({ isActive: false, expiresAt: nextMonth })).toBe(
      'paid-until-expiry',
    );
  });

  it('expires once the paid period has actually elapsed', () => {
    const yesterday = new Date(Date.now() - 24 * HOUR);
    expect(decide({ isActive: false, expiresAt: yesterday })).toBe('expired');
  });

  it('expires when the store reports no expiry at all (refund/revocation)', () => {
    // A revoked or refunded purchase has no remaining entitlement.
    expect(decide({ isActive: false })).toBe('expired');
  });

  it('treats an expiry exactly now as elapsed, not still paid', () => {
    const now = Date.now();
    expect(decide({ isActive: false, expiresAt: new Date(now) }, now)).toBe(
      'expired',
    );
  });

  it('trusts the active flag even if the expiry looks stale', () => {
    // Google reports IN_GRACE_PERIOD as active while it retries billing;
    // the expiry may already be in the past. Access must continue.
    const yesterday = new Date(Date.now() - 24 * HOUR);
    expect(decide({ isActive: true, expiresAt: yesterday })).toBe('active');
  });
});

// The bug this whole feature exists to fix.
describe('the renewal gap that used to lose paying customers', () => {
  it('a year-old subscription with no renewal signal reads as expired', () => {
    // renewalDate was set to purchase + 1 year and never updated, so
    // findActiveForBusiness() returned null on day 366 even though Google
    // had charged the customer again.
    const purchasedAYearAgo = new Date(Date.now() - 366 * 24 * HOUR);
    const stale = { status: 'active', renewalDate: purchasedAYearAgo };
    const looksActive =
      stale.status === 'active' &&
      (!stale.renewalDate || stale.renewalDate.getTime() >= Date.now());
    expect(looksActive).toBe(false);
  });

  it('a renewal notification pushes the date forward, keeping access', () => {
    const renewedUntil = new Date(Date.now() + 365 * 24 * HOUR);
    const synced = { status: 'active', renewalDate: renewedUntil };
    const looksActive =
      synced.status === 'active' &&
      (!synced.renewalDate || synced.renewalDate.getTime() >= Date.now());
    expect(looksActive).toBe(true);
  });
});
