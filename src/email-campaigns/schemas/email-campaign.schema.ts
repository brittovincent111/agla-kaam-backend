import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type EmailCampaignDocument = EmailCampaign & Document;

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'QUEUED',
  'SENDING',
  'COMPLETED',
  'PAUSED',
  'FAILED',
  'CANCELLED',
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

@Schema({ _id: false })
export class CampaignLeadFilters {
  @Prop({ trim: true })
  status?: string;

  @Prop({ trim: true })
  category?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ trim: true })
  source?: string;

  @Prop({ type: [String], default: [] })
  tags?: string[];
}

export const CampaignLeadFiltersSchema =
  SchemaFactory.createForClass(CampaignLeadFilters);

// A short nudge sent if the lead hasn't replied, N days after the last email.
@Schema({ _id: false })
export class CampaignFollowUp {
  @Prop({ required: true, min: 1, max: 30 })
  delayDays: number;

  // Empty: "Re: <original subject>", so it reads as the same conversation.
  @Prop({ trim: true })
  subject?: string;

  @Prop({ required: true })
  body: string;
}

export const CampaignFollowUpSchema = SchemaFactory.createForClass(CampaignFollowUp);

@Schema({ timestamps: true })
export class EmailCampaign {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({ required: true, trim: true })
  htmlContent: string;

  @Prop({ trim: true })
  emailContent?: string;

  // Send only the plain-text body, like an email typed in a mail app.
  // For personal one-to-one outreach; newsletters keep HTML.
  @Prop({ default: false })
  plainTextOnly?: boolean;

  @Prop({ required: true, trim: true, default: 'Rajeev - Agla Kaam' })
  senderName: string;

  @Prop({ required: true, trim: true, default: 'rajeev@aglakaam.app' })
  senderEmail: string;

  @Prop({ trim: true })
  replyTo?: string;

  @Prop({ type: CampaignLeadFiltersSchema })
  leadFilters?: CampaignLeadFilters;

  // Leave out anyone another campaign has already emailed (or is about to).
  @Prop({ default: true })
  skipAlreadyEmailed?: boolean;

  @Prop({ type: [CampaignFollowUpSchema], default: [] })
  followUps?: CampaignFollowUp[];

  // Why sending is waiting, e.g. the daily limit.
  @Prop()
  statusNote?: string;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Lead' }],
    default: [],
  })
  selectedLeads?: Types.ObjectId[];

  @Prop({
    required: true,
    enum: CAMPAIGN_STATUSES,
    default: 'DRAFT',
    index: true,
  })
  status: CampaignStatus;

  @Prop({ default: 0 })
  totalRecipients: number;

  @Prop({ default: 0 })
  queuedCount: number;

  @Prop({ default: 0 })
  sentCount: number;

  @Prop({ default: 0 })
  deliveredCount: number;

  @Prop({ default: 0 })
  bouncedCount: number;

  @Prop({ default: 0 })
  complainedCount: number;

  @Prop({ default: 0 })
  unsubscribedCount: number;

  @Prop({ default: 0 })
  failedCount: number;

  @Prop({ default: 'Admin', trim: true })
  createdBy: string;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  pausedAt?: Date;

  @Prop()
  failureReason?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EmailCampaignSchema = SchemaFactory.createForClass(EmailCampaign);

EmailCampaignSchema.index({ status: 1, createdAt: -1 });
EmailCampaignSchema.index({ createdAt: -1 });
