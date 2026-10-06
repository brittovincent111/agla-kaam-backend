import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTeamMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  // Optional now: a technician can sign in with their phone number instead.
  // One of the two is required.
  @ValidateIf((o: CreateTeamMemberDto) => !!o.email || !o.phone)
  @IsEmail()
  email?: string;

  // Six is enough for a password the owner picks and passes on by hand; the
  // login route is rate-limited per device.
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;

  @ValidateIf((o: CreateTeamMemberDto) => !o.email || !!o.phone)
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;

  @IsOptional()
  @IsIn(['technician', 'manager'])
  role?: string;
}
