import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { WHATSAPP_PARAM_FIELDS } from '../schemas/whatsapp-campaign.schema';

export class WhatsappLeadFiltersDto {
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(40) source?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

export class CreateWhatsappCampaignDto {
  @IsString() @IsNotEmpty() @MaxLength(150)
  name: string;

  // Template names in WhatsApp Manager: lowercase letters, digits, underscores.
  @IsString() @Matches(/^[a-z0-9_]{1,512}$/, { message: 'Template name: lowercase letters, numbers and _ only' })
  templateName: string;

  @IsOptional() @IsString() @Matches(/^[a-z]{2,3}(_[A-Z]{2})?$/, { message: 'Language code like en, hi or en_US' })
  languageCode?: string;

  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Header image must be an https link' })
  headerImageUrl?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsIn(WHATSAPP_PARAM_FIELDS as unknown as string[], { each: true })
  bodyParams?: string[];

  @IsOptional() @ValidateNested() @Type(() => WhatsappLeadFiltersDto)
  leadFilters?: WhatsappLeadFiltersDto;

  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true })
  selectedLeadIds?: string[];

  @IsOptional() @IsBoolean()
  skipAlreadyMessaged?: boolean;
}

export class UpdateWhatsappCampaignDto extends PartialType(CreateWhatsappCampaignDto) {}

export class WhatsappTestSendDto {
  @IsString() @Matches(/^\+?[\d\s-]{10,20}$/, { message: 'Phone with country code, e.g. 919876543210' })
  phone: string;
}

export class WhatsappReplyDto {
  @IsString() @Matches(/^\+?[\d\s-]{10,20}$/)
  phone: string;

  @IsString() @IsNotEmpty() @MaxLength(4096)
  text: string;
}
