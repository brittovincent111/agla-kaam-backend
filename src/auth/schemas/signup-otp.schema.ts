import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SignupOtpDocument = HydratedDocument<SignupOtp>;

@Schema({ timestamps: true })
export class SignupOtp {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ required: true })
  codeHash: string;

  @Prop({ required: true, expires: '15m' })
  expiresAt: Date;

  // Wrong codes tried; the code is deleted at MAX_CODE_ATTEMPTS.
  @Prop({ default: 0 })
  attempts: number;
}

export const SignupOtpSchema = SchemaFactory.createForClass(SignupOtp);
