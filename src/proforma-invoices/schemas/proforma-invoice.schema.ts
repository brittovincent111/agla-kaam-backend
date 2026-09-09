import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { InvoiceItem, InvoiceItemSchema } from '../../invoicing/schemas/invoice-item.schema';

export type ProformaInvoiceDocument = HydratedDocument<ProformaInvoice>;
export type ProformaStatus = 'draft' | 'sent' | 'converted' | 'cancelled';

@Schema({ timestamps: true })
export class ProformaInvoice {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  proformaNumber: string;

  @Prop({ required: true, default: Date.now })
  proformaDate: Date;

  @Prop({ required: true })
  validUntil: Date;

  @Prop({ required: true, enum: ['draft', 'sent', 'converted', 'cancelled'], default: 'draft', index: true })
  status: ProformaStatus;

  @Prop({ required: true, default: 'INR', uppercase: true, trim: true })
  currency: string;

  @Prop({ type: [InvoiceItemSchema], default: [] })
  items: InvoiceItem[];

  @Prop({ required: true, min: 0, default: 0 })
  subtotal: number;

  @Prop({ required: true, min: 0, default: 0 })
  discount: number;

  @Prop({ required: true, min: 0, default: 0 })
  taxTotal: number;

  @Prop({ required: true, min: 0, default: 0 })
  total: number;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;

  @Prop({ trim: true, maxlength: 60 })
  paymentTerms?: string;

  @Prop({ trim: true, maxlength: 2000 })
  termsAndConditions?: string;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  convertedInvoiceId?: Types.ObjectId;

  @Prop()
  convertedAt?: Date;
}

export const ProformaInvoiceSchema = SchemaFactory.createForClass(ProformaInvoice);
ProformaInvoiceSchema.index({ businessId: 1, proformaNumber: 1 }, { unique: true });
ProformaInvoiceSchema.index({ businessId: 1, createdAt: -1 });
