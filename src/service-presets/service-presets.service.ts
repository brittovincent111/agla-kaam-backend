import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ServicePreset,
  ServicePresetDocument,
} from './schemas/service-preset.schema';
import { idFilter } from '../common/utils/id-match';
import { CreateServicePresetDto } from './dto/create-service-preset.dto';
import { UpdateServicePresetDto } from './dto/update-service-preset.dto';
import {
  DEFAULT_SERVICE_PRESETS,
  StarterPreset,
  presetsForTrade,
} from '../common/constants/service-options';

// Names compare case-insensitively everywhere: "AC Service" and "ac service"
// are one type to the person using the app.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

// The optional defaults a preset carries. null in a request clears one.
const DEFAULT_FIELDS = [
  'warrantyPeriod',
  'nextServiceInterval',
  'defaultPrice',
  'taxRate',
  'hsnCode',
] as const;

function starterRows(businessId: string, presets: StarterPreset[]) {
  return presets.map((preset) => ({ businessId, ...preset }));
}

@Injectable()
export class ServicePresetsService {
  constructor(
    @InjectModel(ServicePreset.name)
    private readonly presetModel: Model<ServicePresetDocument>,
  ) {}

  async seedDefaults(businessId: string): Promise<void> {
    await this.presetModel.insertMany(
      starterRows(businessId, DEFAULT_SERVICE_PRESETS),
    );
  }

  // Called once, right after onboarding picks a trade type — replaces the
  // generic signup-time defaults with a trade-appropriate set.
  async reseedForTrade(businessId: string, tradeType?: string): Promise<void> {
    await this.presetModel
      .deleteMany({ businessId: idFilter(businessId) })
      .exec();
    await this.presetModel.insertMany(
      starterRows(businessId, presetsForTrade(tradeType)),
    );
  }

  /**
   * Adds the trade's starter types the business does not already have, and
   * touches nothing it does have — for a business that changed trade, or
   * signed up before its trade had a pack. Returns how many were added.
   */
  async addStarterPack(
    businessId: string,
    tradeType?: string,
  ): Promise<number> {
    const existing = await this.presetModel
      .find({ businessId: idFilter(businessId) })
      .select('name previousNames')
      .exec();
    const taken = new Set(
      existing
        .flatMap((p) => [p.name, ...(p.previousNames ?? [])])
        .map((n) => n.trim().toLowerCase()),
    );
    const missing = presetsForTrade(tradeType).filter(
      (p) => !taken.has(p.name.toLowerCase()),
    );
    if (missing.length)
      await this.presetModel.insertMany(starterRows(businessId, missing));
    return missing.length;
  }

  findAllForBusiness(businessId: string): Promise<ServicePresetDocument[]> {
    return this.presetModel
      .find({ businessId: idFilter(businessId) })
      .collation(CASE_INSENSITIVE)
      .sort({ name: 1 })
      .exec();
  }

  async create(
    businessId: string,
    dto: CreateServicePresetDto,
  ): Promise<ServicePresetDocument> {
    await this.assertNameFree(businessId, dto.name);
    const row: Record<string, unknown> = { businessId, name: dto.name.trim() };
    if (dto.messageTemplate?.trim())
      row.messageTemplate = dto.messageTemplate.trim();
    for (const field of DEFAULT_FIELDS) {
      const value = dto[field];
      if (value !== undefined && value !== null && value !== '')
        row[field] = value;
    }
    return this.presetModel.create(row);
  }

  // Case-insensitive — service.serviceType is free text typed while logging a
  // service, so it won't always match a preset's stored casing exactly. Also
  // answers to a preset's former names, so a rename keeps working for the
  // services logged before it.
  findByName(
    businessId: string,
    name: string,
  ): Promise<ServicePresetDocument | null> {
    const trimmed = name.trim();
    return this.presetModel
      .findOne({
        businessId: idFilter(businessId),
        $or: [{ name: trimmed }, { previousNames: trimmed }],
      })
      .collation(CASE_INSENSITIVE)
      .exec();
  }

  async findOneOwned(
    businessId: string,
    presetId: string,
  ): Promise<ServicePresetDocument> {
    if (!Types.ObjectId.isValid(presetId)) {
      throw new NotFoundException('Service preset not found');
    }
    const preset = await this.presetModel.findById(presetId).exec();
    if (!preset || preset.businessId.toString() !== businessId) {
      throw new NotFoundException('Service preset not found');
    }
    return preset;
  }

  async update(
    businessId: string,
    presetId: string,
    dto: UpdateServicePresetDto,
  ): Promise<ServicePresetDocument> {
    const preset = await this.findOneOwned(businessId, presetId);

    if (dto.name !== undefined) {
      const next = dto.name.trim();
      if (next.toLowerCase() !== preset.name.toLowerCase()) {
        await this.assertNameFree(businessId, next, presetId);
        const history = new Set([...(preset.previousNames ?? []), preset.name]);
        history.delete(next);
        preset.previousNames = [...history];
      }
      preset.name = next;
    }

    // An empty message is "go back to the standard one". Sending nothing for
    // it used to leave the old custom text in place, so once a type had its
    // own message there was no way back.
    if (dto.messageTemplate !== undefined) {
      preset.messageTemplate = dto.messageTemplate.trim() || undefined;
    }

    for (const field of DEFAULT_FIELDS) {
      const value = dto[field];
      if (value === undefined) continue;
      preset.set(field, value === null || value === '' ? undefined : value);
    }
    return preset.save();
  }

  async remove(businessId: string, presetId: string): Promise<void> {
    const preset = await this.findOneOwned(businessId, presetId);
    await preset.deleteOne();
  }

  // Two presets of the same name meant only one of them was ever used, and
  // which one depended on the database.
  private async assertNameFree(
    businessId: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.presetModel
      .findOne({
        businessId: idFilter(businessId),
        name: name.trim(),
        ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}),
      })
      .collation(CASE_INSENSITIVE)
      .exec();
    if (clash) {
      throw new ConflictException(
        `"${clash.name}" is already one of your service types.`,
      );
    }
  }
}
