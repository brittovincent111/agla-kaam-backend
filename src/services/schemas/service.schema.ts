import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  NEXT_SERVICE_INTERVALS,
  WARRANTY_PERIODS,
} from '../../common/constants/service-options';

export type ServiceDocument = HydratedDocument<Service>;

@Schema({ _id: false })
export class ServiceLocation {
  @Prop({ required: true })
  latitude: number;

  @Prop({ required: true })
  longitude: number;

  @Prop({ required: true })
  capturedAt: Date;
}

export const ServiceLocationSchema = SchemaFactory.createForClass(ServiceLocation);

@Schema({ timestamps: true })
export class Service {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  serviceType: string;

  @Prop({
    required: true,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'completed' | 'cancelled';

  @Prop({ required: true })
  serviceDate: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  revisitDate?: Date;

  @Prop({ required: true, enum: WARRANTY_PERIODS, default: 'none' })
  warrantyPeriod: string;

  @Prop()
  warrantyExpiry?: Date | null;

  @Prop({ required: true, enum: NEXT_SERVICE_INTERVALS, default: '6m' })
  nextServiceInterval: string;

  @Prop({ required: true, index: true })
  nextServiceDate: Date;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;

  // Captured optionally by whoever marks the service done — most useful
  // coming from a technician's phone out in the field.
  @Prop({ type: ServiceLocationSchema })
  location?: ServiceLocation;

  // Absent means "use the customer's default assigned technician." Set two
  // ways: the owner picks someone ahead of time to override the default for
  // just this one visit (e.g. the usual technician is unavailable), or a
  // technician logging their own visit is stamped here automatically as the
  // attribution record of who actually did it.
  @Prop({ type: Types.ObjectId, ref: 'TeamMember', index: true })
  assignedTechnicianId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Amc', index: true })
  amcId?: Types.ObjectId;

  @Prop({ select: false })
  beforePhotoKey?: string;

  @Prop({ select: false })
  beforePhotoContentType?: string;

  @Prop({ default: false })
  hasBeforePhoto: boolean;

  @Prop({ select: false })
  afterPhotoKey?: string;

  @Prop({ select: false })
  afterPhotoContentType?: string;

  @Prop({ default: false })
  hasAfterPhoto: boolean;

  @Prop({ select: false })
  signatureKey?: string;

  @Prop({ select: false })
  signatureContentType?: string;

  @Prop({ default: false })
  hasSignature: boolean;

  @Prop()
  signedAt?: Date;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);
ServiceSchema.index({ businessId: 1, nextServiceDate: 1 });
