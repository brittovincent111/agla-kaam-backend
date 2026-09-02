import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SUBSCRIPTION_TIERS,
  SubscriptionTier,
} from '../../common/constants/subscription-options';

export type PlayPurchaseDocument = HydratedDocument<PlayPurchase>;

// One row per verified Google Play purchase token. purchaseToken is unique
// so a retried verify-purchase call (the client re-sending the same token
// after a network blip) can never activate a second subscription for it.
@Schema({ timestamps: true })
export class PlayPurchase {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, enum: SUBSCRIPTION_TIERS })
  tier: SubscriptionTier;

  @Prop({ default: false })
  teamEnabled: boolean;

  @Prop({ required: true })
  productId: string;

  @Prop({ required: true, unique: true, index: true })
  purchaseToken: string;
}

export const PlayPurchaseSchema = SchemaFactory.createForClass(PlayPurchase);
