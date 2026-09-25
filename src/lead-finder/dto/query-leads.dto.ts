import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { LEAD_STATUSES, LeadStatus } from '../schemas/lead.schema';

export class QueryLeadsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 25;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(LEAD_STATUSES)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  hasPhone?: 'true' | 'false';

  @IsOptional()
  @IsString()
  hasWebsite?: 'true' | 'false';

  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'businessName' | 'rating' | 'reviewCount';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
