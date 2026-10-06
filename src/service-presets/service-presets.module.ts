import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Business,
  BusinessSchema,
} from '../businesses/schemas/business.schema';
import {
  ServicePreset,
  ServicePresetSchema,
} from './schemas/service-preset.schema';
import { ServicePresetsService } from './service-presets.service';
import { ServicePresetsController } from './service-presets.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: ServicePreset.name, schema: ServicePresetSchema },
    ]),
  ],
  controllers: [ServicePresetsController],
  providers: [ServicePresetsService],
  exports: [ServicePresetsService],
})
export class ServicePresetsModule {}
