import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CallbackDto {
  @IsDateString()
  date: string;

  // What the customer reported. Becomes the new visit's notes.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
