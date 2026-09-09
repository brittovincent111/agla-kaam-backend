import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseItemDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsString()
  name: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  costPrice: number;
}

export class CreatePurchaseDto {
  @IsString()
  supplierName: string;

  @IsOptional()
  @IsString()
  supplierPhone?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceNumber?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(['paid', 'unpaid', 'partially_paid'])
  paymentStatus?: 'paid' | 'unpaid' | 'partially_paid';

  @IsOptional()
  @IsEnum(['cash', 'bank_transfer', 'upi', 'cheque', 'credit', 'other'])
  paymentMethod?: 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'credit' | 'other';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

