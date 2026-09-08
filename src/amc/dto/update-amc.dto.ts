import { PartialType } from '@nestjs/mapped-types';
import { CreateAmcDto } from './create-amc.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { AmcStatus } from '../schemas/amc.schema';

export class UpdateAmcDto extends PartialType(CreateAmcDto) {
  @IsEnum(['active', 'completed', 'expired', 'cancelled'])
  @IsOptional()
  status?: AmcStatus;
}
