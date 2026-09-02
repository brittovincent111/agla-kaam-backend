import { Injectable, NotFoundException } from '@nestjs/common';
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
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { DocumentTemplateId } from '../common/pdf/document-templates';
import { S3Service } from '../common/s3/s3.service';

export interface BusinessWithBranding {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  logo?: Buffer;
  signature?: Buffer;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class BusinessesService {
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
    private readonly configService: ConfigService,
    private readonly servicePresetsService: ServicePresetsService,
    private readonly s3Service: S3Service,
  ) {}

  findByEmail(email: string): Promise<BusinessDocument | null> {
    return this.businessModel.findOne({ email: email.toLowerCase() }).exec();
  }

  // passwordHash has select:false on the schema — only AuthService's login
  // check needs it, so every other read of a Business stays password-free.
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
      .select('+passwordResetCodeHash +passwordResetExpiresAt')
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
      })
      .exec();
  }

  // Sets the new password and consumes the reset code in one update so a
  // code can never be replayed after a successful reset.
  async resetPasswordWithCode(id: string, passwordHash: string): Promise<void> {
    await this.businessModel
      .findByIdAndUpdate(id, {
        passwordHash,
        $unset: { passwordResetCodeHash: 1, passwordResetExpiresAt: 1 },
      })
      .exec();
  }

  createWithEmail(params: {
    email: string;
    passwordHash: string;
    name?: string;
    phone?: string;
  }): Promise<BusinessDocument> {
    return this.businessModel.create({
      email: params.email.toLowerCase(),
      passwordHash: params.passwordHash,
      ...(params.name ? { name: params.name } : {}),
      ...(params.phone ? { phone: params.phone } : {}),
    });
  }

  createWithGoogle(params: {
    email: string;
    googleId: string;
    name?: string;
  }): Promise<BusinessDocument> {
    return this.businessModel.create({
      email: params.email.toLowerCase(),
      googleId: params.googleId,
      ...(params.name ? { name: params.name } : {}),
    });
  }

  // Used when a Google sign-in's email matches an existing phone/email
  // account — links it rather than creating a duplicate business.
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
  }): Promise<BusinessDocument> {
    return this.businessModel.create({
      email: params.email.toLowerCase(),
      appleId: params.appleId,
      ...(params.name ? { name: params.name } : {}),
    });
  }

  // Same rationale as linkGoogleId — an Apple sign-in whose email matches
  // an existing account links to it instead of creating a duplicate.
  async linkAppleId(id: string, appleId: string): Promise<BusinessDocument> {
    const business = await this.businessModel
      .findByIdAndUpdate(id, { appleId }, { new: true })
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
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

    return {
      name: business.name,
      address: business.address,
      phone: business.phone,
      email: business.email,
      gstin: business.gstin,
      logo: logo ?? undefined,
      signature: signature ?? undefined,
    };
  }

  async findByIdWithUsage(id: string) {
    const business = await this.findById(id);
    const customerCount = await this.customerModel
      .countDocuments({ businessId: id })
      .exec();
    const freeTierLimit = Number(
      this.configService.get('FREE_TIER_CUSTOMER_LIMIT') ?? 25,
    );
    return { ...business.toObject(), customerCount, freeTierLimit };
  }

  async update(id: string, dto: UpdateBusinessDto): Promise<BusinessDocument> {
    const before = await this.findById(id);
    const isFirstTradeSelection = !before.tradeType && !!dto.tradeType;

    const business = await this.businessModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
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
      .select('+logoKey +signatureKey')
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    // Cascade-delete every business-scoped collection — a plain
    // findByIdAndDelete on Business alone would orphan all of this data.
    await Promise.all([
      this.customerModel.deleteMany({ businessId: id }).exec(),
      this.serviceModel.deleteMany({ businessId: id }).exec(),
      this.invoiceModel.deleteMany({ businessId: id }).exec(),
      this.paymentModel.deleteMany({ businessId: id }).exec(),
      this.quotationModel.deleteMany({ businessId: id }).exec(),
      this.servicePresetModel.deleteMany({ businessId: id }).exec(),
      this.teamMemberModel.deleteMany({ businessId: id }).exec(),
      this.subscriptionModel.deleteMany({ businessId: id }).exec(),
      this.paymentOrderModel.deleteMany({ businessId: id }).exec(),
      this.appFeedbackModel.deleteMany({ businessId: id }).exec(),
    ]);

    await Promise.all([
      business.logoKey
        ? this.s3Service.delete(business.logoKey)
        : Promise.resolve(),
      business.signatureKey
        ? this.s3Service.delete(business.signatureKey)
        : Promise.resolve(),
    ]);

    await this.businessModel.findByIdAndDelete(id).exec();
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
  ): Promise<BusinessDocument> {
    const business = await this.businessModel
      .findByIdAndUpdate(id, { invoiceTemplateId }, { new: true })
      .exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }
}
