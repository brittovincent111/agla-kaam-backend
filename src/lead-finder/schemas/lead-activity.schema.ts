import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type LeadActivityDocument = LeadActivity & Document;

export const LEAD_ACTIVITY_TYPES = [
  'CONTACTED',
  'CALL',
  'WHATSAPP',
  'EMAIL',
  'REPLY',
  'INTERESTED',
  'NOT_INTERESTED',
  'INSTALL',
  'OTHER',
] as const;

export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

@Schema({ timestamps: true })
export class LeadActivity {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Lead', required: true, index: true })
  leadId: Types.ObjectId;

  @Prop({
    required: true,
    enum: LEAD_ACTIVITY_TYPES,
  })
  type: LeadActivityType;

  @Prop({ default: '', trim: true })
  message?: string;

  @Prop({ default: '', trim: true })
  notes?: string;

  @Prop({ default: 'Admin' })
  performedBy: string;
}

export const LeadActivitySchema = SchemaFactory.createForClass(LeadActivity);

LeadActivitySchema.index({ leadId: 1, createdAt: -1 });
