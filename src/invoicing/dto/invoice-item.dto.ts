import {
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class InvoiceItemDto {
  @IsOptional()
  @IsMongoId()
  serviceId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  // HSN/SAC code, carried on the line rather than looked up at render time:
  // the inventory item can be renamed or deleted later, and a document must
  // keep printing the code it was issued with.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}
