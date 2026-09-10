import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';

export class UpdateCustomerDto extends PartialType(
  OmitType(CreateCustomerDto, ['source'] as const),
) {
  @IsOptional()
  @IsMongoId()
  assignedTechnicianId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
