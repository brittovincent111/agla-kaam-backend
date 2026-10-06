import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type EmailCampaignRecipientDocument = EmailCampaignRecipient & Document;

export const RECIPIENT_STATUSES = [
  'PENDING',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'UNSUBSCRIBED',
  // Left out at send time, e.g. already uses Agla Kaam.
  'SKIPPED',
] as const;

export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

@Schema({ timestamps: true })
export class EmailCampaignRecipient {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'EmailCampaign',
    required: true,
    index: true,
  })
  campaignId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true,
  })
  leadId: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  email: string;

  @Prop({ trim: true })
  businessName?: string;

  @Prop({ trim: true })
  displayName?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  category?: string;

  @Prop({
    required: true,
    enum: RECIPIENT_STATUSES,
    default: 'QUEUED',
    index: true,
  })
  status: RecipientStatus;

  @Prop({ trim: true, index: true, sparse: true })
  sesMessageId?: string;

  @Prop()
  sentAt?: Date;

  @Prop()
  deliveredAt?: Date;

  @Prop()
  bouncedAt?: Date;

  @Prop()
  complainedAt?: Date;

  @Prop()
  unsubscribedAt?: Date;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: 3 })
  maxRetries: number;

  @Prop({ trim: true })
  failureReason?: string;

  @Prop({ index: true })
  lockedAt?: Date;

  // Follow-ups: how many have gone, when the next is due, and why they stopped.
  @Prop({ default: 0 })
  followUpStep: number;

  @Prop({ index: true, sparse: true })
  nextFollowUpAt?: Date;

  @Prop({ index: true, sparse: true })
  lastSentAt?: Date;

  @Prop()
  followUpLockedAt?: Date;

  @Prop()
  followUpStopReason?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EmailCampaignRecipientSchema = SchemaFactory.createForClass(
  EmailCampaignRecipient,
);

// Prevent duplicate sends of the same email within the same campaign
EmailCampaignRecipientSchema.index(
  { campaignId: 1, email: 1 },
  { unique: true },
);

// Worker queue polling index
EmailCampaignRecipientSchema.index({
  campaignId: 1,
  status: 1,
  lockedAt: 1,
});

// Stale lock recovery index
EmailCampaignRecipientSchema.index({ status: 1, lockedAt: 1 });
