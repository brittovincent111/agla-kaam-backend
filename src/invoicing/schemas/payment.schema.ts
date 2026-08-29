import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PAYMENT_METHODS, PaymentMethod } from '../../common/constants/invoice-options';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invoice', required: true, index: true })
  invoiceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, enum: PAYMENT_METHODS })
  paymentMethod: PaymentMethod;

  @Prop({ required: true })
  paymentDate: Date;

  @Prop({ trim: true, maxlength: 100 })
  reference?: string;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
