import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ServicePresetDocument = HydratedDocument<ServicePreset>;

@Schema({ timestamps: true })
export class ServicePreset {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // Custom WhatsApp reminder wording for this service type. Falls back to
  // DEFAULT_REMINDER_TEMPLATE when unset.
  @Prop({ trim: true })
  messageTemplate?: string;
}

export const ServicePresetSchema = SchemaFactory.createForClass(ServicePreset);
