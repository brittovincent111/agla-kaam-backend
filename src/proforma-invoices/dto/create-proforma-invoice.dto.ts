import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProformaItemDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class CreateProformaInvoiceDto {
  @IsString()
  customerId: string;

  @IsDateString()
  proformaDate: string;

  @IsDateString()
  validUntil: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaItemDto)
  items: ProformaItemDto[];
}
