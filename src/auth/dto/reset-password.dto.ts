import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
