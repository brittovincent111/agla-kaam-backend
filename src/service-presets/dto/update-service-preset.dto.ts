import { PartialType } from '@nestjs/mapped-types';
import { CreateServicePresetDto } from './create-service-preset.dto';

export class UpdateServicePresetDto extends PartialType(
  CreateServicePresetDto,
) {}
