import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from './schemas/business.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { UpdateBusinessDto } from './dto/update-business.dto';

@Injectable()
export class BusinessesService {
  constructor(
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly configService: ConfigService,
    private readonly servicePresetsService: ServicePresetsService,
  ) {}

  findByPhone(phone: string): Promise<BusinessDocument | null> {
    return this.businessModel.findOne({ phone }).exec();
  }

  create(phone: string): Promise<BusinessDocument> {
    return this.businessModel.create({ phone });
  }

  async findOrCreateByPhone(
    phone: string,
  ): Promise<{ business: BusinessDocument; isNew: boolean }> {
    const existing = await this.findByPhone(phone);
    if (existing) {
      return { business: existing, isNew: false };
    }
    const business = await this.create(phone);
    return { business, isNew: true };
  }

  async findById(id: string): Promise<BusinessDocument> {
    const business = await this.businessModel.findById(id).exec();
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
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

  async remove(id: string): Promise<void> {
    // Deletes the business record only — related customers/services/presets
    // are left in place (orphaned) rather than cascade-deleted for now.
    const result = await this.businessModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Business not found');
    }
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
}
