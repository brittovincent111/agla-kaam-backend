import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type LeadDocument = Lead & Document;

export const LEAD_STATUSES = [
  'NEW',
  'REVIEWED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'INSTALLED',
  'NOT_INTERESTED',
  'INVALID',
  'DO_NOT_CONTACT',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

@Schema({ timestamps: true })
export class Lead {
  @Prop({ required: true, trim: true, index: true })
  businessName: string;

  @Prop({ trim: true })
  displayName?: string;

  @Prop({ default: '', trim: true, index: true })
  businessNameNormalized: string;

  @Prop({ required: true, index: true })
  category: string;

  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ default: 'India', index: true })
  country: string;

  @Prop({ index: true })
  state?: string;

  @Prop({ required: true, index: true })
  city: string;

  @Prop({ default: '', trim: true, index: true })
  cityNormalized: string;

  @Prop()
  area?: string;

  @Prop()
  address?: string;

  @Prop({ index: true })
  phone?: string;

  @Prop({ index: true, sparse: true })
  phoneNormalized?: string;

  @Prop()
  businessWhatsapp?: string;

  @Prop({ default: 'unknown' })
  phoneType?: string;

  @Prop()
  website?: string;

  @Prop()
  email?: string;

  @Prop({ required: true, index: true })
  source: string;

  @Prop({ index: true, sparse: true })
  sourcePlaceId?: string;

  @Prop()
  sourceUrl?: string;

  @Prop()
  latitude?: number;

  @Prop()
  longitude?: number;

  @Prop({ default: 0 })
  rating?: number;

  @Prop({ default: 0 })
  reviewCount?: number;

  @Prop({
    required: true,
    enum: LEAD_STATUSES,
    default: 'NEW',
    index: true,
  })
  status: LeadStatus;

  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ default: '' })
  notes: string;

  @Prop({ default: Date.now })
  lastCollectedAt: Date;

  @Prop()
  lastContactedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LeadSearchJob' })
  searchJobId?: Types.ObjectId;

  @Prop({ default: false, index: true })
  isEmailUnsubscribed: boolean;

  @Prop()
  unsubscribedAt?: Date;

  @Prop({
    type: String,
    enum: ['NONE', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'COMPLAINT'],
    default: 'NONE',
    index: true,
  })
  emailBounceStatus: 'NONE' | 'HARD_BOUNCE' | 'SOFT_BOUNCE' | 'COMPLAINT';

  @Prop()
  emailBouncedAt?: Date;

  @Prop()
  emailComplainedAt?: Date;

  // WhatsApp marketing: tapped "Stop promotions" (or replied STOP), or Meta
  // reported they stopped this business's marketing messages. Never sent to
  // again, by any campaign.
  @Prop({ default: false, index: true })
  isWhatsappOptedOut: boolean;

  @Prop()
  whatsappOptedOutAt?: Date;

  @Prop()
  lastWhatsappAt?: Date;

  @Prop()
  whatsappRepliedAt?: Date;

  // Where the email came from ('website' when read off the lead's own site),
  // and when the website was last checked, so it isn't fetched again soon.
  @Prop()
  emailSource?: string;

  @Prop()
  emailLookupAt?: Date;

  // Set when the lead's phone or email matches an Agla Kaam account.
  @Prop()
  installedAt?: Date;

  // The WhatsApp assistant's progress with this lead. botPausedAt: a person
  // took over (or a question it could not answer) — it stays quiet from then.
  @Prop() whatsappBotPausedAt?: Date;
  @Prop() whatsappBotWelcomedAt?: Date;
  @Prop() whatsappLanguage?: string;
  @Prop() whatsappClickedAt?: Date;
  @Prop() callRequestedAt?: Date;
  @Prop() whatsappNudgedAt?: Date;
  @Prop() whatsappFollowUpAt?: Date;
  @Prop() whatsappInstallWelcomedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business' })
  installedBusinessId?: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Deduplication and query compound indexes
LeadSchema.index({ source: 1, sourcePlaceId: 1 }, { sparse: true });
LeadSchema.index({ phoneNormalized: 1 }, { sparse: true });
LeadSchema.index({ businessNameNormalized: 1, cityNormalized: 1 });
LeadSchema.index({ status: 1, city: 1, category: 1 });
LeadSchema.index(
  { email: 1, isEmailUnsubscribed: 1, emailBounceStatus: 1 },
  { sparse: true },
);
LeadSchema.index({ createdAt: -1 });
