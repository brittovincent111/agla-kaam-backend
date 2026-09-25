import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LeadProviderUsageDocument = LeadProviderUsage & Document;

@Schema({ timestamps: true })
export class LeadProviderUsage {
  @Prop({ required: true, index: true })
  provider: string; // e.g. 'google_places'

  @Prop({ required: true, index: true })
  dateKey: string; // 'YYYY-MM-DD' for daily aggregation

  @Prop({ required: true, index: true })
  monthKey: string; // 'YYYY-MM' for monthly quota tracking

  @Prop({ default: 0 })
  requestCount: number;

  @Prop({ default: 0 })
  leadsDiscovered: number;

  @Prop({ default: 0 })
  estimatedCostUsd: number;
}

export const LeadProviderUsageSchema = SchemaFactory.createForClass(LeadProviderUsage);

LeadProviderUsageSchema.index({ provider: 1, dateKey: 1 }, { unique: true });
LeadProviderUsageSchema.index({ provider: 1, monthKey: 1 });
