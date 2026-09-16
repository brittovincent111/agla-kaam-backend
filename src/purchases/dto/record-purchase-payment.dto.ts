import { IsNumber, Min } from 'class-validator';

export class RecordPurchasePaymentDto {
  // The amount handed over now, not the running total — see
  // PurchasesService.recordPayment for why this is additive.
  @IsNumber()
  @Min(0.01)
  amount: number;
}
