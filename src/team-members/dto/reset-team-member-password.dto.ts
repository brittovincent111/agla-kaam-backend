import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetTeamMemberPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;
}
