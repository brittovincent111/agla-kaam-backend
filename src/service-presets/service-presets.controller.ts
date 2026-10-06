import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { ServicePresetsService } from './service-presets.service';
import { CreateServicePresetDto } from './dto/create-service-preset.dto';
import { UpdateServicePresetDto } from './dto/update-service-preset.dto';
import { StarterPackDto } from './dto/starter-pack.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Business,
  BusinessDocument,
} from '../businesses/schemas/business.schema';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('service-presets')
export class ServicePresetsController {
  constructor(
    private readonly servicePresetsService: ServicePresetsService,
    // Read directly rather than through BusinessesService: BusinessesModule
    // already depends on this module, so importing it back would be circular.
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  // Open to technicians — they need the preset list to log a service.
  @Get()
  findAll(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.servicePresetsService.findAllForBusiness(business.businessId);
  }

  @Roles('owner')
  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateServicePresetDto,
  ) {
    return this.servicePresetsService.create(business.businessId, dto);
  }

  // Adds the trade's starter service types that are missing — nothing
  // existing is changed or removed.
  @Roles('owner')
  @Post('starter-pack')
  async starterPack(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: StarterPackDto,
  ) {
    const tradeType =
      dto.tradeType ??
      (
        await this.businessModel
          .findById(business.businessId)
          .select('tradeType')
          .lean()
          .exec()
      )?.tradeType;
    const added = await this.servicePresetsService.addStarterPack(
      business.businessId,
      tradeType,
    );
    return {
      added,
      presets: await this.servicePresetsService.findAllForBusiness(
        business.businessId,
      ),
    };
  }

  @Roles('owner')
  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateServicePresetDto,
  ) {
    return this.servicePresetsService.update(business.businessId, id, dto);
  }

  @Roles('owner')
  @Delete(':id')
  remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.servicePresetsService.remove(business.businessId, id);
  }
}
