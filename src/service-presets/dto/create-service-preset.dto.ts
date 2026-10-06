import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// "custom" is left out on purpose: a custom warranty or next date is a date,
// which only makes sense for one job, never as a default for a type.
export const PRESET_WARRANTY_PERIODS = [
  'none',
  '30d',
  '90d',
  '6m',
  '1y',
] as const;
export const PRESET_NEXT_INTERVALS = ['none', '1m', '3m', '6m', '1y'] as const;

export class CreateServicePresetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  // An empty string clears the custom message back to the standard one.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  messageTemplate?: string;

  // null clears a default; omitted leaves it as it is.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(PRESET_WARRANTY_PERIODS)
  warrantyPeriod?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(PRESET_NEXT_INTERVALS)
  nextServiceInterval?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  defaultPrice?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(12)
  hsnCode?: string | null;
}
