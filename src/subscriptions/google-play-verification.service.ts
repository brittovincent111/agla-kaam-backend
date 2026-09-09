import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';

const ANDROID_PUBLISHER_SCOPE =
  'https://www.googleapis.com/auth/androidpublisher';

// Subset of the subscriptionsv2.get response we actually use.
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
interface SubscriptionPurchaseV2 {
  subscriptionState?: string;
  lineItems?: { productId: string }[];
  acknowledgementState?: string;
  latestOrderId?: string;
}

export interface PlayPurchaseVerification {
  isActive: boolean;
  productIds: string[];
  orderId?: string;
  needsAcknowledgement: boolean;
  // When Google says the entitlement actually runs out. The local code used
  // to assume "one year from now", which drifts from the real renewal date
  // and, on a renewal, expired a customer who was still being billed.
  expiresAt?: Date;
  // SUBSCRIPTION_STATE_CANCELED still grants access until expiry — the user
  // has turned off auto-renew but paid for the current period.
  state?: string;
}

// Talks to the Android Publisher API server-to-server using a service
// account, so a client-reported "purchase succeeded" is never trusted
// without an independent check against Google — same principle as the
// Razorpay webhook signature check, just a different payment rail.
@Injectable()
export class GooglePlayVerificationService {
  private auth?: GoogleAuth;

  constructor(private readonly configService: ConfigService) {}

  private isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'),
    );
  }

  private getPackageName(): string {
    return (
      this.configService.get<string>('GOOGLE_PLAY_PACKAGE_NAME') ??
      'com.aglakaam.app'
    );
  }

  private getAuth(): GoogleAuth {
    if (!this.auth) {
      const raw = this.configService.get<string>(
        'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      );
      if (!raw) {
        throw new InternalServerErrorException(
          'Google Play billing is not configured on this server.',
        );
      }
      let credentials: { client_email: string; private_key: string };
      try {
        credentials = JSON.parse(raw);
      } catch {
        throw new InternalServerErrorException(
          'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON.',
        );
      }
      this.auth = new GoogleAuth({
        credentials,
        scopes: [ANDROID_PUBLISHER_SCOPE],
      });
    }
    return this.auth;
  }

  // Verifies a subscription purchase token against Google directly —
  // returns whether it's genuinely active and for which product(s), never
  // trusting the productId/state the client claims.
  async verifySubscriptionPurchase(
    purchaseToken: string,
  ): Promise<PlayPurchaseVerification> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException(
        'Google Play billing is not configured on this server.',
      );
    }
    const client = await this.getAuth().getClient();
    const packageName = this.getPackageName();
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/` +
      `${encodeURIComponent(purchaseToken)}`;

    const response = await client.request<SubscriptionPurchaseV2>({ url });
    const data = response.data;

    const productIds = (data.lineItems ?? [])
      .map((item) => item.productId)
      .filter((id): id is string => Boolean(id));

    // The latest expiry across line items — a plan change can leave more
    // than one.
    const expiryTimes = (data.lineItems ?? [])
      .map((item) => (item as { expiryTime?: string }).expiryTime)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));
    const expiresAt = expiryTimes.length
      ? new Date(Math.max(...expiryTimes.map((d) => d.getTime())))
      : undefined;

    const state = data.subscriptionState;
    return {
      // A cancelled-but-not-yet-expired subscription is still paid for, so it
      // still counts as active until its expiry passes.
      isActive:
        state === 'SUBSCRIPTION_STATE_ACTIVE' ||
        state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ||
        (state === 'SUBSCRIPTION_STATE_CANCELED' &&
          !!expiresAt &&
          expiresAt.getTime() > Date.now()),
      productIds,
      orderId: data.latestOrderId,
      needsAcknowledgement: data.acknowledgementState !== 'ACKNOWLEDGED',
      expiresAt,
      state,
    };
  }

  // Purchases must be acknowledged within 3 days or Google auto-refunds
  // them — best-effort, failures here (e.g. already acknowledged) don't
  // block activation since the purchase itself already verified as active.
  async acknowledgePurchase(
    productId: string,
    purchaseToken: string,
  ): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const client = await this.getAuth().getClient();
      const packageName = this.getPackageName();
      const url =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(packageName)}/purchases/subscriptions/` +
        `${encodeURIComponent(productId)}/tokens/` +
        `${encodeURIComponent(purchaseToken)}:acknowledge`;
      await client.request({ url, method: 'POST', data: {} });
    } catch {
      // Already acknowledged, or a transient API error — not fatal.
    }
  }
}
