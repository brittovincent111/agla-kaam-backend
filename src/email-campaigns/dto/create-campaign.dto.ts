import {
  ArrayMaxSize,
  IsInt,
  Max,
  Min,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CampaignLeadFiltersDto {
  @IsOptional()
  @IsString()
  status?: string;

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
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CampaignFollowUpDto {
  @IsInt()
  @Min(1)
  @Max(30)
  delayDays: number;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  subject?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  subject: string;

  @IsString()
  @IsNotEmpty()
  htmlContent: string;

  @IsOptional()
  @IsString()
  emailContent?: string;

  // Send the plain-text body only (no HTML part).
  @IsOptional()
  @IsBoolean()
  plainTextOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @IsOptional()
  @IsEmail()
  senderEmail?: string;

  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignLeadFiltersDto)
  leadFilters?: CampaignLeadFiltersDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedLeadIds?: string[];

  @IsOptional()
  @IsBoolean()
  skipAlreadyEmailed?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CampaignFollowUpDto)
  followUps?: CampaignFollowUpDto[];
}
