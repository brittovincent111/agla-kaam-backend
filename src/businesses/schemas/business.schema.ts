import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BusinessDocument = HydratedDocument<Business>;

export type SubscriptionStatus = 'free' | 'active' | 'expired';

@Schema({ timestamps: true })
export class Business {
  @Prop({ required: true, trim: true, default: 'My Business' })
  name: string;

  @Prop({ trim: true })
  tradeType?: string;

  @Prop({ required: true, unique: true, index: true })
  phone: string;

  @Prop({
    required: true,
    default: 'free',
    enum: ['free', 'active', 'expired'],
  })
  subscriptionStatus: SubscriptionStatus;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ trim: true })
  address?: string;

  @Prop({ trim: true })
  email?: string;

  // Presence of a GSTIN is what turns on GST-style tax display (CGST/SGST
  // split) on invoices — there's no separate "GST enabled" toggle.
  @Prop({ trim: true, uppercase: true })
  gstin?: string;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
