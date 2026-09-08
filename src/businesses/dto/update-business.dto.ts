import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { KNOWN_COUNTRY_CODES } from '../../common/utils/geo-defaults';

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

  // Drives subscription pricing (see SubscriptionsService.createOrder) —
  // restricted to the countries pricing actually exists for, rather than any
  // 2-character string, since an unrecognized code would otherwise silently
  // resolve to the cheapest (India) price.
  @IsOptional()
  @IsString()
  @IsIn(KNOWN_COUNTRY_CODES)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @IsOptional()
  @IsString()
  @IsIn(['gst', 'vat', 'sales_tax', 'none'])
  taxType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxRegistrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultInvoiceTerms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultQuotationTerms?: string;

  // Payment instructions printed on invoices — see Business schema.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentUpiId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentBankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentAccountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentAccountCode?: string;

  @IsOptional()
  @IsBoolean()
  acceptsCash?: boolean;

  @IsOptional()
  @IsBoolean()
  showPaymentDetailsOnInvoice?: boolean;
}
