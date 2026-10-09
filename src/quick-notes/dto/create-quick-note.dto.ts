import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateQuickNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @IsOptional()
  @IsDateString()
  reminderAt?: string | null;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
