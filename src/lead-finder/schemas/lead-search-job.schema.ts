import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LeadSearchJobDocument = LeadSearchJob & Document;

export const SEARCH_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type SearchJobStatus = (typeof SEARCH_JOB_STATUSES)[number];

@Schema({ timestamps: true })
export class LeadSearchJob {
  @Prop({
    required: true,
    enum: SEARCH_JOB_STATUSES,
    default: 'QUEUED',
    index: true,
  })
  status: SearchJobStatus;

  @Prop({ required: true, default: 'google_places' })
  provider: string;

  @Prop({ required: true, default: 'India' })
  country: string;

  @Prop({ default: '' })
  state?: string;

  @Prop({ required: true })
  city: string;

  @Prop({ default: '' })
  area?: string;

  @Prop({ required: true })
  category: string;

  @Prop({ default: '' })
  keyword?: string;

  @Prop({ required: true, default: 50 })
  requestedLimit: number;

  @Prop({ default: 0 })
  processedCount: number;

  @Prop({ default: 0 })
  newLeads: number;

  @Prop({ default: 0 })
  duplicateLeads: number;

  @Prop({ default: 0 })
  failedCount: number;

  @Prop({ default: '' })
  error?: string;

  @Prop({ default: 0 })
  apiRequestsCount: number;

  @Prop({ default: 0 })
  estimatedCostUsd: number;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ default: 'admin' })
  createdBy: string;
}

export const LeadSearchJobSchema = SchemaFactory.createForClass(LeadSearchJob);

LeadSearchJobSchema.index({ status: 1, createdAt: -1 });
LeadSearchJobSchema.index({ createdAt: -1 });
