import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { APPROVAL_MODES } from '../schemas/autopilot.schemas';
import { AUTOPILOT_LANGUAGES } from '../autopilot-defaults';

export class UpdateAutopilotSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(APPROVAL_MODES as unknown as string[]) approvalMode?: (typeof APPROVAL_MODES)[number];
  @IsOptional() @IsInt() @Min(0) @Max(100000) searchFreeMonthly?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) whatsappMaxPerDay?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5000) emailStartPerDay?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(2) emailGrowth?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50000) emailMaxPerDay?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) emailAfterWhatsappDays?: number;
  @IsOptional() @IsString() @MaxLength(100) senderName?: string;
  @IsOptional() @IsEmail() senderEmail?: string;
  @IsOptional() @ValidateIf((o) => o.replyTo !== '') @IsEmail() replyTo?: string;
  @IsOptional() @ValidateIf((o) => o.notifyEmail !== '') @IsEmail() notifyEmail?: string;
  // { ml: { emailSubject, emailBody, emailFollowUp, followUpDays, whatsappTemplate, whatsappLanguage, headerImageUrl } }
  @IsOptional() @IsObject() messages?: Record<string, any>;
}

export class RegionPlaceDto {
  @IsOptional() @IsString() @MaxLength(60) state?: string;
  @IsString() @IsNotEmpty() @MaxLength(60) city: string;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) localities?: string[];
}

export class AutopilotRegionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(AUTOPILOT_LANGUAGES as unknown as string[]) language?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RegionPlaceDto) places?: RegionPlaceDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsNumber() @Min(0) @Max(10) weight?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() useWhatsapp?: boolean;
  @IsOptional() @IsBoolean() useEmail?: boolean;
}

export class DayKeyParam {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dayKey: string;
}
