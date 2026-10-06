import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SUBSCRIPTION_TIERS,
  SubscriptionTier,
} from '../../common/constants/subscription-options';

export type ApplePurchaseDocument = HydratedDocument<ApplePurchase>;

// One row per verified App Store transaction — same idempotency role as
// PlayPurchase, keyed on Apple's transactionId instead of a purchase token.
@Schema({ timestamps: true })
export class ApplePurchase {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, enum: SUBSCRIPTION_TIERS })
  tier: SubscriptionTier;

  @Prop({ default: false })
  teamEnabled: boolean;

  @Prop({ required: true })
  productId: string;

  // The first transaction verified for this subscription. Renewals reuse
  // this row (see syncApplePurchase), so it is not "the latest" transaction.
  @Prop({ required: true, unique: true, index: true })
  transactionId: string;

  // Apple's id for the subscription as a whole: every renewal carries a new
  // transactionId but the same originalTransactionId, so renewal and refund
  // notifications are matched on this. Absent on rows written before it was
  // stored — for those the first transactionId IS the original one, which
  // is what the lookups fall back to.
  @Prop({ index: true })
  originalTransactionId?: string;

  // Most recent transaction Apple has told us about for this subscription,
  // so a restore re-posting the current renewal is recognised as known.
  @Prop()
  latestTransactionId?: string;
}

export const ApplePurchaseSchema = SchemaFactory.createForClass(ApplePurchase);
