import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PurchaseDocument = HydratedDocument<Purchase>;

@Schema({ _id: false })
export class PurchaseItem {
  @Prop({ type: Types.ObjectId, ref: 'InventoryItem', required: false })
  itemId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, min: 0 })
  costPrice: number;

  @Prop({ required: true, min: 0 })
  amount: number;
}

export const PurchaseItemSchema = SchemaFactory.createForClass(PurchaseItem);

@Schema({ timestamps: true })
export class Purchase {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  purchaseNumber: string;

  @Prop({ required: true, trim: true })
  supplierName: string;

  @Prop({ trim: true })
  supplierPhone?: string;

  @Prop({ trim: true })
  supplierInvoiceNumber?: string;

  @Prop({ required: true, default: Date.now })
  purchaseDate: Date;

  @Prop({ required: true, default: 'INR', uppercase: true, trim: true })
  currency: string;

  @Prop({ required: true, default: 'paid', enum: ['paid', 'unpaid', 'partially_paid'] })
  paymentStatus: string;

  @Prop({ required: true, default: 'cash', enum: ['cash', 'bank_transfer', 'upi', 'cheque', 'credit', 'other'] })
  paymentMethod: string;

  @Prop({ type: [PurchaseItemSchema], required: true })
  items: PurchaseItem[];

  @Prop({ required: true, min: 0 })
  totalAmount: number;

  @Prop({ trim: true })
  notes?: string;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
PurchaseSchema.index({ businessId: 1, purchaseDate: -1 });

