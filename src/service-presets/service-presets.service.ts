import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ServicePreset,
  ServicePresetDocument,
} from './schemas/service-preset.schema';
import { CreateServicePresetDto } from './dto/create-service-preset.dto';
import { UpdateServicePresetDto } from './dto/update-service-preset.dto';
import {
  DEFAULT_SERVICE_PRESETS,
  presetsForTrade,
} from '../common/constants/service-options';

@Injectable()
export class ServicePresetsService {
  constructor(
    @InjectModel(ServicePreset.name)
    private readonly presetModel: Model<ServicePresetDocument>,
  ) {}

  async seedDefaults(businessId: string): Promise<void> {
    await this.presetModel.insertMany(
      DEFAULT_SERVICE_PRESETS.map((name) => ({ businessId, name })),
    );
  }

  // Called once, right after onboarding picks a trade type — replaces the
  // generic signup-time defaults with a trade-appropriate set.
  async reseedForTrade(businessId: string, tradeType?: string): Promise<void> {
    await this.presetModel.deleteMany({ businessId }).exec();
    await this.presetModel.insertMany(
      presetsForTrade(tradeType).map((name) => ({ businessId, name })),
    );
  }

  findAllForBusiness(businessId: string): Promise<ServicePresetDocument[]> {
    return this.presetModel.find({ businessId }).sort({ name: 1 }).exec();
  }

  create(
    businessId: string,
    dto: CreateServicePresetDto,
  ): Promise<ServicePresetDocument> {
    return this.presetModel.create({ businessId, name: dto.name });
  }

  async findOneOwned(
    businessId: string,
    presetId: string,
  ): Promise<ServicePresetDocument> {
    if (!Types.ObjectId.isValid(presetId)) {
      throw new NotFoundException('Service preset not found');
    }
    const preset = await this.presetModel.findById(presetId).exec();
    if (!preset) {
      throw new NotFoundException('Service preset not found');
    }
    if (preset.businessId.toString() !== businessId) {
      throw new ForbiddenException();
    }
    return preset;
  }

  async update(
    businessId: string,
    presetId: string,
    dto: UpdateServicePresetDto,
  ): Promise<ServicePresetDocument> {
    const preset = await this.findOneOwned(businessId, presetId);
    Object.assign(preset, dto);
    return preset.save();
  }

  async remove(businessId: string, presetId: string): Promise<void> {
    const preset = await this.findOneOwned(businessId, presetId);
    await preset.deleteOne();
  }
}
