import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsappCampaignDocument = HydratedDocument<WhatsappCampaign>;

export const WHATSAPP_CAMPAIGN_STATUSES = [
  'DRAFT',
  'QUEUED',
  'SENDING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type WhatsappCampaignStatus = (typeof WHATSAPP_CAMPAIGN_STATUSES)[number];

// The lead fields a template variable ({{1}}, {{2}}…) can be filled from.
export const WHATSAPP_PARAM_FIELDS = ['businessName', 'displayName', 'city', 'category'] as const;
export type WhatsappParamField = (typeof WHATSAPP_PARAM_FIELDS)[number];

@Schema({ _id: false })
export class WhatsappLeadFilters {
  @Prop() status?: string;
  @Prop() category?: string;
  @Prop() city?: string;
  @Prop() state?: string;
  @Prop() source?: string;
  @Prop({ type: [String], default: undefined }) tags?: string[];
}

/**
 * A bulk send of one approved WhatsApp template to a set of leads.
 * The template itself lives in WhatsApp Manager (Meta approves it there);
 * this only records which one, in which language, and who gets it.
 */
@Schema({ timestamps: true })
export class WhatsappCampaign {
  @Prop({ required: true, trim: true })
  name: string;

  // As named in WhatsApp Manager, e.g. "aglakaam_first_hello".
  @Prop({ required: true, trim: true })
  templateName: string;

  // Template language code: "en", "hi", "en_US"…
  @Prop({ required: true, trim: true, default: 'en' })
  languageCode: string;

  // Public image for a template with an image header (sent with every message).
  @Prop({ trim: true })
  headerImageUrl?: string;

  // Lead field for each body variable, in order: ["businessName"] fills {{1}}.
  @Prop({ type: [String], default: ['businessName'] })
  bodyParams: WhatsappParamField[];

  @Prop({ type: WhatsappLeadFilters, default: {} })
  leadFilters: WhatsappLeadFilters;

  @Prop({ type: [Types.ObjectId], default: [] })
  selectedLeads: Types.ObjectId[];

  // Never message a lead this template already reached in another campaign.
  @Prop({ default: true })
  skipAlreadyMessaged: boolean;

  @Prop({ enum: WHATSAPP_CAMPAIGN_STATUSES, default: 'DRAFT', index: true })
  status: WhatsappCampaignStatus;

  // Why it stopped by itself (expired token, daily cap…), for the admin.
  @Prop()
  statusNote?: string;

  @Prop({ default: 0 }) totalRecipients: number;
  @Prop({ default: 0 }) queuedCount: number;
  @Prop({ default: 0 }) sentCount: number;
  @Prop({ default: 0 }) deliveredCount: number;
  @Prop({ default: 0 }) readCount: number;
  @Prop({ default: 0 }) failedCount: number;
  @Prop({ default: 0 }) skippedCount: number;
  @Prop({ default: 0 }) repliedCount: number;
  @Prop({ default: 0 }) optedOutCount: number;

  @Prop() startedAt?: Date;
  @Prop() completedAt?: Date;
  @Prop() createdBy?: string;
}

export const WhatsappCampaignSchema = SchemaFactory.createForClass(WhatsappCampaign);
