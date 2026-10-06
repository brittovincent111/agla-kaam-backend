import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, ValidateIf } from 'class-validator';

// One login form for everyone: an email, or a phone number (how technicians
// added by phone sign in). Older apps send `email` only, which still works.
export class LoginEmailDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: LoginEmailDto) => !o.phone)
  @IsEmail()
  email?: string;

  @ValidateIf((o: LoginEmailDto) => !o.email)
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @MaxLength(200)
  password: string;
}
