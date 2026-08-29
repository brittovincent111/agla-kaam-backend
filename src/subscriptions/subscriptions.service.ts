import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionTier } from '../common/constants/subscription-options';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    private readonly businessesService: BusinessesService,
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
    if (subscription.renewalDate && subscription.renewalDate.getTime() < Date.now()) {
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

  // Dev/testing convenience until Razorpay checkout + webhook are wired up.
  // TODO: replace with a Razorpay subscription created via their API, and move
  // this activation into the webhook handler after signature verification.
  async activateManually(
    businessId: string,
    tier: SubscriptionTier,
    teamEnabled = false,
  ): Promise<SubscriptionDocument> {
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

  // TODO: verify the Razorpay webhook signature (x-razorpay-signature header)
  // against RAZORPAY_WEBHOOK_SECRET before trusting this payload.
  async handleRazorpayWebhook(payload: unknown): Promise<void> {
    this.logger.warn(
      'Received Razorpay webhook but no handler is implemented yet. Payload logged for reference.',
    );
    this.logger.debug(JSON.stringify(payload));
  }
}
