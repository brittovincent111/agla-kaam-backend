import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: true })
export class InvoiceItem {
  // Set only when this line was added "from logged services" — lets the
  // invoice reference the work without duplicating the service record.
  @Prop({ type: Types.ObjectId, ref: 'Service' })
  serviceId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, maxlength: 300 })
  description?: string;

  @Prop({ required: true, min: 0.01 })
  quantity: number;

  @Prop({ required: true, min: 0 })
  rate: number;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  taxRate: number;

  // Denormalized so line totals and PDF rendering never need to redo the
  // quantity × rate × tax math from scratch.
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, min: 0, default: 0 })
  taxAmount: number;
}

export const InvoiceItemSchema = SchemaFactory.createForClass(InvoiceItem);
