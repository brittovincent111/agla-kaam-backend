import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateQuickNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsDateString()
  reminderAt?: string | null;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
