import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AppFeedbackDocument = HydratedDocument<AppFeedback>;

@Schema({ timestamps: true })
export class AppFeedback {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;
}

export const AppFeedbackSchema = SchemaFactory.createForClass(AppFeedback);
