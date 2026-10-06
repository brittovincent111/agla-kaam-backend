import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class SendSignupOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email: string;
}
