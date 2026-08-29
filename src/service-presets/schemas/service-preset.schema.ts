import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ServicePresetDocument = HydratedDocument<ServicePreset>;

@Schema({ timestamps: true })
export class ServicePreset {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;
}

export const ServicePresetSchema = SchemaFactory.createForClass(ServicePreset);
