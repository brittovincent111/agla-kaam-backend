import { IsEmail } from 'class-validator';

export class SendSignupOtpDto {
  @IsEmail()
  email: string;
}
