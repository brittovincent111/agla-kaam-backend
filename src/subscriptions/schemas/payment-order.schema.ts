import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SUBSCRIPTION_TIERS, SubscriptionTier } from '../../common/constants/subscription-options';

export type PaymentOrderDocument = HydratedDocument<PaymentOrder>;

// One row per Razorpay order we create. The webhook is the only thing that
// ever moves a row to 'paid' — nothing client-supplied is trusted, since the
// amount and plan were already fixed server-side when the order was created.
@Schema({ timestamps: true })
export class PaymentOrder {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, enum: SUBSCRIPTION_TIERS })
  tier: SubscriptionTier;

  @Prop({ default: false })
  teamEnabled: boolean;

  @Prop({ required: true, unique: true, index: true })
  razorpayOrderId: string;

  @Prop()
  razorpayPaymentId?: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, default: 'INR' })
  currency: string;

  @Prop({
    required: true,
    enum: ['created', 'paid', 'failed'],
    default: 'created',
  })
  status: 'created' | 'paid' | 'failed';
}

export const PaymentOrderSchema = SchemaFactory.createForClass(PaymentOrder);
