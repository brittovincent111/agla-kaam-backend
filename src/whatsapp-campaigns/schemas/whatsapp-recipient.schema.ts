import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsappRecipientDocument = HydratedDocument<WhatsappRecipient>;

export const WHATSAPP_RECIPIENT_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED',
  'OPTED_OUT',
] as const;
export type WhatsappRecipientStatus = (typeof WHATSAPP_RECIPIENT_STATUSES)[number];

/** One lead in a WhatsApp campaign, and what happened to their message. */
@Schema({ timestamps: true })
export class WhatsappRecipient {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  campaignId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  leadId: Types.ObjectId;

  // Digits with country code, no "+": what the Cloud API takes.
  @Prop({ required: true, index: true })
  phone: string;

  @Prop() businessName?: string;

  // The variable values sent, in order — kept so a failure can be explained.
  @Prop({ type: [String], default: [] })
  params: string[];

  @Prop({ enum: WHATSAPP_RECIPIENT_STATUSES, default: 'QUEUED', index: true })
  status: WhatsappRecipientStatus;

  // Meta's message id (wamid), which status webhooks refer to.
  @Prop({ index: true, sparse: true })
  waMessageId?: string;

  @Prop() sentAt?: Date;
  @Prop() deliveredAt?: Date;
  @Prop() readAt?: Date;
  @Prop() failedAt?: Date;
  @Prop() failureReason?: string;
  @Prop() errorCode?: number;

  @Prop() repliedAt?: Date;
  @Prop() replyText?: string;

  @Prop() lockedAt?: Date;
  @Prop({ default: 0 }) retryCount: number;
}

export const WhatsappRecipientSchema = SchemaFactory.createForClass(WhatsappRecipient);
// One message per number per campaign, even if two leads share a phone.
WhatsappRecipientSchema.index({ campaignId: 1, phone: 1 }, { unique: true });
