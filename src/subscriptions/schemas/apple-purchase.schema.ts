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

  @Prop({ required: true, unique: true, index: true })
  transactionId: string;
}

export const ApplePurchaseSchema = SchemaFactory.createForClass(ApplePurchase);
