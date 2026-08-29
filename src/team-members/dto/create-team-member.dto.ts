import { IsPhoneNumber, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeamMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsPhoneNumber('IN')
  phone: string;
}
