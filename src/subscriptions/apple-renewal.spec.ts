import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionsService } from './subscriptions.service';
import { ApplePurchaseVerification } from './apple-verification.service';

// Apple renewals and refunds, exercised against SubscriptionsService with
// in-memory stand-ins for the models and Apple's API. The two bugs pinned
// here both cost money: a renewal (new transactionId) that never extended
// access, and a refund that kept access until the old expiry.

const DAY = 24 * 3600_000;
const BUSINESS_ID = new Types.ObjectId().toString();
const OTHER_BUSINESS_ID = new Types.ObjectId().toString();

type Row = Record<string, any> & { save: jest.Mock };

function withSave(data: Record<string, any>): Row {
  const row = { ...data } as Row;
  row.save = jest.fn().mockResolvedValue(row);
  return row;
}

// Just enough of Mongo's matching for the { field } and { $or: [...] }
// queries the service issues.
function matches(row: Row, query: Record<string, any>): boolean {
  if (query.$or) {
    return (query.$or as Record<string, any>[]).some((q) => matches(row, q));
  }
  return Object.entries(query).every(
    ([k, v]) => v !== undefined && row[k] === v,
  );
}

function fakeModel(rows: Row[]) {
  return {
    rows,
    findOne: jest.fn((query: Record<string, any>) => ({
      sort: () => ({
        exec: async () =>
          rows
            .filter((r) => matches(r, query))
            .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
      }),
      exec: async () => rows.find((r) => matches(r, query)) ?? null,
    })),
    create: jest.fn(async (data: Record<string, any>) => {
      const row = withSave({ ...data, createdAt: Date.now() });
      rows.push(row);
      return row;
    }),
  };
}

function setup(verification: Partial<ApplePurchaseVerification>) {
  const applePurchases = fakeModel([
    withSave({
      businessId: new Types.ObjectId(BUSINESS_ID),
      tier: 'combo',
      teamEnabled: false,
      productId: 'combo_yearly',
      transactionId: '1000',
      originalTransactionId: '1000',
      latestTransactionId: '1000',
    }),
  ]);
  const purchasedUntil = new Date(Date.now() + 5 * DAY);
  const subscriptions = fakeModel([
    withSave({
      businessId: BUSINESS_ID,
      tier: 'combo',
      teamEnabled: false,
      status: 'active',
      renewalDate: purchasedUntil,
      createdAt: Date.now() - 360 * DAY,
    }),
  ]);
  const businessesService = { updateSubscriptionStatus: jest.fn() };
  const appleVerificationService = {
    verifyTransaction: jest.fn().mockResolvedValue({
      isActive: true,
      revoked: false,
      productId: 'combo_yearly',
      ...verification,
    }),
    extractTransactionId: jest.fn(async (token: string) => token),
    extractNotificationTransaction: jest.fn(),
  };
  const service = new SubscriptionsService(
    subscriptions as any,
    {} as any,
    {} as any,
    applePurchases as any,
    businessesService as any,
    {} as any,
    {} as any,
    appleVerificationService as any,
  );
  return {
    service,
    applePurchases,
    subscription: subscriptions.rows[0],
    businessesService,
    appleVerificationService,
  };
}

describe('Apple renewal notifications', () => {
  it('finds the purchase by originalTransactionId and extends access', async () => {
    const renewedUntil = new Date(Date.now() + 370 * DAY);
    const { service, subscription, appleVerificationService, applePurchases } =
      setup({
        transactionId: '2000',
        originalTransactionId: '1000',
        expiresAt: renewedUntil,
      });

    // The renewal's own transactionId has never been seen before.
    await service.syncApplePurchase('2000', '1000');

    expect(appleVerificationService.verifyTransaction).toHaveBeenCalledWith(
      '2000',
    );
    expect(subscription.status).toBe('active');
    expect(subscription.renewalDate).toEqual(renewedUntil);
    expect(applePurchases.rows[0].latestTransactionId).toBe('2000');
  });

  it('still matches rows written before originalTransactionId was stored', async () => {
    const renewedUntil = new Date(Date.now() + 370 * DAY);
    const { service, subscription, applePurchases } = setup({
      transactionId: '2000',
      originalTransactionId: '1000',
      expiresAt: renewedUntil,
    });
    delete applePurchases.rows[0].originalTransactionId;
    delete applePurchases.rows[0].latestTransactionId;

    await service.syncApplePurchase('2000', '1000');

    expect(subscription.renewalDate).toEqual(renewedUntil);
    expect(applePurchases.rows[0].originalTransactionId).toBe('1000');
  });

  it('handles the whole notification payload end to end', async () => {
    const renewedUntil = new Date(Date.now() + 370 * DAY);
    const { service, subscription, appleVerificationService } = setup({
      transactionId: '2000',
      originalTransactionId: '1000',
      expiresAt: renewedUntil,
    });
    appleVerificationService.extractNotificationTransaction.mockResolvedValue({
      transactionId: '2000',
      originalTransactionId: '1000',
    });

    await service.handleAppleRenewalNotification({ signedPayload: 'x.y.z' });

    expect(subscription.renewalDate).toEqual(renewedUntil);
  });

  it('leaves the subscription alone when Apple cannot be reached', async () => {
    const { service, subscription, businessesService } = setup({
      isActive: false,
      productId: '',
    });
    const before = subscription.renewalDate;

    await service.syncApplePurchase('2000', '1000');

    expect(subscription.status).toBe('active');
    expect(subscription.renewalDate).toBe(before);
    expect(businessesService.updateSubscriptionStatus).not.toHaveBeenCalled();
  });
});

describe('Apple refunds and revocations', () => {
  it('expires access immediately even though expiresAt is in the future', async () => {
    const { service, subscription, businessesService } = setup({
      isActive: false,
      revoked: true,
      transactionId: '1000',
      originalTransactionId: '1000',
      expiresAt: new Date(Date.now() + 200 * DAY),
    });

    await service.syncApplePurchase('1000', '1000');

    expect(subscription.status).toBe('expired');
    expect(subscription.renewalDate.getTime()).toBeLessThanOrEqual(Date.now());
    expect(businessesService.updateSubscriptionStatus).toHaveBeenCalledWith(
      BUSINESS_ID,
      'expired',
    );
  });

  it('a plain cancellation still keeps access until the paid period ends', async () => {
    const paidUntil = new Date(Date.now() + 200 * DAY);
    const { service, subscription } = setup({
      isActive: false,
      revoked: false,
      transactionId: '1000',
      originalTransactionId: '1000',
      expiresAt: paidUntil,
    });
    // Same future expiry as the refund case above — only `revoked` differs.
    await service.syncApplePurchase('1000', '1000');

    expect(subscription.status).toBe('active');
    expect(subscription.renewalDate).toEqual(paidUntil);
  });
});

describe('re-posting an Apple purchase (restore / unfinished replay)', () => {
  it('updates the existing subscription instead of creating a second one', async () => {
    const renewedUntil = new Date(Date.now() + 370 * DAY);
    const { service, applePurchases, subscription } = setup({
      transactionId: '2000',
      originalTransactionId: '1000',
      expiresAt: renewedUntil,
    });

    await expect(
      service.verifyAndActivateApplePurchase(BUSINESS_ID, 'combo_yearly', '2000'),
    ).resolves.toEqual({ status: 'active' });

    expect(applePurchases.create).not.toHaveBeenCalled();
    expect(subscription.renewalDate).toEqual(renewedUntil);
  });

  it('is idempotent for a transaction already on file', async () => {
    const { service, appleVerificationService } = setup({});

    await expect(
      service.verifyAndActivateApplePurchase(BUSINESS_ID, 'combo_yearly', '1000'),
    ).resolves.toEqual({ status: 'active' });
    expect(appleVerificationService.verifyTransaction).not.toHaveBeenCalled();
  });

  it('refuses to attach one Apple subscription to a second business', async () => {
    const { service } = setup({
      transactionId: '2000',
      originalTransactionId: '1000',
      expiresAt: new Date(Date.now() + 370 * DAY),
    });

    await expect(
      service.verifyAndActivateApplePurchase(
        OTHER_BUSINESS_ID,
        'combo_yearly',
        '2000',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
