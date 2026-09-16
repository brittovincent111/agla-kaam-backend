import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  googleReviewUrl?: string;

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
  serviceCardTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  paymentReminderTemplate?: string;

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
  @MaxLength(500)
  paymentQrContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bankDetails?: string;

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
  showPaymentDetailsOnInvoice?: boolean;

  // Invoice Settings
  @IsOptional()
  @IsString()
  @MaxLength(20)
  invoicePrefix?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  invoiceNextSerial?: number;

  @IsOptional()
  @IsBoolean()
  invoiceShowDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowTax?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowHsn?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  invoiceTopMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  invoiceBottomMessage?: string;

  @IsOptional()
  @IsBoolean()
  invoiceShowBankInfo?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowUpiInfo?: boolean;

  // Quotation Settings
  @IsOptional()
  @IsString()
  @MaxLength(20)
  quotationPrefix?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quotationNextSerial?: number;

  @IsOptional()
  @IsBoolean()
  quotationShowTax?: boolean;

  @IsOptional()
  @IsBoolean()
  quotationShowHsn?: boolean;

  @IsOptional()
  @IsBoolean()
  quotationShowShippingAddress?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  quotationTopMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  quotationBottomMessage?: string;

  @IsOptional()
  @IsBoolean()
  quotationShowBankInfo?: boolean;

  @IsOptional()
  @IsBoolean()
  quotationShowUpiInfo?: boolean;

  @IsOptional()
  @IsBoolean()
  quotationShowSignature?: boolean;

  // Purchase Order / Purchase Settings
  @IsOptional()
  @IsString()
  @MaxLength(20)
  purchasePrefix?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  purchaseNextSerial?: number;

  @IsOptional()
  @IsBoolean()
  purchaseShowDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  purchaseShowTax?: boolean;

  @IsOptional()
  @IsBoolean()
  purchaseShowHsn?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  purchaseTopMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  purchaseBottomMessage?: string;

  @IsOptional()
  @IsBoolean()
  purchaseShowBankInfo?: boolean;

  // Proforma Invoice Settings
  @IsOptional()
  @IsString()
  @MaxLength(20)
  proformaPrefix?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  proformaNextSerial?: number;

  @IsOptional()
  @IsBoolean()
  proformaShowDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  proformaShowTax?: boolean;

  @IsOptional()
  @IsBoolean()
  proformaShowHsn?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proformaTopMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proformaBottomMessage?: string;

  @IsOptional()
  @IsBoolean()
  proformaShowBankInfo?: boolean;

  @IsOptional()
  @IsBoolean()
  proformaShowUpiInfo?: boolean;

  // Product Settings
  @IsOptional()
  @IsBoolean()
  enableTaxInclusivePrice?: boolean;
}

