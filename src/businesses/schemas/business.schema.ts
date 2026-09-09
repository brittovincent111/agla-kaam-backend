import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  DOCUMENT_TEMPLATE_IDS,
  DocumentTemplateId,
} from '../../common/pdf/document-templates';

export type BusinessDocument = HydratedDocument<Business>;

export type SubscriptionStatus = 'free' | 'active' | 'expired';

// select:false keeps passwordHash out of normal queries, but a document
// that was just created (or explicitly .select('+passwordHash')'d for a
// login check) still holds it in memory — this transform is what actually
// guarantees it never reaches a JSON response, on every serialization path.
function stripPasswordHash(_doc: unknown, ret: Record<string, unknown>) {
  delete ret.passwordHash;
  delete ret.passwordResetCodeHash;
  delete ret.passwordResetExpiresAt;
  return ret;
}

@Schema({
  timestamps: true,
  toJSON: { transform: stripPasswordHash },
  toObject: { transform: stripPasswordHash },
})
export class Business {
  @Prop({ required: true, trim: true, default: 'My Business' })
  name: string;

  @Prop({ trim: true })
  tradeType?: string;

  // Optional now: an account created via email/Google may never set a phone.
  // sparse so any number of accounts can each lack the field without
  // colliding on the unique index.
  @Prop({ unique: true, sparse: true, index: true })
  phone?: string;

  @Prop({
    required: true,
    default: 'free',
    enum: ['free', 'active', 'expired'],
  })
  subscriptionStatus: SubscriptionStatus;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ trim: true })
  address?: string;

  // Doubles as the email+password login identifier — see AuthService.
  @Prop({
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true,
    index: true,
  })
  email?: string;

  // Only set for email/password accounts. select:false so it's never
  // returned by a normal query — AuthService explicitly selects it to check
  // a login attempt.
  @Prop({ select: false })
  passwordHash?: string;

  // A 6-digit code, hashed the same way as passwordHash — set by
  // forgotPassword(), consumed (and cleared) by resetPassword(). Both
  // select:false for the same reason passwordHash is.
  @Prop({ select: false })
  passwordResetCodeHash?: string;

  @Prop({ select: false })
  passwordResetExpiresAt?: Date;

  // Google's stable per-user subject id ('sub' claim on the verified ID
  // token) — set only for accounts that have signed in with Google.
  @Prop({ unique: true, sparse: true, index: true })
  googleId?: string;

  // Apple's stable per-user subject id ('sub' claim on the verified
  // identity token) — set only for accounts that have signed in with
  // Apple. Same sparse-unique pattern as googleId.
  @Prop({ unique: true, sparse: true, index: true })
  appleId?: string;

  @Prop({ required: true, default: 'IN', uppercase: true, trim: true })
  country: string;

  @Prop({ required: true, default: 'INR', uppercase: true, trim: true })
  currency: string;

  @Prop({ required: true, default: 'Asia/Kolkata', trim: true })
  timezone: string;

  @Prop({ required: true, default: 'gst', enum: ['gst', 'vat', 'sales_tax', 'none'] })
  taxType: string;

  @Prop({ trim: true, uppercase: true })
  taxRegistrationNumber?: string;

  // Legacy field for Indian GSTIN compatibility
  @Prop({ trim: true, uppercase: true })
  gstin?: string;

  // Shared by invoice and quotation PDFs. Set only via
  // DocumentTemplatesController (not the general profile PATCH), which
  // enforces the subscription-tier gate before persisting it.
  @Prop({ enum: DOCUMENT_TEMPLATE_IDS, default: DEFAULT_DOCUMENT_TEMPLATE_ID })
  invoiceTemplateId: DocumentTemplateId;

  // The business's chosen document accent, as '#RRGGBB'. Independent of
  // invoiceTemplateId: any accent works with any layout, because the whole
  // document palette is derived from it (see common/pdf/document-colors.ts).
  // Unset means "use the chosen layout's own default accent". Set only via
  // DocumentTemplatesController, which enforces the same tier gate as the
  // template choice.
  @Prop({ trim: true, uppercase: true })
  documentAccentColor?: string;

  // Prefills Invoice/Quotation.termsAndConditions when a new one is
  // created — same "default that can be overridden per-document" pattern
  // as ServicePreset.messageTemplate.
  @Prop({ trim: true, maxlength: 2000 })
  defaultInvoiceTerms?: string;

  @Prop({ trim: true, maxlength: 2000 })
  defaultQuotationTerms?: string;

  // How a customer is meant to pay. Printed as the "Payment Information"
  // block on invoice PDFs — every field optional, and the block is omitted
  // entirely when none are set rather than printing an empty heading.
  // Deliberately generic enough for every supported country: UPI is
  // India-only, but bank name + account + code covers IFSC (IN), IBAN (Gulf)
  // and routing numbers alike, labelled per country at render time.
  @Prop({ trim: true, maxlength: 100 })
  paymentUpiId?: string;

  @Prop({ trim: true, maxlength: 500 })
  paymentQrContent?: string;

  @Prop({ trim: true, maxlength: 1000 })
  bankDetails?: string;

  @Prop({ trim: true, maxlength: 100 })
  paymentBankName?: string;

  @Prop({ trim: true, maxlength: 40 })
  paymentAccountNumber?: string;

  @Prop({ trim: true, maxlength: 40 })
  paymentAccountCode?: string;

  @Prop({ default: false })
  acceptsCash: boolean;

  // Master switch for the "Payment Information" block on invoice PDFs.
  // Separate from whether any details are filled in: a business may want to
  // keep its bank details on file but leave them off a particular run of
  // invoices (cash-only jobs, a customer who always pays by card) without
  // deleting and re-typing them. Defaults on, so a business that fills the
  // fields in sees them without hunting for a switch.
  @Prop({ default: true })
  showPaymentDetailsOnInvoice: boolean;

  @Prop({ trim: true })
  pushToken?: string;

  // S3 object key holding the actual image bytes (bucket: S3_BUCKET env) —
  // select:false so a normal /businesses/me fetch never needs these; the
  // dedicated /businesses/me/logo endpoint looks them up to stream from S3.
  @Prop({ select: false })
  logoKey?: string;

  @Prop({ select: false })
  logoContentType?: string;

  @Prop({ select: false })
  signatureKey?: string;

  @Prop({ select: false })
  signatureContentType?: string;

  // Kept in sync with logoKey/signatureKey so the mobile app can tell
  // whether one is set (and build the /businesses/me/logo image URL)
  // without the normal /businesses/me fetch having to resolve S3 state.
  @Prop({ default: false })
  hasLogo: boolean;

  @Prop({ default: false })
  hasSignature: boolean;

  // --- Document Customization & Serial Settings ---
  @Prop({ trim: true, default: 'INV-' })
  invoicePrefix?: string;

  @Prop({ default: 1 })
  invoiceNextSerial?: number;

  @Prop({ default: true })
  invoiceShowDiscount?: boolean;

  @Prop({ default: true })
  invoiceShowTax?: boolean;

  @Prop({ default: true })
  invoiceShowHsn?: boolean;

  @Prop({ trim: true })
  invoiceTopMessage?: string;

  @Prop({ trim: true })
  invoiceBottomMessage?: string;

  @Prop({ default: true })
  invoiceShowBankInfo?: boolean;

  @Prop({ default: true })
  invoiceShowUpiInfo?: boolean;

  // Quotation Settings
  @Prop({ trim: true, default: 'QT-' })
  quotationPrefix?: string;

  @Prop({ default: 1 })
  quotationNextSerial?: number;

  @Prop({ default: true })
  quotationShowTax?: boolean;

  @Prop({ default: true })
  quotationShowHsn?: boolean;

  @Prop({ default: false })
  quotationShowShippingAddress?: boolean;

  @Prop({ trim: true, default: 'Dear Sir/Mam,\nThank you for your valuable inquiry. We are pleased to quote as below:' })
  quotationTopMessage?: string;

  @Prop({ trim: true, default: 'We hope you find our offer to be in line with your requirement.' })
  quotationBottomMessage?: string;

  @Prop({ default: true })
  quotationShowBankInfo?: boolean;

  @Prop({ default: true })
  quotationShowUpiInfo?: boolean;

  @Prop({ default: true })
  quotationShowSignature?: boolean;

  // PO / Purchase Settings
  @Prop({ trim: true, default: 'PO-' })
  purchasePrefix?: string;

  @Prop({ default: 1 })
  purchaseNextSerial?: number;

  @Prop({ default: true })
  purchaseShowDiscount?: boolean;

  @Prop({ default: true })
  purchaseShowTax?: boolean;

  @Prop({ default: true })
  purchaseShowHsn?: boolean;

  @Prop({ trim: true, default: 'Dear Sir/Mam,\nWe are pleased to submit the purchase order as below.' })
  purchaseTopMessage?: string;

  @Prop({ trim: true, default: 'Your prompt attention to this order is greatly appreciated, and we look forward to a successful transaction.' })
  purchaseBottomMessage?: string;

  @Prop({ default: true })
  purchaseShowBankInfo?: boolean;

  // Proforma Invoice Settings
  @Prop({ trim: true, default: 'PI-' })
  proformaPrefix?: string;

  @Prop({ default: 1 })
  proformaNextSerial?: number;

  @Prop({ default: true })
  proformaShowDiscount?: boolean;

  @Prop({ default: true })
  proformaShowTax?: boolean;

  @Prop({ default: true })
  proformaShowHsn?: boolean;

  @Prop({ trim: true })
  proformaTopMessage?: string;

  @Prop({ trim: true })
  proformaBottomMessage?: string;

  @Prop({ default: true })
  proformaShowBankInfo?: boolean;

  @Prop({ default: true })
  proformaShowUpiInfo?: boolean;

  // Product / Catalog Pricing Settings
  @Prop({ default: false })
  enableTaxInclusivePrice?: boolean;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
