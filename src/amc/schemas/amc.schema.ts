import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AmcDocument = HydratedDocument<Amc>;

export type AmcStatus = 'active' | 'completed' | 'expired' | 'cancelled';

@Schema({ _id: false })
export class AmcVisitSchedule {
  @Prop({ required: true })
  visitNumber: number;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({ type: Types.ObjectId, ref: 'Service' })
  serviceId?: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['pending', 'completed', 'skipped'],
    default: 'pending',
  })
  status: 'pending' | 'completed' | 'skipped';

  @Prop()
  completedAt?: Date;
}

const AmcVisitScheduleSchema = SchemaFactory.createForClass(AmcVisitSchedule);

@Schema({ timestamps: true })
export class Amc {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  contractNumber: string;

  @Prop({ trim: true })
  planName?: string;

  @Prop({ required: true, trim: true })
  serviceType: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, min: 1, default: 4 })
  totalVisits: number;

  @Prop({ required: true, min: 0, default: 0 })
  completedVisits: number;

  @Prop({ min: 0, default: 0 })
  contractValue: number;

  @Prop({
    required: true,
    enum: ['active', 'completed', 'expired', 'cancelled'],
    default: 'active',
    index: true,
  })
  status: AmcStatus;

  @Prop({ type: [AmcVisitScheduleSchema], default: [] })
  visitSchedule: AmcVisitSchedule[];

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}

export const AmcSchema = SchemaFactory.createForClass(Amc);
AmcSchema.index({ businessId: 1, contractNumber: 1 }, { unique: true });
AmcSchema.index({ businessId: 1, customerId: 1 });
