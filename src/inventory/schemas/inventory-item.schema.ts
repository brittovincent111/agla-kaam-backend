import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryItemDocument = HydratedDocument<InventoryItem>;

@Schema({ timestamps: true })
export class InventoryItem {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  sku?: string;

  @Prop({ trim: true, default: 'pcs' })
  unit: string; // e.g. pcs, kg, ltr, box, set

  @Prop({ required: true, min: 0, default: 0 })
  salePrice: number;

  @Prop({ required: true, min: 0, default: 0 })
  costPrice: number;

  @Prop({ required: true, default: 0 })
  stockQuantity: number;

  @Prop({ required: true, default: 5 })
  minStockAlert: number;

  @Prop({ trim: true })
  hsnCode?: string; // HSN or SAC code for GST/VAT classification

  @Prop({ default: false })
  isService: boolean; // if true, stock quantity tracking is bypassed
}

export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItem);
InventoryItemSchema.index({ businessId: 1, name: 1 });
