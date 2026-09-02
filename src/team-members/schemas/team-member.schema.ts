import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TeamMemberDocument = HydratedDocument<TeamMember>;

// select:false keeps passwordHash out of normal queries, but a document
// that was just created (or explicitly .select('+passwordHash')'d for a
// login check) still holds it in memory — this transform is what actually
// guarantees it never reaches a JSON response, on every serialization path.
function stripPasswordHash(_doc: unknown, ret: Record<string, unknown>) {
  delete ret.passwordHash;
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

  @Prop({ default: true })
  active: boolean;
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);
