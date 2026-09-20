import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppVersionPolicyDocument = HydratedDocument<AppVersionPolicy>;

/**
 * One row per platform, and that separation is not cosmetic.
 *
 * Apple and Google approve on their own schedules, and a Play staged rollout
 * deliberately withholds the new build from most users. A single shared
 * number would hard-block everyone on the platform that has not shipped yet —
 * users who cannot update even if they want to.
 */
@Schema({ timestamps: true })
export class AppVersionPolicy {
  @Prop({ required: true, unique: true, enum: ['ios', 'android'] })
  platform: 'ios' | 'android';

  /** Below this the app refuses to run. Never set above what the store has. */
  @Prop({ required: true, default: '1.0.0', trim: true })
  minimumVersion: string;

  /** Newest available. Below this the app nudges, but keeps working. */
  @Prop({ required: true, default: '1.0.0', trim: true })
  latestVersion: string;

  /** Optional line shown on the update screen, e.g. why it is required. */
  @Prop({ trim: true, maxlength: 300 })
  message?: string;
}

export const AppVersionPolicySchema =
  SchemaFactory.createForClass(AppVersionPolicy);
