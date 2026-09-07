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

  // Presence of a GSTIN is what turns on GST-style tax display (CGST/SGST
  // split) on invoices — there's no separate "GST enabled" toggle.
  @Prop({ trim: true, uppercase: true })
  gstin?: string;

  // Shared by invoice and quotation PDFs. Set only via
  // DocumentTemplatesController (not the general profile PATCH), which
  // enforces the subscription-tier gate before persisting it.
  @Prop({ enum: DOCUMENT_TEMPLATE_IDS, default: DEFAULT_DOCUMENT_TEMPLATE_ID })
  invoiceTemplateId: DocumentTemplateId;

  // Prefills Invoice/Quotation.termsAndConditions when a new one is
  // created — same "default that can be overridden per-document" pattern
  // as ServicePreset.messageTemplate.
  @Prop({ trim: true, maxlength: 2000 })
  defaultInvoiceTerms?: string;

  @Prop({ trim: true, maxlength: 2000 })
  defaultQuotationTerms?: string;

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
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
