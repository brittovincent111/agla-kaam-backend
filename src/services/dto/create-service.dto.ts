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
}
