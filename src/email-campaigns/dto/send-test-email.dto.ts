import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendTestEmailDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsString()
  previewLeadId?: string;
}
