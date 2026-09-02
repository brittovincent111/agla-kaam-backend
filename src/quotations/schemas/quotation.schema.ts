import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { QUOTATION_STATUSES, QuotationStatus } from '../../common/constants/quotation-options';
import { QuotationItem, QuotationItemSchema } from './quotation-item.schema';

export type QuotationDocument = HydratedDocument<Quotation>;

@Schema({ timestamps: true })
export class Quotation {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  quotationNumber: string;

  @Prop({ required: true })
  quotationDate: Date;

  @Prop({ required: true })
  validUntil: Date;

  @Prop({ required: true, enum: QUOTATION_STATUSES, default: 'draft', index: true })
  status: QuotationStatus;

  @Prop({ type: [QuotationItemSchema], default: [] })
  items: QuotationItem[];

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

  // Distinct from `notes` — longer-form legal/policy text (validity,
  // warranty, payment terms). Defaults from Business.defaultQuotationTerms
  // when a new quotation is created.
  @Prop({ trim: true, maxlength: 2000 })
  termsAndConditions?: string;

  // Set when this quotation was converted into a real invoice.
  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  convertedInvoiceId?: Types.ObjectId;

  @Prop()
  convertedAt?: Date;
}

export const QuotationSchema = SchemaFactory.createForClass(Quotation);
QuotationSchema.index({ businessId: 1, quotationNumber: 1 }, { unique: true });
QuotationSchema.index({ businessId: 1, validUntil: 1 });
