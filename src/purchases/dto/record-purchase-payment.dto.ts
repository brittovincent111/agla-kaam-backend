import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PURCHASE_PAYMENT_METHODS, type PurchasePaymentMethod } from '../schemas/purchase.schema';

export class RecordPurchasePaymentDto {
  // The amount handed over now, not the running total — see
  // PurchasesService.recordPayment for why this is additive.
  @IsNumber()
  @Min(0.01)
  amount: number;

  // How it was paid. Omitted (older apps): cash.
  @IsOptional()
  @IsIn(PURCHASE_PAYMENT_METHODS)
  method?: PurchasePaymentMethod;

  // When it was paid. Omitted: now.
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
