import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsappMessageDocument = HydratedDocument<WhatsappMessage>;

/**
 * Every message in or out on the business number that is not a campaign
 * send itself: replies from leads, and the admin's answers to them. The
 * admin inbox reads this.
 */
@Schema({ timestamps: true })
export class WhatsappMessage {
  @Prop({ enum: ['in', 'out'], required: true, index: true })
  direction: 'in' | 'out';

  // The other side's number, digits with country code.
  @Prop({ required: true, index: true })
  phone: string;

  @Prop() contactName?: string;

  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  campaignId?: Types.ObjectId;

  // text | button | interactive | image | …
  @Prop() type?: string;

  @Prop() text?: string;

  @Prop({ index: true, sparse: true })
  waMessageId?: string;

  @Prop({ default: Date.now, index: true })
  at: Date;

  // Admin has seen it (the inbox shows unread first).
  @Prop({ default: false })
  handled: boolean;

  @Prop() sentBy?: string;
}

export const WhatsappMessageSchema = SchemaFactory.createForClass(WhatsappMessage);
