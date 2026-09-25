import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LeadScheduleDocument = LeadSchedule & Document;

export const SCHEDULE_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

@Schema({ timestamps: true })
export class LeadSchedule {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, default: 'google_places' })
  provider: string;

  @Prop({ required: true, default: 'India' })
  country: string;

  @Prop({ default: '' })
  state?: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  category: string;

  @Prop({ default: '' })
  keyword?: string;

  @Prop({ required: true, default: 50 })
  limit: number;

  @Prop({ required: true, default: '0 2 * * *' })
  cronExpression: string;

  @Prop({
    required: true,
    enum: SCHEDULE_STATUSES,
    default: 'ACTIVE',
    index: true,
  })
  status: ScheduleStatus;

  @Prop()
  lastRunAt?: Date;

  @Prop()
  nextRunAt?: Date;
}

export const LeadScheduleSchema = SchemaFactory.createForClass(LeadSchedule);
