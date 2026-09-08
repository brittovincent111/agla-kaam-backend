import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { INVOICE_STATUSES, InvoiceStatus } from '../../common/constants/invoice-options';
import { InvoiceItem, InvoiceItemSchema } from './invoice-item.schema';

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  invoiceNumber: string;

  @Prop({ required: true })
  invoiceDate: Date;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({ required: true, enum: INVOICE_STATUSES, default: 'draft', index: true })
  status: InvoiceStatus;

  @Prop({ required: true, default: 'INR', uppercase: true, trim: true })
  currency: string;

  @Prop({ required: true, default: 'gst', enum: ['gst', 'vat', 'sales_tax', 'none'] })
  taxType: string;

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

  @Prop({ required: true, min: 0, default: 0 })
  amountPaid: number;

  @Prop({ required: true, min: 0, default: 0 })
  balanceDue: number;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;

  @Prop({ trim: true, maxlength: 60 })
  paymentTerms?: string;

  // Distinct from `notes` — longer-form legal/policy text (warranty,
  // cancellation, late-payment terms). Defaults from
  // Business.defaultInvoiceTerms when a new invoice is created.
  @Prop({ trim: true, maxlength: 2000 })
  termsAndConditions?: string;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ businessId: 1, invoiceNumber: 1 }, { unique: true });
InvoiceSchema.index({ businessId: 1, dueDate: 1 });
