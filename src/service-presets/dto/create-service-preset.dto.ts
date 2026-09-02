import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateServicePresetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  messageTemplate?: string;
}
