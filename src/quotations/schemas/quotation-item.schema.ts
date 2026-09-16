import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: true })
export class QuotationItem {
  // Set only when this line was added "from logged services" — lets the
  // quotation reference the work without duplicating the service record.
  @Prop({ type: Types.ObjectId, ref: 'Service' })
  serviceId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, maxlength: 300 })
  description?: string;

  // Copied from the inventory item at add time, so a quotation keeps the
  // code it was issued with even if inventory changes later.
  @Prop({ trim: true, uppercase: true, maxlength: 20 })
  hsnCode?: string;

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

export const QuotationItemSchema = SchemaFactory.createForClass(QuotationItem);
