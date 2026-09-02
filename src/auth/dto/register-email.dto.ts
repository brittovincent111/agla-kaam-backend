import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterEmailDto {
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
}
