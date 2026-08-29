import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TeamMemberDocument = HydratedDocument<TeamMember>;

@Schema({ timestamps: true })
export class TeamMember {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // Globally unique, not just per-business — a phone number logs in as
  // exactly one identity (owner of their own business, or technician of
  // someone else's), never both.
  @Prop({ required: true, unique: true, index: true })
  phone: string;

  @Prop({ default: true })
  active: boolean;
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);
