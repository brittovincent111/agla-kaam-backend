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

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Deduplication and query compound indexes
LeadSchema.index({ source: 1, sourcePlaceId: 1 }, { sparse: true });
LeadSchema.index({ phoneNormalized: 1 }, { sparse: true });
LeadSchema.index({ businessNameNormalized: 1, cityNormalized: 1 });
LeadSchema.index({ status: 1, city: 1, category: 1 });
LeadSchema.index({ createdAt: -1 });
