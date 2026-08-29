import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { PAYMENT_METHODS } from '../../common/constants/invoice-options';

export class RecordPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(PAYMENT_METHODS)
  paymentMethod: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
