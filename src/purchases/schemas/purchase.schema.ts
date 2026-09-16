import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PurchaseDocument = HydratedDocument<Purchase>;

@Schema({ _id: false })
export class PurchaseItem {
  @Prop({ type: Types.ObjectId, ref: 'InventoryItem', required: false })
  itemId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // Copied from the inventory item at add time. A document is a historical
  // record — re-reading the code from inventory later would silently rewrite
  // an invoice that has already been sent.
  @Prop({ trim: true, uppercase: true, maxlength: 20 })
  hsnCode?: string;

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

  // Links to the supplier book. Optional, and the name/phone below stay
  // denormalised alongside it: a supplier can be renamed or deleted later,
  // and a logged purchase must keep showing who it was actually with.
  @Prop({ type: Types.ObjectId, ref: 'Supplier', index: true })
  supplierId?: Types.ObjectId;

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

  // What has actually been handed over, and what is still owed. paymentStatus
  // alone could say "partially_paid" without saying how much, so a business
  // could see that it owed a supplier something but never how much.
  //
  // Both default to a settled purchase so rows written before these existed
  // (paymentStatus 'paid') do not suddenly read as fully outstanding; create()
  // and recordPayment() set them explicitly from then on.
  @Prop({ required: true, min: 0, default: 0 })
  amountPaid: number;

  @Prop({ required: true, min: 0, default: 0 })
  balanceDue: number;

  @Prop({ trim: true })
  notes?: string;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
PurchaseSchema.index({ businessId: 1, purchaseDate: -1 });

