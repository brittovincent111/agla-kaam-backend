import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * The steps a new install goes through before it becomes an account —
 * opened, saw the welcome screen, tapped a sign-up button. Ads and the
 * Play Store only count installs, and the database only counts accounts;
 * this shows where the people in between leave. Anonymous: a random id
 * the app makes on first open, the step, the platform. Each step is kept
 * once per install.
 */
export const APP_EVENTS = [
  'first_open',
  'welcome_view',
  'welcome_google',
  'welcome_apple',
  'welcome_email',
  'welcome_login',
  'setup_view',
  'setup_error',
  'setup_done',
] as const;
export type AppEventName = (typeof APP_EVENTS)[number];

export type AppEventDocument = HydratedDocument<AppEvent>;

@Schema({ timestamps: false, collection: 'appevents' })
export class AppEvent {
  @Prop({ required: true })
  installId: string;

  @Prop({ required: true, enum: APP_EVENTS })
  event: AppEventName;

  @Prop()
  platform?: string;

  @Prop({ required: true })
  at: Date;
}

export const AppEventSchema = SchemaFactory.createForClass(AppEvent);
AppEventSchema.index({ installId: 1, event: 1 }, { unique: true });
AppEventSchema.index({ at: -1 });
