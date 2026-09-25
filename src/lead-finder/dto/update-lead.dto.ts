import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { LEAD_STATUSES, LeadStatus } from '../schemas/lead.schema';

export class UpdateLeadDto {
  @IsOptional()
  @IsEnum(LEAD_STATUSES)
  status?: LeadStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;
}
