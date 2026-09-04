import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
// A plain `import Razorpay from 'razorpay'` is unsafe here: the project
// doesn't have esModuleInterop enabled (turning it on elsewhere broke an
// unrelated e2e test's supertest import typing), and without it a default
// import of this CJS package resolves to `undefined` at runtime instead of
// the constructor. This `require()` form is the deliberate, correct fix.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Razorpay = require('razorpay');
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from './schemas/payment-order.schema';
import {
  PlayPurchase,
  PlayPurchaseDocument,
} from './schemas/play-purchase.schema';
import {
  ApplePurchase,
  ApplePurchaseDocument,
} from './schemas/apple-purchase.schema';
import { GooglePlayVerificationService } from './google-play-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { BusinessesService } from '../businesses/businesses.service';
import {
  SubscriptionTier,
  SUBSCRIPTION_PRODUCT_IDS,
  getPlanAmountRupees,
  tierAllowsTeam,
} from '../common/constants/subscription-options';

export interface CreatedOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

// How long a still-'created' order for the same business+tier+teamEnabled
// is treated as reusable rather than creating a second Razorpay order.
const ORDER_REUSE_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private razorpayClient?: Razorpay;

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly paymentOrderModel: Model<PaymentOrderDocument>,
    @InjectModel(PlayPurchase.name)
    private readonly playPurchaseModel: Model<PlayPurchaseDocument>,
    @InjectModel(ApplePurchase.name)
    private readonly applePurchaseModel: Model<ApplePurchaseDocument>,
    private readonly businessesService: BusinessesService,
    private readonly configService: ConfigService,
    private readonly googlePlayVerificationService: GooglePlayVerificationService,
    private readonly appleVerificationService: AppleVerificationService,
  ) {}

  findCurrentForBusiness(
    businessId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.subscriptionModel
      .findOne({ businessId })
      .sort({ createdAt: -1 })
      .exec();
  }

  // Returns the active subscription only if it's genuinely still in force
  // (status active and not past its renewal date) — a stale 'active' row
  // whose renewalDate has lapsed is treated as no subscription at all.
  async findActiveForBusiness(
    businessId: string,
  ): Promise<SubscriptionDocument | null> {
    const subscription = await this.findCurrentForBusiness(businessId);
    if (!subscription || subscription.status !== 'active') return null;
    if (
      subscription.renewalDate &&
      subscription.renewalDate.getTime() < Date.now()
    ) {
      return null;
    }
    return subscription;
  }

  async getActiveTier(businessId: string): Promise<SubscriptionTier | null> {
    const subscription = await this.findActiveForBusiness(businessId);
    return subscription?.tier ?? null;
  }

  async hasActiveTeamAddon(businessId: string): Promise<boolean> {
    const subscription = await this.findActiveForBusiness(businessId);
    return subscription?.teamEnabled ?? false;
  }

  // Dev/testing convenience for exercising the paid-tier UI without going
  // through Razorpay. Disabled outside development so it can't be used to
  // bypass payment once this ships to real users.
  async activateManually(
    businessId: string,
    tier: SubscriptionTier,
    teamEnabled = false,
  ): Promise<SubscriptionDocument> {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'Manual activation is disabled in production — pay through the app.',
      );
    }

    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);

    const subscription = await this.subscriptionModel.create({
      businessId,
      tier,
      teamEnabled,
      status: 'active',
      renewalDate,
    });

    await this.businessesService.updateSubscriptionStatus(businessId, 'active');
    return subscription;
  }

  // Creates a Razorpay order for the chosen plan. The amount is always
  // computed here from the tier — never accepted from the client — so
  // nothing the mobile app sends can change what gets charged.
  async createOrder(
    businessId: string,
    tier: SubscriptionTier,
    teamEnabled = false,
  ): Promise<CreatedOrder> {
    const effectiveTeamEnabled = tierAllowsTeam(tier) && teamEnabled;
    const amountPaise = getPlanAmountRupees(tier, effectiveTeamEnabled) * 100;
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    if (!keyId) {
      throw new InternalServerErrorException(
        'Razorpay is not configured on this server.',
      );
    }

    // A retried/duplicated request (flaky network, a double-tap that slips
    // past the button's own disabled state) must not mint a second Razorpay
    // order for the same intent — reuse a still-pending one instead.
    const existing = await this.paymentOrderModel
      .findOne({
        businessId,
        tier,
        teamEnabled: effectiveTeamEnabled,
        status: 'created',
        createdAt: { $gte: new Date(Date.now() - ORDER_REUSE_WINDOW_MS) },
      })
      .sort({ createdAt: -1 })
      .exec();
    if (existing) {
      return {
        orderId: existing.razorpayOrderId,
        amount: existing.amount,
        currency: existing.currency,
        keyId,
      };
    }

    const client = this.getRazorpayClient();
    console.log(
      `[createOrder] businessId=${businessId} tier=${tier} teamEnabled=${effectiveTeamEnabled} amountPaise=${amountPaise}`,
    );
    const order = await client.orders
      .create({
        amount: amountPaise,
        currency: 'INR',
        notes: {
          businessId,
          tier,
          teamEnabled: String(effectiveTeamEnabled),
        },
      })
      .catch((err) => {
        console.error('[createOrder] Razorpay order create failed:', err);
        throw err;
      });

    await this.paymentOrderModel.create({
      businessId,
      tier,
      teamEnabled: effectiveTeamEnabled,
      razorpayOrderId: order.id,
      amount: amountPaise,
      currency: order.currency,
      status: 'created',
    });

    return {
      orderId: order.id,
      amount: amountPaise,
      currency: order.currency,
      keyId,
    };
  }

  // Razorpay is the only thing that can activate a real subscription: the
  // webhook signature is verified against the raw body before anything in
  // the payload is trusted, and the amount/plan were already fixed
  // server-side when the order was created — nothing here comes from the
  // client.
  async handleRazorpayWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    const webhookSecret = this.configService.get<string>(
      'RAZORPAY_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      this.logger.error(
        'RAZORPAY_WEBHOOK_SECRET is not configured; rejecting webhook.',
      );
      throw new ForbiddenException();
    }
    if (!signature || !rawBody) {
      throw new ForbiddenException('Missing signature');
    }

    const rawBodyString = rawBody.toString('utf8');
    const isValid = Razorpay.validateWebhookSignature(
      rawBodyString,
      signature,
      webhookSecret,
    );
    if (!isValid) {
      this.logger.warn('Rejected Razorpay webhook with invalid signature.');
      throw new ForbiddenException('Invalid signature');
    }

    const payload = JSON.parse(rawBodyString);
    if (payload.event !== 'payment.captured') {
      // Acknowledge and ignore — we only act on payment.captured.
      return;
    }

    const paymentEntity = payload.payload?.payment?.entity;
    const razorpayOrderId: string | undefined = paymentEntity?.order_id;
    const razorpayPaymentId: string | undefined = paymentEntity?.id;
    if (!razorpayOrderId || !razorpayPaymentId) {
      this.logger.warn('payment.captured webhook missing order/payment id.');
      return;
    }

    const order = await this.paymentOrderModel.findOne({ razorpayOrderId });
    if (!order) {
      this.logger.warn(
        `No PaymentOrder found for Razorpay order ${razorpayOrderId}.`,
      );
      return;
    }
    if (order.status === 'paid') {
      // Razorpay retries webhooks — already processed, nothing more to do.
      return;
    }

    order.status = 'paid';
    order.razorpayPaymentId = razorpayPaymentId;
    await order.save();

    await this.activateFromOrder(order);
  }

  private async activateFromOrder(order: PaymentOrderDocument): Promise<void> {
    await this.activateSubscription({
      businessId: order.businessId.toString(),
      tier: order.tier,
      teamEnabled: order.teamEnabled,
      razorpaySubscriptionId: order.razorpayOrderId,
    });
  }

  private async activateSubscription(params: {
    businessId: string;
    tier: SubscriptionTier;
    teamEnabled: boolean;
    razorpaySubscriptionId?: string;
  }): Promise<void> {
    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);

    await this.subscriptionModel.create({
      businessId: params.businessId,
      tier: params.tier,
      teamEnabled: params.teamEnabled,
      status: 'active',
      renewalDate,
      razorpaySubscriptionId: params.razorpaySubscriptionId,
    });

    await this.businessesService.updateSubscriptionStatus(
      params.businessId,
      'active',
    );
  }

  // Google Play is the only thing that can activate a subscription bought
  // through it: the purchase token is verified against the Android
  // Publisher API before anything the client claims (productId, "it
  // succeeded") is trusted — same principle as the Razorpay webhook
  // signature check above, via Google's API instead of an HMAC.
  async verifyAndActivatePlayPurchase(
    businessId: string,
    productId: string,
    purchaseToken: string,
  ): Promise<{ status: 'active' }> {
    const mapped = SUBSCRIPTION_PRODUCT_IDS[productId];
    if (!mapped) {
      throw new BadRequestException(`Unknown Play product id: ${productId}`);
    }

    // Already processed this exact token (a retried client call) — the
    // subscription is already active, nothing more to do.
    const existing = await this.playPurchaseModel
      .findOne({ purchaseToken })
      .exec();
    if (existing) {
      return { status: 'active' };
    }

    const verification =
      await this.googlePlayVerificationService.verifySubscriptionPurchase(
        purchaseToken,
      );
    if (!verification.isActive) {
      throw new ForbiddenException('This purchase is not active.');
    }
    if (!verification.productIds.includes(productId)) {
      throw new ForbiddenException(
        'Purchase token does not match the requested plan.',
      );
    }

    if (verification.needsAcknowledgement) {
      await this.googlePlayVerificationService.acknowledgePurchase(
        productId,
        purchaseToken,
      );
    }

    try {
      await this.playPurchaseModel.create({
        businessId,
        tier: mapped.tier,
        teamEnabled: mapped.teamEnabled,
        productId,
        purchaseToken,
      });
    } catch (err) {
      // Concurrent duplicate call raced past the findOne check above — the
      // unique index on purchaseToken caught it, so this is already active.
      if ((err as { code?: number }).code === 11000) {
        return { status: 'active' };
      }
      throw err;
    }

    await this.activateSubscription({
      businessId,
      tier: mapped.tier,
      teamEnabled: mapped.teamEnabled,
    });

    return { status: 'active' };
  }

  // Same shape and same trust model as verifyAndActivatePlayPurchase above,
  // just against the App Store Server API instead of the Android Publisher
  // API — a client-reported purchase is never trusted on its own.
  async verifyAndActivateApplePurchase(
    businessId: string,
    productId: string,
    purchaseToken: string,
  ): Promise<{ status: 'active' }> {
    const mapped = SUBSCRIPTION_PRODUCT_IDS[productId];
    if (!mapped) {
      throw new BadRequestException(`Unknown Apple product id: ${productId}`);
    }

    const transactionId =
      await this.appleVerificationService.extractTransactionId(purchaseToken);

    const existing = await this.applePurchaseModel
      .findOne({ transactionId })
      .exec();
    if (existing) {
      return { status: 'active' };
    }

    console.log(
      `[verifyAndActivateApplePurchase] businessId=${businessId} productId=${productId} transactionId=${transactionId}`,
    );
    const verification = await this.appleVerificationService
      .verifyTransaction(transactionId)
      .catch((err) => {
        console.error(
          '[verifyAndActivateApplePurchase] verifyTransaction failed:',
          err,
        );
        throw err;
      });
    if (!verification.isActive) {
      throw new ForbiddenException('This purchase is not active.');
    }
    if (verification.productId !== productId) {
      throw new ForbiddenException(
        'Transaction does not match the requested plan.',
      );
    }

    try {
      await this.applePurchaseModel.create({
        businessId,
        tier: mapped.tier,
        teamEnabled: mapped.teamEnabled,
        productId,
        transactionId,
      });
    } catch (err) {
      // Concurrent duplicate call raced past the findOne check above — the
      // unique index on transactionId caught it, so this is already active.
      if ((err as { code?: number }).code === 11000) {
        return { status: 'active' };
      }
      throw err;
    }

    await this.activateSubscription({
      businessId,
      tier: mapped.tier,
      teamEnabled: mapped.teamEnabled,
    });

    return { status: 'active' };
  }

  private getRazorpayClient(): Razorpay {
    if (!this.razorpayClient) {
      const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
      const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
      if (!keyId || !keySecret) {
        throw new InternalServerErrorException(
          'Razorpay is not configured on this server.',
        );
      }
      this.razorpayClient = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
    }
    return this.razorpayClient;
  }
}
