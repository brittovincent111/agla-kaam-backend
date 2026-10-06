import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RunEmailFinderDto {
  @IsOptional()
  @IsString()
  city?: string;

  // Searched locality; "-" means whole-city searches.
  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  // Also look again at websites checked in the last 30 days.
  @IsOptional()
  @IsBoolean()
  recheck?: boolean;
}
