import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ServicePresetDocument = HydratedDocument<ServicePreset>;

// A service type the business offers, and everything the app can fill in
// from it: the reminder wording, and — new — the job's usual warranty, when
// it comes round again, and what it is usually billed at. Every default is
// optional; unset means "ask", exactly as before.
@Schema({ timestamps: true })
export class ServicePreset {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // Names this type was known by before a rename. Services are matched to
  // their type by name (the name is what was typed or picked when the job was
  // logged), so a rename must keep answering to the old one — otherwise every
  // service logged before it lost its custom reminder.
  @Prop({ type: [String], default: [] })
  previousNames: string[];

  // Custom WhatsApp reminder wording for this service type. Falls back to the
  // business's own reminder, then the standard one, when unset.
  @Prop({ trim: true })
  messageTemplate?: string;

  // Pre-selected in Log Service when this type is picked.
  @Prop()
  warrantyPeriod?: string;

  @Prop()
  nextServiceInterval?: string;

  // The line an invoice / quotation / proforma starts from when billing a
  // logged service of this type, instead of a rate of 0.
  @Prop({ min: 0 })
  defaultPrice?: number;

  @Prop({ min: 0, max: 100 })
  taxRate?: number;

  @Prop({ trim: true, uppercase: true })
  hsnCode?: string;
}

export const ServicePresetSchema = SchemaFactory.createForClass(ServicePreset);
