import { ownerPushTokens, OwnerPhones } from '../common/push/owner-tokens';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from './schemas/business.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { Invoice, InvoiceDocument } from '../invoicing/schemas/invoice.schema';
import { Payment, PaymentDocument } from '../invoicing/schemas/payment.schema';
import {
  Quotation,
  QuotationDocument,
} from '../quotations/schemas/quotation.schema';
import {
  ServicePreset,
  ServicePresetDocument,
} from '../service-presets/schemas/service-preset.schema';
import {
  Purchase,
  PurchaseDocument,
} from '../purchases/schemas/purchase.schema';
import {
  ProformaInvoice,
  ProformaInvoiceDocument,
} from '../proforma-invoices/schemas/proforma-invoice.schema';
import {
  TeamMember,
  TeamMemberDocument,
} from '../team-members/schemas/team-member.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../subscriptions/schemas/subscription.schema';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../subscriptions/schemas/payment-order.schema';
import {
  AppFeedback,
  AppFeedbackDocument,
} from '../app-feedback/schemas/app-feedback.schema';
import { Amc, AmcDocument } from '../amc/schemas/amc.schema';
import {
  InventoryItem,
  InventoryItemDocument,
} from '../inventory/schemas/inventory-item.schema';
import {
  Supplier,
  SupplierDocument,
} from '../suppliers/schemas/supplier.schema';
import {
  ApplePurchase,
  ApplePurchaseDocument,
} from '../subscriptions/schemas/apple-purchase.schema';
import {
  PlayPurchase,
  PlayPurchaseDocument,
} from '../subscriptions/schemas/play-purchase.schema';
import {
  QuickNote,
  QuickNoteDocument,
} from '../quick-notes/schemas/quick-note.schema';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { DocumentTemplateId } from '../common/pdf/document-templates';
import { S3Service } from '../common/s3/s3.service';
import { AppleSignInService } from '../common/apple/apple-sign-in.service';
import {
  inferBusinessGeoDefaults,
  geoDefaultsForCountry,
} from '../common/utils/geo-defaults';
import { splitClearableUpdate } from '../common/utils/clearable-update';
import { idFilter } from '../common/utils/id-match';
import { escapeRegex } from '../common/pagination/cursor-page';

export interface BusinessWithBranding {
  name: string;
  // Printed under the business name by most layouts. It was never copied
  // into this object, so that line was blank on every real PDF.
  tradeType?: string;
  invoiceTopMessage?: string;
  quotationTopMessage?: string;
  proformaTopMessage?: string;
  purchaseTopMessage?: string;
  quotationShowShippingAddress?: boolean;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  country?: string;
  currency?: string;
  taxType?: string;
  taxRegistrationNumber?: string;
  logo?: Buffer;
  signature?: Buffer;
  // Carried through so a PDF render can resolve the document theme without a
  // second fetch of the business.
  documentAccentColor?: string;
  paymentUpiId?: string;
  paymentQrContent?: string;
  bankDetails?: string;
  paymentBankName?: string;
  paymentAccountNumber?: string;
  paymentAccountCode?: string;
  acceptsCash?: boolean;
  showPaymentDetailsOnInvoice?: boolean;
  // Per-document display settings. This interface is an explicit whitelist
  // and the PDF services read these off it — a flag missing here silently
  // arrives as undefined at render time, which reads as "show" and makes the
  // setting look like it does nothing.
  invoiceShowDiscount?: boolean;
  invoiceShowTax?: boolean;
  invoiceShowHsn?: boolean;
  invoiceShowBankInfo?: boolean;
  invoiceShowUpiInfo?: boolean;
  invoiceBottomMessage?: string;
  quotationShowTax?: boolean;
  quotationShowHsn?: boolean;
  quotationShowBankInfo?: boolean;
  quotationShowUpiInfo?: boolean;
  quotationShowSignature?: boolean;
  quotationBottomMessage?: string;
  proformaShowDiscount?: boolean;
  proformaShowTax?: boolean;
  proformaShowHsn?: boolean;
  proformaShowBankInfo?: boolean;
  proformaShowUpiInfo?: boolean;
  proformaBottomMessage?: string;
  purchaseShowHsn?: boolean;
  purchaseShowBankInfo?: boolean;
  purchaseBottomMessage?: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Phones an owner can be signed in on at once for pushes.
const MAX_OWNER_PHONES = 5;

@Injectable()
export class BusinessesService implements OnModuleInit {
  private readonly logger = new Logger(BusinessesService.name);

  constructor(
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    @InjectModel(ServicePreset.name)
    private readonly servicePresetModel: Model<ServicePresetDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly paymentOrderModel: Model<PaymentOrderDocument>,
    @InjectModel(AppFeedback.name)
    private readonly appFeedbackModel: Model<AppFeedbackDocument>,
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    @InjectModel(ProformaInvoice.name)
    private readonly proformaModel: Model<ProformaInvoiceDocument>,
    @InjectModel(Amc.name)
    private readonly amcModel: Model<AmcDocument>,
    @InjectModel(InventoryItem.name)
    private readonly inventoryItemModel: Model<InventoryItemDocument>,
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
    @InjectModel(ApplePurchase.name)
    private readonly applePurchaseModel: Model<ApplePurchaseDocument>,
    @InjectModel(PlayPurchase.name)
    private readonly playPurchaseModel: Model<PlayPurchaseDocument>,
    @InjectModel(QuickNote.name)
    private readonly quickNoteModel: Model<QuickNoteDocument>,
    private readonly configService: ConfigService,
    private readonly servicePresetsService: ServicePresetsService,
    private readonly s3Service: S3Service,
    private readonly appleSignInService: AppleSignInService,
  ) {}

  // Mongoose only ever *creates* indexes that don't already exist — it
  // never updates one whose options (e.g. sparse) changed after it was
  // first built. The `phone`/`email`/`googleId`/`appleId` unique indexes
  // were briefly non-sparse before this schema added `sparse: true`, which
  // left the live index rejecting every second phone-less/Google/Apple
  // account with a spurious E11000 on `null`. syncIndexes() brings the
  // real MongoDB indexes back in line with the schema on every boot.
  async onModuleInit(): Promise<void> {
    try {
      const result = await this.businessModel.syncIndexes();
      this.logger.log(`Synced Business indexes: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error('Failed to sync Business indexes', err as Error);
    }
  }

  findByEmail(email: string): Promise<BusinessDocument | null> {
    return this.businessModel.findOne({ email: email.toLowerCase() }).exec();
  }

  findByPhone(phone: string): Promise<BusinessDocument | null> {
    return this.businessModel.findOne({ phone: phone.trim() }).exec();
  }

  findByPhoneOrEmail(identifier: string): Promise<BusinessDocument | null> {
    const clean = identifier.trim().toLowerCase();
    return this.businessModel
      .findOne({
        $or: [{ phone: identifier.trim() }, { email: clean }],
      })
      .exec();
  }

  // passwordHash has select:false on the schema — only AuthService's login
  // check needs it, so every other read of a Business stays password-free.
  // An owner by the phone number on their account, in its usual spellings
  // (see loginPhoneDigits) — for phone sign-in and so a number is never both
  // an owner's and a technician's login.
  findByLoginPhone(
    digits: string,
    withPassword = false,
  ): Promise<BusinessDocument | null> {
    const local = digits.startsWith('91') ? digits.slice(2) : digits;
    const query = this.businessModel.findOne({
      phone: {
        $in: [`+${digits}`, digits, local, `0${local}`, `+91 ${local}`],
      },
    });
    return (withPassword ? query.select('+passwordHash') : query).exec();
  }

  findByEmailWithPassword(email: string): Promise<BusinessDocument | null> {
    return this.businessModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  findByGoogleId(googleId: string): Promise<BusinessDocument | null> {
    return this.businessModel.findOne({ googleId }).exec();
  }

  findByAppleId(appleId: string): Promise<BusinessDocument | null> {
    return this.businessModel.findOne({ appleId }).exec();
  }

  findByEmailWithResetCode(email: string): Promise<BusinessDocument | null> {
    return this.businessModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordResetCodeHash +passwordResetExpiresAt +passwordResetAttempts')
      .exec();
  }

  async setPasswordResetCode(
    id: string,
    codeHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.businessModel
      .findByIdAndUpdate(id, {
        passwordResetCodeHash: codeHash,
        passwordResetExpiresAt: expiresAt,
        // A fresh code starts with a fresh count of wrong tries.
        passwordResetAttempts: 0,
      })
      .exec();
  }

  // Sets the new password and consumes the reset code in one update so a
  // code can never be replayed after a successful reset.
  findByIdWithPassword(id: string): Promise<BusinessDocument | null> {
    return this.businessModel.findById(id).select('+passwordHash').exec();
  }

  // `emailVerified` only for a reset by emailed code: the code arriving
  // proves the inbox is the owner's. A signed-in password change proves
  // nothing about the email, so it leaves the flag alone.
  async resetPasswordWithCode(
    id: string,
    passwordHash: string,
    opts: { emailVerified?: boolean } = {},
  ): Promise<void> {
    await this.businessModel
      .findByIdAndUpdate(id, {
        passwordHash,
        ...(opts.emailVerified ? { emailVerified: true } : {}),
        $unset: { passwordResetCodeHash: 1, passwordResetExpiresAt: 1, passwordResetAttempts: 1 },
      })
      .exec();
  }

  // One more wrong reset code. At `max` the code is thrown away, so it can't
  // be guessed by retrying. Returns the count so far.
  async recordResetCodeFailure(id: string, max: number): Promise<number> {
    const doc = await this.businessModel
      .findByIdAndUpdate(id, { $inc: { passwordResetAttempts: 1 } }, { new: true })
      .select('+passwordResetAttempts')
      .exec();
    const tries = doc?.passwordResetAttempts ?? max;
    if (tries >= max) {
      await this.businessModel
        .findByIdAndUpdate(id, { $unset: { passwordResetCodeHash: 1, passwordResetExpiresAt: 1 } })
        .exec();
    }
    return tries;
  }

  createWithEmail(params: {
    email: string;
    passwordHash: string;
    name?: string;
    phone?: string;
  }): Promise<BusinessDocument> {
    const geo = inferBusinessGeoDefaults(params.phone);
    return this.businessModel.create({
      email: params.email.toLowerCase(),
      // Only reached after the emailed signup code checked out.
      emailVerified: true,
      passwordHash: params.passwordHash,
      ...(params.name ? { name: params.name } : {}),
      ...(params.phone ? { phone: params.phone } : {}),
      country: geo.country,
      currency: geo.currency,
      timezone: geo.timezone,
      taxType: geo.taxType,
    });
  }

  // `email` only when Google says it is verified — see AuthService.
  createWithGoogle(params: {
    email?: string;
    googleId: string;
    name?: string;
    phone?: string;
  }): Promise<BusinessDocument> {
    const geo = inferBusinessGeoDefaults(params.phone);
    return this.businessModel.create({
      ...(params.email
        ? { email: params.email.toLowerCase(), emailVerified: true }
        : {}),
      googleId: params.googleId,
      ...(params.name ? { name: params.name } : {}),
      ...(params.phone ? { phone: params.phone } : {}),
      country: geo.country,
      currency: geo.currency,
      timezone: geo.timezone,
      taxType: geo.taxType,
    });
  }

  // Used when a Google sign-in's email matches an existing phone/email
  // account — links it rather than creating a duplicate business.
  // Only for an account whose email is verified (AuthService checks).
  async linkGoogleId(id: string, googleId: string): Promise<BusinessDocument> {
    const business = await this.businessModel
      .findByIdAndUpdate(id, { googleId }, { new: true })
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  createWithApple(params: {
    email: string;
    appleId: string;
    name?: string;
    phone?: string;
    appleRefreshToken?: string;
  }): Promise<BusinessDocument> {
    const geo = inferBusinessGeoDefaults(params.phone);
    return this.businessModel.create({
      // Apple only hands out addresses it has verified (including private
      // relay ones).
      email: params.email.toLowerCase(),
      emailVerified: true,
      appleId: params.appleId,
      ...(params.appleRefreshToken
        ? { appleRefreshToken: params.appleRefreshToken }
        : {}),
      ...(params.name ? { name: params.name } : {}),
      ...(params.phone ? { phone: params.phone } : {}),
      country: geo.country,
      currency: geo.currency,
      timezone: geo.timezone,
      taxType: geo.taxType,
    });
  }

  // Same rationale as linkGoogleId — an Apple sign-in whose email matches
  // an existing account links to it instead of creating a duplicate.
  async linkAppleId(
    id: string,
    appleId: string,
    appleRefreshToken?: string,
  ): Promise<BusinessDocument> {
    const business = await this.businessModel
      .findByIdAndUpdate(
        id,
        { appleId, ...(appleRefreshToken ? { appleRefreshToken } : {}) },
        { new: true },
      )
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  // A returning Apple user whose code exchange produced a fresh token — the
  // newest one is the one worth revoking at deletion.
  async setAppleRefreshToken(
    id: string,
    appleRefreshToken: string,
  ): Promise<void> {
    await this.businessModel
      .updateOne({ _id: id }, { appleRefreshToken })
      .exec();
  }

  /**
   * Takes an email address off an account that never proved it owns it.
   *
   * Called when someone signs in with Google/Apple and that provider vouches
   * for the address: the provider's word beats a profile field anyone could
   * have typed. `email` is unique, so the new sign-in's account could not be
   * created with it while the unverified claim stayed in place — and refusing
   * the sign-in instead would let anyone block a person from ever signing up
   * by squatting their address. The other account keeps everything else
   * (data, phone, password); only the unproven address goes.
   */
  async releaseUnverifiedEmail(id: string): Promise<void> {
    const released = await this.businessModel
      .findOneAndUpdate(
        { _id: id, emailVerified: false },
        {
          $unset: {
            email: '',
            passwordResetCodeHash: '',
            passwordResetExpiresAt: '',
            passwordResetAttempts: '',
          },
        },
      )
      .exec();
    if (released) {
      this.logger.warn(
        `Removed unverified email from business ${id}: a Google/Apple sign-in proved the address belongs to someone else.`,
      );
    }
  }

  async findById(id: string): Promise<BusinessDocument> {
    const business = await this.businessModel.findById(id).exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  // Used by invoice/quotation PDF rendering — the only reads that need the
  // logo/signature binary payloads (fetched from S3) alongside the rest of
  // the profile. Returns a plain object rather than a Document since callers
  // only ever read these fields, never save the result.
  async findByIdWithBranding(id: string): Promise<BusinessWithBranding> {
    const business = await this.businessModel
      .findById(id)
      .select('+logoKey +logoContentType +signatureKey +signatureContentType')
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const [logo, signature] = await Promise.all([
      business.logoKey
        ? this.s3Service.download(business.logoKey)
        : Promise.resolve(null),
      business.signatureKey
        ? this.s3Service.download(business.signatureKey)
        : Promise.resolve(null),
    ]);

    // Every PDF setting has to be listed here — anything left out never
    // reaches the renderer, and the setting silently does nothing.
    return {
      name: business.name,
      tradeType: business.tradeType,
      address: business.address,
      phone: business.phone,
      email: business.email,
      gstin: business.gstin,
      country: business.country,
      currency: business.currency,
      taxType: business.taxType,
      taxRegistrationNumber: business.taxRegistrationNumber,
      logo: logo ?? undefined,
      signature: signature ?? undefined,
      documentAccentColor: business.documentAccentColor,
      paymentUpiId: business.paymentUpiId,
      paymentQrContent: business.paymentQrContent,
      bankDetails: business.bankDetails,
      paymentBankName: business.paymentBankName,
      paymentAccountNumber: business.paymentAccountNumber,
      paymentAccountCode: business.paymentAccountCode,
      acceptsCash: business.acceptsCash,
      showPaymentDetailsOnInvoice: business.showPaymentDetailsOnInvoice,
      invoiceShowDiscount: business.invoiceShowDiscount,
      invoiceShowTax: business.invoiceShowTax,
      invoiceShowHsn: business.invoiceShowHsn,
      invoiceShowBankInfo: business.invoiceShowBankInfo,
      invoiceShowUpiInfo: business.invoiceShowUpiInfo,
      invoiceBottomMessage: business.invoiceBottomMessage,
      quotationShowTax: business.quotationShowTax,
      quotationShowHsn: business.quotationShowHsn,
      quotationShowBankInfo: business.quotationShowBankInfo,
      quotationShowUpiInfo: business.quotationShowUpiInfo,
      quotationShowSignature: business.quotationShowSignature,
      quotationBottomMessage: business.quotationBottomMessage,
      proformaShowDiscount: business.proformaShowDiscount,
      proformaShowTax: business.proformaShowTax,
      proformaShowHsn: business.proformaShowHsn,
      proformaShowBankInfo: business.proformaShowBankInfo,
      proformaShowUpiInfo: business.proformaShowUpiInfo,
      proformaBottomMessage: business.proformaBottomMessage,
      purchaseShowHsn: business.purchaseShowHsn,
      purchaseShowBankInfo: business.purchaseShowBankInfo,
      purchaseBottomMessage: business.purchaseBottomMessage,
      invoiceTopMessage: business.invoiceTopMessage,
      quotationTopMessage: business.quotationTopMessage,
      proformaTopMessage: business.proformaTopMessage,
      purchaseTopMessage: business.purchaseTopMessage,
      quotationShowShippingAddress: business.quotationShowShippingAddress,
    };
  }

  async findByIdWithUsage(id: string) {
    // Independent reads, so run together. A missing business still 404s.
    const [business, customerCount] = await Promise.all([
      this.findById(id),
      this.customerModel.countDocuments({ businessId: idFilter(id) }).exec(),
    ]);
    const freeTierLimit = Number(
      this.configService.get('FREE_TIER_CUSTOMER_LIMIT') ?? 25,
    );
    // Resolved server-side so the app never keeps its own copy of what a
    // country implies — dial code, tax name, statutory rates.
    return {
      ...business.toObject(),
      customerCount,
      freeTierLimit,
      geo: geoDefaultsForCountry(business.country),
    };
  }

  async update(id: string, dto: UpdateBusinessDto): Promise<BusinessDocument> {
    const before = await this.findById(id);
    const isFirstTradeSelection = !before.tradeType && !!dto.tradeType;

    // A Google/Apple sign-up arrives with no phone, so registration had
    // nothing to infer from and fell back to India. Onboarding asks for the
    // phone straight afterwards — that is the first real signal of where this
    // business is, so apply it. Only on the FIRST phone, and never over a
    // value the caller set explicitly in the same request.
    const geoFromFirstPhone =
      !before.phone && dto.phone ? inferBusinessGeoDefaults(dto.phone) : null;

    // Subscription pricing is derived from `country` (see
    // SubscriptionsService.createOrder), so letting it change freely once a
    // paid subscription exists would let a business flip to a cheaper
    // country right before a renewal. Free-tier businesses (nothing
    // financially at stake yet) can still correct a wrong auto-detected
    // country at will.
    if (dto.country && dto.country !== before.country) {
      const activeSubscription = await this.subscriptionModel
        .findOne({ businessId: idFilter(id) })
        .sort({ createdAt: -1 })
        .exec();
      const isActive =
        activeSubscription?.status === 'active' &&
        (!activeSubscription.renewalDate ||
          activeSubscription.renewalDate.getTime() >= Date.now());
      if (isActive) {
        throw new ConflictException(
          'Your billing country cannot be changed while a subscription is active. Contact support if you need to change it.',
        );
      }
    }

    // phone and email are both sparse-unique. Without this the index throws a
    // raw E11000 and the client gets a 500, where the real answer is "that
    // number already belongs to another account" — which is also the hint a
    // returning user needs when they've accidentally created a second account.
    const update = splitClearableUpdate({
      ...(geoFromFirstPhone
        ? {
            country: geoFromFirstPhone.country,
            currency: geoFromFirstPhone.currency,
            timezone: geoFromFirstPhone.timezone,
            taxType: geoFromFirstPhone.taxType,
          }
        : {}),
      ...dto,
    });
    // A new address is unproven until a code sent to it comes back (a
    // password reset), so Google/Apple will not link to this account by it.
    // A reset code already in flight was sent to the OLD address — it must
    // not then verify the new one, so it goes too. Same address in another
    // case is not a change: the schema lowercases it anyway.
    if (
      dto.email !== undefined &&
      dto.email.trim().toLowerCase() !== (before.email ?? '').toLowerCase()
    ) {
      update.$set = { ...update.$set, emailVerified: false };
      update.$unset = {
        ...update.$unset,
        passwordResetCodeHash: '',
        passwordResetExpiresAt: '',
        passwordResetAttempts: '',
      };
    }

    const business = await this.businessModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec()
      .catch((err: { code?: number; keyPattern?: Record<string, unknown> }) => {
        if (err?.code === 11000) {
          const field = err.keyPattern?.phone
            ? 'phone number'
            : 'email address';
          throw new ConflictException(
            `That ${field} is already used by another account. Sign in to that account instead.`,
          );
        }
        throw err;
      });
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    if (isFirstTradeSelection) {
      await this.servicePresetsService.reseedForTrade(id, dto.tradeType);
    }

    return business;
  }

  private s3KeyFor(
    kind: 'logo' | 'signature',
    businessId: string,
    contentType: string,
  ): string {
    const ext = IMAGE_EXTENSIONS[contentType] ?? 'jpg';
    return `businesses/${businessId}/${kind}.${ext}`;
  }

  async setLogo(
    id: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const key = this.s3KeyFor('logo', id, contentType);
    await this.s3Service.upload(key, buffer, contentType);
    const result = await this.businessModel
      .findByIdAndUpdate(id, {
        logoKey: key,
        logoContentType: contentType,
        hasLogo: true,
      })
      .exec();
    if (!result) {
      throw new NotFoundException('Business not found');
    }
  }

  async getLogo(
    id: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const business = await this.businessModel
      .findById(id)
      .select('+logoKey +logoContentType')
      .exec();
    if (!business?.logoKey) {
      return null;
    }
    const data = await this.s3Service.download(business.logoKey);
    if (!data) {
      return null;
    }
    return { data, contentType: business.logoContentType ?? 'image/jpeg' };
  }

  async removeLogo(id: string): Promise<void> {
    const business = await this.businessModel
      .findById(id)
      .select('+logoKey')
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    if (business.logoKey) {
      await this.s3Service.delete(business.logoKey);
    }
    await this.businessModel
      .updateOne(
        { _id: id },
        { $unset: { logoKey: 1, logoContentType: 1 }, hasLogo: false },
      )
      .exec();
  }

  async setSignature(
    id: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const key = this.s3KeyFor('signature', id, contentType);
    await this.s3Service.upload(key, buffer, contentType);
    const result = await this.businessModel
      .findByIdAndUpdate(id, {
        signatureKey: key,
        signatureContentType: contentType,
        hasSignature: true,
      })
      .exec();
    if (!result) {
      throw new NotFoundException('Business not found');
    }
  }

  async getSignature(
    id: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const business = await this.businessModel
      .findById(id)
      .select('+signatureKey +signatureContentType')
      .exec();
    if (!business?.signatureKey) {
      return null;
    }
    const data = await this.s3Service.download(business.signatureKey);
    if (!data) {
      return null;
    }
    return { data, contentType: business.signatureContentType ?? 'image/jpeg' };
  }

  async removeSignature(id: string): Promise<void> {
    const business = await this.businessModel
      .findById(id)
      .select('+signatureKey')
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    if (business.signatureKey) {
      await this.s3Service.delete(business.signatureKey);
    }
    await this.businessModel
      .updateOne(
        { _id: id },
        {
          $unset: { signatureKey: 1, signatureContentType: 1 },
          hasSignature: false,
        },
      )
      .exec();
  }

  async remove(id: string): Promise<void> {
    const business = await this.businessModel
      .findById(id)
      .select('+logoKey +signatureKey +appleRefreshToken')
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    const businessId = idFilter(id);

    // Read before the cascade deletes the rows that hold them.
    const [services, appleMembers] = await Promise.all([
      this.serviceModel
        .find({
          businessId,
          $or: [
            { beforePhotoKey: { $exists: true } },
            { afterPhotoKey: { $exists: true } },
            { signatureKey: { $exists: true } },
          ],
        })
        .select('+beforePhotoKey +afterPhotoKey +signatureKey')
        .lean()
        .exec(),
      this.teamMemberModel
        .find({ businessId, appleRefreshToken: { $exists: true } })
        .select('+appleRefreshToken')
        .lean()
        .exec(),
    ]);

    // Cascade-delete every business-scoped collection — a plain
    // findByIdAndDelete on Business alone would orphan all of this data, and
    // account deletion has to really delete it (App Store / Play policy).
    // Matched in both stored id forms (see idFilter), or rows saved with an
    // ObjectId businessId would silently survive.
    //
    // The App Store / Play purchase rows go too. They exist to map a store
    // notification back to a business and to stop one purchase being
    // restored onto a second account; with the business gone a notification
    // has nothing to update, and keeping them would block the same person
    // from restoring a still-paid subscription onto a new account.
    await Promise.all(
      this.businessScopedModels().map((model) =>
        model.deleteMany({ businessId }).exec(),
      ),
    );

    // Best-effort from here on: the data is already gone, so a storage or
    // Apple hiccup is logged rather than failing a deletion the user asked
    // for.
    const s3Keys = [
      business.logoKey,
      business.signatureKey,
      ...services.flatMap((s) => [
        s.beforePhotoKey,
        s.afterPhotoKey,
        s.signatureKey,
      ]),
    ].filter((key): key is string => !!key);
    const appleTokens = [
      business.appleRefreshToken,
      ...appleMembers.map((m) => m.appleRefreshToken),
    ].filter((token): token is string => !!token);
    await Promise.all([
      ...s3Keys.map((key) =>
        this.s3Service.delete(key).catch((err: Error) => {
          this.logger.warn(
            `Account deletion: could not delete S3 object ${key}: ${err?.message ?? err}`,
          );
        }),
      ),
      // Apple requires the app's access to be revoked when the account goes.
      ...appleTokens.map((token) =>
        this.appleSignInService.revokeRefreshToken(token),
      ),
    ]);

    await this.businessModel.findByIdAndDelete(id).exec();
  }

  // Every collection keyed by businessId. Kept as one list so the deletion
  // spec can check nothing business-scoped is left out.
  private businessScopedModels(): Model<any>[] {
    return [
      this.customerModel,
      this.serviceModel,
      this.invoiceModel,
      this.paymentModel,
      this.quotationModel,
      this.proformaModel,
      this.purchaseModel,
      this.supplierModel,
      this.inventoryItemModel,
      this.amcModel,
      this.servicePresetModel,
      this.teamMemberModel,
      this.subscriptionModel,
      this.paymentOrderModel,
      this.applePurchaseModel,
      this.playPurchaseModel,
      this.appFeedbackModel,
      this.quickNoteModel,
    ];
  }

  async updateSubscriptionStatus(
    id: string,
    subscriptionStatus: BusinessDocument['subscriptionStatus'],
  ): Promise<BusinessDocument> {
    const business = await this.businessModel
      .findByIdAndUpdate(id, { subscriptionStatus }, { new: true })
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  // Bypasses UpdateBusinessDto deliberately — the subscription-tier gate for
  // which templates are allowed lives in DocumentTemplatesController, which
  // has access to SubscriptionsService (importing it here would create a
  // circular module dependency, since SubscriptionsModule already imports
  // BusinessesModule).
  async setInvoiceTemplate(
    id: string,
    invoiceTemplateId: DocumentTemplateId,
    // `undefined` leaves the stored accent alone (a template change on its
    // own must not silently reset a chosen colour); `null` clears it back to
    // the layout's default.
    documentAccentColor?: string | null,
  ): Promise<BusinessDocument> {
    const update: Record<string, unknown> = { invoiceTemplateId };
    if (documentAccentColor !== undefined) {
      if (documentAccentColor === null) {
        update.$unset = { documentAccentColor: '' };
      } else {
        update.documentAccentColor = documentAccentColor;
      }
    }

    // $unset can't sit alongside the same field in a $set-style update, so
    // it's lifted out into its own operator when present.
    const { $unset, ...set } = update as { $unset?: unknown };
    const business = await this.businessModel
      .findByIdAndUpdate(id, $unset ? { $set: set, $unset } : { $set: set }, {
        new: true,
      })
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }

  /**
   * Refuses a "next number" setting that would hand out a number already used.
   *
   * The settings screens used to send every serial back on every save, from
   * a business the app had cached when the screen opened. Saving any other
   * setting after a few invoices had gone out moved the counter backwards,
   * and the next invoice then collided with an existing one on the unique
   * {businessId, invoiceNumber} index — a raw 500 on every attempt until the
   * counter caught up again.
   *
   * Compared against the highest serial actually used under the prefix that
   * will be in force (the one in this request, else the stored one), so
   * starting a fresh prefix back at 1 is still allowed. Only for the
   * owner-facing settings endpoint; the services' own counter writes do not
   * come through here.
   */
  async assertNextSerialsAhead(
    id: string,
    dto: UpdateBusinessDto,
  ): Promise<void> {
    const docs = [
      {
        label: 'invoice',
        serial: 'invoiceNextSerial',
        prefix: 'invoicePrefix',
        defaultPrefix: 'INV-',
        model: this.invoiceModel as Model<unknown>,
        numberField: 'invoiceNumber',
      },
      {
        label: 'quotation',
        serial: 'quotationNextSerial',
        prefix: 'quotationPrefix',
        defaultPrefix: 'QT-',
        model: this.quotationModel as Model<unknown>,
        numberField: 'quotationNumber',
      },
      {
        label: 'purchase order',
        serial: 'purchaseNextSerial',
        prefix: 'purchasePrefix',
        defaultPrefix: 'PO-',
        model: this.purchaseModel as Model<unknown>,
        numberField: 'purchaseNumber',
      },
      {
        label: 'proforma invoice',
        serial: 'proformaNextSerial',
        prefix: 'proformaPrefix',
        defaultPrefix: 'PI-',
        model: this.proformaModel as Model<unknown>,
        numberField: 'proformaNumber',
      },
    ] as const;
    const requested = dto as Record<string, unknown>;
    if (!docs.some((d) => requested[d.serial] !== undefined)) return;

    const before = await this.findById(id);
    for (const doc of docs) {
      const next = requested[doc.serial];
      if (typeof next !== 'number') continue;
      const prefix =
        ((requested[doc.prefix] as string | undefined) ??
          (before.get(doc.prefix) as string | undefined)) ||
        doc.defaultPrefix;
      const highest = await this.highestSerialUsed(
        doc.model,
        id,
        doc.numberField,
        prefix,
      );
      if (next <= highest) {
        throw new BadRequestException(
          `${prefix} ${doc.label} numbers up to ${highest} are already used. Set the next number to ${highest + 1} or higher.`,
        );
      }
    }
  }

  // The serial is the trailing number of `${prefix}${year}-${serial}`, the
  // format every document service writes. Aggregation does not cast ids, so
  // the business is matched in both stored forms.
  private async highestSerialUsed(
    model: Model<unknown>,
    businessId: string,
    numberField: string,
    prefix: string,
  ): Promise<number> {
    const pattern = `^${escapeRegex(prefix)}\\d{4}-(\\d+)$`;
    const [row] = await model
      .aggregate<{ highest: number }>([
        {
          $match: {
            businessId: idFilter(businessId),
            [numberField]: { $regex: pattern },
          },
        },
        {
          $project: {
            found: {
              $regexFind: { input: `$${numberField}`, regex: pattern },
            },
          },
        },
        {
          $group: {
            _id: null,
            highest: {
              $max: { $toLong: { $arrayElemAt: ['$found.captures', 0] } },
            },
          },
        },
      ])
      .exec();
    return Number(row?.highest ?? 0);
  }

  // Hands out the next document serial atomically.
  //
  // The previous approach read `invoiceNextSerial`, then wrote back
  // `serial + 1` in a separate call. Two invoices created at the same moment
  // both read the same value, both produced the same number, and the second
  // insert died on the unique {businessId, invoiceNumber} index — surfacing
  // as a raw 500. A single $inc is indivisible, so each caller gets its own
  // serial no matter how many run at once.
  //
  // `field` is a fixed literal chosen by the caller, never user input.
  async allocateSerial(
    id: string,
    field: 'invoiceNextSerial' | 'quotationNextSerial',
    seedIfUnset: () => Promise<number>,
  ): Promise<number> {
    // Fast path: the counter already exists, so just take the next value.
    const bumped = await this.businessModel
      .findOneAndUpdate(
        { _id: id, [field]: { $gte: 1 } },
        { $inc: { [field]: 1 } },
        { new: true },
      )
      .exec();
    if (bumped) {
      // $inc with new:true returns the value AFTER incrementing, so the
      // serial this caller owns is one less.
      return (bumped.get(field) as number) - 1;
    }

    // First document for this business: seed the counter from whatever is
    // already there (a business may have invoices from before this field
    // existed) and claim that serial. The guard on the filter means only one
    // concurrent caller can seed.
    const seed = await seedIfUnset();
    const seeded = await this.businessModel
      .findOneAndUpdate(
        { _id: id, [field]: { $in: [null, 0], $exists: true } },
        { $set: { [field]: seed + 1 } },
        { new: true },
      )
      .exec();
    if (seeded) return seed;

    const unset = await this.businessModel
      .findOneAndUpdate(
        { _id: id, [field]: { $exists: false } },
        { $set: { [field]: seed + 1 } },
        { new: true },
      )
      .exec();
    if (unset) return seed;

    // Someone else seeded it in the meantime — take a normal turn.
    return this.allocateSerial(id, field, seedIfUnset);
  }

  async updatePushToken(id: string, pushToken: string): Promise<void> {
    await this.releasePushToken(pushToken, { businessId: id });
    // Moved to the end of the list (newest), which keeps the last 5 phones.
    await this.businessModel.updateOne({ _id: id }, { $pull: { pushTokens: pushToken } }).exec();
    await this.businessModel
      .updateOne(
        { _id: id },
        { $set: { pushToken }, $push: { pushTokens: { $each: [pushToken], $slice: -MAX_OWNER_PHONES } } },
      )
      .exec();
  }

  /** Every phone to reach this business's owner on. */
  ownerPushTokens(business: OwnerPhones): string[] {
    return ownerPushTokens(business);
  }

  // A technician's token lives on their TeamMember row, not the business —
  // see the note on the push-token endpoint. Written through the directly
  // registered model for the same reason the deletion cascade is: importing
  // TeamMembersModule here would be circular.
  async updateTeamMemberPushToken(
    teamMemberId: string,
    pushToken: string,
  ): Promise<void> {
    await this.releasePushToken(pushToken, { teamMemberId });
    await this.teamMemberModel
      .findByIdAndUpdate(teamMemberId, { pushToken })
      .exec();
  }

  // Logout. Without this the phone kept receiving the signed-out account's
  // reminders (customer names, job details) until someone else signed in.
  // With the phone's token, only that phone is signed out; without it (an
  // older app), every phone is, as before.
  async clearPushToken(id: string, pushToken?: string): Promise<void> {
    if (pushToken) {
      await this.businessModel.updateOne({ _id: id }, { $pull: { pushTokens: pushToken } }).exec();
      await this.businessModel.updateOne({ _id: id, pushToken }, { $unset: { pushToken: '' } }).exec();
      return;
    }
    await this.businessModel
      .updateOne({ _id: id }, { $unset: { pushToken: '' }, $set: { pushTokens: [] } })
      .exec();
  }

  async clearTeamMemberPushToken(teamMemberId: string): Promise<void> {
    await this.teamMemberModel
      .updateOne({ _id: teamMemberId }, { $unset: { pushToken: '' } })
      .exec();
  }

  // An Expo token identifies the device, not the person. When a second
  // account signs in on a shared phone, the token is taken off whichever
  // owner or technician held it before — otherwise that phone went on getting
  // the previous account's pushes alongside the new one's.
  private async releasePushToken(
    pushToken: string,
    keep: { businessId?: string; teamMemberId?: string },
  ): Promise<void> {
    await Promise.all([
      this.businessModel
        .updateMany(
          {
            pushToken,
            ...(keep.businessId ? { _id: { $ne: keep.businessId } } : {}),
          },
          { $unset: { pushToken: '' } },
        )
        .exec(),
      this.businessModel
        .updateMany(
          {
            pushTokens: pushToken,
            ...(keep.businessId ? { _id: { $ne: keep.businessId } } : {}),
          },
          { $pull: { pushTokens: pushToken } },
        )
        .exec(),
      this.teamMemberModel
        .updateMany(
          {
            pushToken,
            ...(keep.teamMemberId ? { _id: { $ne: keep.teamMemberId } } : {}),
          },
          { $unset: { pushToken: '' } },
        )
        .exec(),
    ]);
  }

  // Called when Expo reports a token no longer belongs to an installed app —
  // otherwise a reinstalled or wiped device is pushed to forever.
  async clearPushTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    await this.businessModel
      .updateMany({ pushToken: { $in: tokens } }, { $unset: { pushToken: '' } })
      .exec();
    await this.businessModel
      .updateMany({ pushTokens: { $in: tokens } }, { $pull: { pushTokens: { $in: tokens } } })
      .exec();
  }
}
