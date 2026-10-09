import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type QuickNoteDocument = HydratedDocument<QuickNote>;

@Schema({ timestamps: true })
export class QuickNote {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: string;

  @Prop({ type: String, default: null, index: true })
  userId: string | null;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  title: string;

  @Prop({ type: Date, default: null })
  reminderAt: Date | null;

  @Prop({ type: Boolean, default: false, index: true })
  completed: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  pinned: boolean;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const QuickNoteSchema = SchemaFactory.createForClass(QuickNote);

QuickNoteSchema.index({ businessId: 1, pinned: -1, completed: 1, createdAt: -1 });
QuickNoteSchema.index({ businessId: 1, reminderAt: 1, completed: 1 });
