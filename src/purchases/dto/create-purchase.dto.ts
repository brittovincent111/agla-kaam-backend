import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  MaxLength,
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

  // Copied from the inventory item, same as the sales documents — the PO PDF
  // prints it when purchaseShowHsn is on.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  costPrice: number;

  // The rest are only used when this line creates a new stock item.
  // Sale price omitted: the same as the cost.
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStockAlert?: number;
}

export class CreatePurchaseDto {
  @IsString()
  supplierName: string;

  @IsOptional()
  @IsMongoId()
  supplierId?: string;

  // Optional: omit it and the amount is inferred from paymentStatus (paid in
  // full, or nothing). Supply it for a part payment at the counter.
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;

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
  paymentMethod?:
    'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'credit' | 'other';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
