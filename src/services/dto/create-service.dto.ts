import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  NEXT_SERVICE_INTERVALS,
  WARRANTY_PERIODS,
} from '../../common/constants/service-options';
import { ServiceLocationDto } from './service-location.dto';

export class CreateServiceDto {
  @IsMongoId()
  customerId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  serviceType: string;

  @IsOptional()
  @IsIn(['pending', 'completed', 'cancelled'])
  status?: 'pending' | 'completed' | 'cancelled';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  serviceDate?: Date;

  @IsIn(WARRANTY_PERIODS)
  warrantyPeriod: (typeof WARRANTY_PERIODS)[number];

  @ValidateIf((dto) => dto.warrantyPeriod === 'custom')
  @Type(() => Date)
  @IsDate()
  customWarrantyDate?: Date;

  @IsIn(NEXT_SERVICE_INTERVALS)
  nextServiceInterval: (typeof NEXT_SERVICE_INTERVALS)[number];

  @ValidateIf((dto) => dto.nextServiceInterval === 'custom')
  @Type(() => Date)
  @IsDate()
  customNextServiceDate?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceLocationDto)
  location?: ServiceLocationDto;

  // Owner-only in practice: a technician's own create request has this
  // overridden server-side to themselves regardless of what's sent here (see
  // ServicesService.create), so this field only ever takes effect when the
  // caller is the owner assigning the visit to someone else ahead of time.
  @IsOptional()
  @IsMongoId()
  assignedTechnicianId?: string;

  @IsOptional()
  @IsMongoId()
  amcId?: string;
}
