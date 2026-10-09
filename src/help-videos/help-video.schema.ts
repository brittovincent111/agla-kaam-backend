import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  HELP_VIDEO_AUDIENCES,
  HELP_VIDEO_LANGUAGES,
  HELP_VIDEO_SCREENS,
  type HelpVideoAudience,
  type HelpVideoLanguage,
  type HelpVideoScreen,
} from './help-video-options';

export type HelpVideoDocument = HydratedDocument<HelpVideo>;

/**
 * A YouTube how-to shown in the app, managed by the platform admin. Platform
 * wide, not per business: every business sees the same set.
 */
@Schema({ timestamps: true })
export class HelpVideo {
  @Prop({ required: true, trim: true, maxlength: 120 })
  title: string;

  /** The 11-character id only — links are parsed down to it on save. */
  @Prop({ required: true, match: /^[A-Za-z0-9_-]{11}$/ })
  youtubeId: string;

  @Prop({ required: true, enum: HELP_VIDEO_SCREENS })
  screen: HelpVideoScreen;

  @Prop({ enum: HELP_VIDEO_LANGUAGES, default: 'en' })
  language: HelpVideoLanguage;

  @Prop({ enum: HELP_VIDEO_AUDIENCES, default: 'all' })
  audience: HelpVideoAudience;

  /** A YouTube Short: the app plays it tall (9:16) instead of 16:9. */
  @Prop({ default: false })
  isShort: boolean;

  /** Position within its screen; lower first. */
  @Prop({ default: 0 })
  order: number;

  @Prop({ default: true })
  active: boolean;
}

export const HelpVideoSchema = SchemaFactory.createForClass(HelpVideo);

HelpVideoSchema.index({ active: 1, screen: 1, language: 1, order: 1 });
