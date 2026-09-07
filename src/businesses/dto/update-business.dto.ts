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

  // Collected at onboarding when the account has none — a Google/Apple sign-up
  // never supplies one, and business.phone is what the web checkout looks an
  // account up by, and what prints as the contact line on every invoice and
  // quotation PDF. Unique (sparse) on the schema, so update() maps a duplicate
  // to a 409 rather than letting the index throw.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

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
