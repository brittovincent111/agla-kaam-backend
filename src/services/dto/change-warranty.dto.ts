import { IsDate, IsIn, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { WARRANTY_PERIODS } from '../../common/constants/service-options';

// The owner correcting a job's warranty after it was logged.
export class ChangeWarrantyDto {
  @IsIn(WARRANTY_PERIODS)
  warrantyPeriod: (typeof WARRANTY_PERIODS)[number];

  @ValidateIf((dto) => dto.warrantyPeriod === 'custom')
  @Type(() => Date)
  @IsDate()
  customWarrantyDate?: Date;
}
