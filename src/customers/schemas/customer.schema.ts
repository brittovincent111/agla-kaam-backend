import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ServiceLocation, ServiceLocationSchema } from '../../services/schemas/service.schema';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({ timestamps: true })
export class Customer {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ trim: true, maxlength: 200 })
  address?: string;

  @Prop({ required: true, enum: ['contacts', 'manual'], default: 'manual' })
  source: 'contacts' | 'manual';

  // Which technician this customer is assigned to. A technician only sees
  // and can log services for customers assigned to them — unassigned
  // customers are owner-only until assigned. Set by the owner.
  @Prop({ type: Types.ObjectId, ref: 'TeamMember', index: true })
  assignedTechnicianId?: Types.ObjectId;

  // Cached from the most recent service's captured location so the next
  // technician visit can reuse it instead of capturing GPS again.
  @Prop({ type: ServiceLocationSchema })
  defaultLocation?: ServiceLocation;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
