import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SUBSCRIPTION_TIERS, SubscriptionTier } from '../../common/constants/subscription-options';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, enum: SUBSCRIPTION_TIERS })
  tier: SubscriptionTier;

  // Add-on, not a tier on its own — only meaningful (and only sold) alongside
  // a 'reminders' or 'combo' tier, since it grants technician logins that
  // need the service-tracking feature to do anything.
  @Prop({ default: false })
  teamEnabled: boolean;

  @Prop({
    required: true,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active',
  })
  status: 'active' | 'expired' | 'cancelled';

  @Prop()
  renewalDate?: Date;

  @Prop()
  razorpaySubscriptionId?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
