import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tradeType?: string;

  @IsOptional()
  @IsString()
  @IsIn(['en', 'hi'])
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultInvoiceTerms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultQuotationTerms?: string;
}
