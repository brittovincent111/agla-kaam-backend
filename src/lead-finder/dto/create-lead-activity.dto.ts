import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LEAD_ACTIVITY_TYPES, LeadActivityType } from '../schemas/lead-activity.schema';

export class CreateLeadActivityDto {
  @IsEnum(LEAD_ACTIVITY_TYPES)
  type: LeadActivityType;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
