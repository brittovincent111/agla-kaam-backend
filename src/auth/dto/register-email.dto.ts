import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class RegisterEmailDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  // Optional so an email-only business isn't forced to have one — several
  // screens (digital service card, WhatsApp handoff) read business.phone
  // for display, so it's worth collecting when the owner has one.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // Mandatory. While this was optional the OTP block below it was wrapped in
  // `if (code)`, so omitting the field skipped email verification entirely and
  // anyone could open an account on an address they did not own.
  // The 6-digit code emailed by send-signup-otp.
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;
}
