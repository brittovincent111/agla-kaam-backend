import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupplierDocument = Supplier & Document;

// The other half of the customer book: who a business BUYS from. Purchases
// used to carry supplierName/supplierPhone as loose strings on every row, so
// the same supplier was retyped for each purchase and could not be listed,
// corrected in one place, or called back.
@Schema({ timestamps: true })
export class Supplier {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ trim: true, lowercase: true, maxlength: 200 })
  email?: string;

  @Prop({ trim: true, maxlength: 200 })
  address?: string;

  @Prop({ trim: true, uppercase: true, maxlength: 15 })
  gstin?: string;

  // Same two origins the customer book records, so a supplier picked from the
  // phone's contacts can be told apart from one typed in by hand.
  @Prop({ required: true, enum: ['contacts', 'manual'], default: 'manual' })
  source: 'contacts' | 'manual';

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);

// Listing and search are always scoped to one business.
SupplierSchema.index({ businessId: 1, name: 1 });
