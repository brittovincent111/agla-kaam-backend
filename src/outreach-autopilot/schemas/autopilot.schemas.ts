import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

// ---------------------------------------------------------------- Region

@Schema({ _id: false })
export class RegionPlace {
  @Prop({ trim: true, default: '' })
  state: string;

  @Prop({ required: true, trim: true })
  city: string;

  // Searched one by one; empty means the city as a whole.
  @Prop({ type: [String], default: [] })
  localities: string[];
}
export const RegionPlaceSchema = SchemaFactory.createForClass(RegionPlace);

/** A group of cities that share a language and a share of the daily limits. */
@Schema({ timestamps: true })
export class AutopilotRegion {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, default: 'en' })
  language: string;

  @Prop({ type: [RegionPlaceSchema], default: [] })
  places: RegionPlace[];

  @Prop({ type: [String], default: [] })
  categories: string[];

  // Share of each daily limit relative to other regions (1 = equal).
  @Prop({ default: 1, min: 0, max: 10 })
  weight: number;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: true })
  useWhatsapp: boolean;

  @Prop({ default: true })
  useEmail: boolean;
}
export type AutopilotRegionDocument = HydratedDocument<AutopilotRegion>;
export const AutopilotRegionSchema = SchemaFactory.createForClass(AutopilotRegion);

// ---------------------------------------------------------------- Settings

export const APPROVAL_MODES = ['two_weeks', 'always', 'auto'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** One document (key "main"): the switch, the limits and the messages. */
@Schema({ timestamps: true })
export class AutopilotSettings {
  @Prop({ required: true, unique: true, default: 'main' })
  key: string;

  // Master switch. Nothing runs while it is off.
  @Prop({ default: false })
  enabled: boolean;

  // two_weeks: you approve each day's plan until autoApproveFrom, then it
  // runs by itself. always: approval every day. auto: never asks.
  @Prop({ enum: APPROVAL_MODES, default: 'two_weeks' })
  approvalMode: ApprovalMode;

  @Prop()
  autoApproveFrom?: Date;

  // Google Places calls free each month for the fields lead search reads
  // (phone + website put it in the Text Search Enterprise tier).
  // 0 = the server's LEAD_FINDER_FREE_MONTHLY (7,000 on the India price list).
  @Prop({ default: 0, min: 0 })
  searchFreeMonthly: number;

  // WhatsApp: people per day, never above the number's Meta tier or WHATSAPP_DAILY_LIMIT.
  @Prop({ default: 250, min: 0 })
  whatsappMaxPerDay: number;

  // Email warm-up for a new sending domain: start, daily growth, ceiling.
  @Prop({ default: 50, min: 0 })
  emailStartPerDay: number;

  @Prop({ default: 1.25, min: 1, max: 2 })
  emailGrowth: number;

  @Prop({ default: 200, min: 0 })
  emailMaxPerDay: number;

  // Someone with both: WhatsApp first, email this many days later if no reply.
  @Prop({ default: 3, min: 1, max: 30 })
  emailAfterWhatsappDays: number;

  @Prop({ default: 'Rajeev', trim: true })
  senderName: string;

  @Prop({ default: 'rajeev@aglakaam.app', trim: true })
  senderEmail: string;

  @Prop({ default: 'support@aglakaam.app', trim: true })
  replyTo: string;

  // Where "today's plan is ready" and the evening report go. Empty: none.
  @Prop({ trim: true, default: '' })
  notifyEmail: string;

  // Per language: email subject/body/follow-up and the WhatsApp template.
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  messages: Record<string, any>;
}
export type AutopilotSettingsDocument = HydratedDocument<AutopilotSettings>;
export const AutopilotSettingsSchema = SchemaFactory.createForClass(AutopilotSettings);

// ---------------------------------------------------------------- Day

export const DAY_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'LAUNCHED', 'SKIPPED', 'EXPIRED'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/** One India day: searches run, the outreach plan, its approval and its report. */
@Schema({ timestamps: true })
export class AutopilotDay {
  // "2026-10-05" (India date)
  @Prop({ required: true, unique: true, index: true })
  dayKey: string;

  @Prop({ enum: DAY_STATUSES })
  status?: DayStatus;

  @Prop()
  searchesRunAt?: Date;

  @Prop({ default: 0 })
  searchBudget: number;

  @Prop()
  plannedAt?: Date;

  // { whatsapp, email } people planned for the day, after brakes.
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  caps: { whatsapp?: number; email?: number; whatsappQuality?: string; whatsappTier?: string };

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  brakes: { channel: 'whatsapp' | 'email' | 'search'; reason: string }[];

  // Per region: searches, and the WhatsApp/email batches.
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  regions: any[];

  @Prop()
  approvedAt?: Date;

  @Prop()
  approvedBy?: string;

  @Prop()
  launchedAt?: Date;

  @Prop({ type: [String], default: [] })
  notes: string[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  report?: any;
}
export type AutopilotDayDocument = HydratedDocument<AutopilotDay>;
export const AutopilotDaySchema = SchemaFactory.createForClass(AutopilotDay);

export type ObjectIdLike = Types.ObjectId | string;
