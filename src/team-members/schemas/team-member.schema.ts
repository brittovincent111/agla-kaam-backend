import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { isPhoneOnlyEmail } from '../../common/utils/login-phone';

export type TeamMemberDocument = HydratedDocument<TeamMember>;

// select:false keeps passwordHash out of normal queries, but a document
// that was just created (or explicitly .select('+passwordHash')'d for a
// login check) still holds it in memory — this transform is what actually
// guarantees it never reaches a JSON response, on every serialization path.
//
// It also blanks the stand-in email of a member added by phone alone, so the
// app never shows (or offers to email) an address that does not exist.
function stripPasswordHash(_doc: unknown, ret: Record<string, unknown>) {
  delete ret.passwordHash;
  delete ret.appleRefreshToken;
  if (isPhoneOnlyEmail(ret.email as string | undefined)) ret.email = '';
  return ret;
}

@Schema({
  timestamps: true,
  toJSON: { transform: stripPasswordHash },
  toObject: { transform: stripPasswordHash },
})
export class TeamMember {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // Globally unique, not just per-business — an email logs in as exactly
  // one identity (owner of their own business, or technician of someone
  // else's), never both. This is the technician's login credential.
  @Prop({
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true,
  })
  email: string;

  // select:false so it's never returned by a normal query — AuthService
  // explicitly selects it to check a login attempt.
  @Prop({ required: true, select: false })
  passwordHash: string;

  // "Forgot password" for a technician, same as for an owner: a hashed
  // 6-digit code and its expiry. Lets a technician set their own password,
  // so the owner never has to send one over WhatsApp.
  @Prop({ select: false })
  passwordResetCodeHash?: string;

  @Prop({ select: false })
  passwordResetExpiresAt?: Date;

  // Wrong reset codes tried since the last code was sent.
  @Prop({ select: false, default: 0 })
  passwordResetAttempts?: number;

  // A technician is created by their owner with an email and password, but the
  // login screen offers Google/Apple alongside those fields and they will tap
  // them. Storing the provider id lets AuthService recognise the technician on
  // the next social sign-in instead of treating them as a brand-new business.
  // Sparse-unique, same pattern as Business.googleId/appleId.
  @Prop({ unique: true, sparse: true, index: true })
  googleId?: string;

  @Prop({ unique: true, sparse: true, index: true })
  appleId?: string;

  // Same as Business.appleRefreshToken — revoked at Apple when the business
  // (and with it this login) is deleted.
  @Prop({ select: false })
  appleRefreshToken?: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ trim: true })
  phone?: string;

  // The phone number as a login: digits with country code (see
  // loginPhoneDigits). Globally unique like email, and a separate field so
  // the existing email index did not have to change. Absent on members
  // added before phone login — AuthService falls back to `phone` for them.
  @Prop({ unique: true, sparse: true, index: true })
  loginPhone?: string;

  @Prop({ trim: true })
  specialty?: string;

  @Prop({ trim: true, default: 'technician' })
  role?: string;

  // This technician's own device token. Deliberately NOT stored on the
  // business: a technician authenticates with their owner's businessId, so a
  // single shared field would have each new technician login overwrite the
  // owner's token and silently stop the owner's reminders.
  @Prop({ trim: true })
  pushToken?: string;

  // This member's sign-in. One phone per member: a technician login handed
  // to a second person would dodge paying for their seat, so signing in on
  // another phone signs the first out.
  @Prop({
    type: [{ sid: String, at: Date, pushToken: String, _id: false }],
    default: [],
  })
  sessions: { sid: string; at: Date; pushToken?: string }[];
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);
