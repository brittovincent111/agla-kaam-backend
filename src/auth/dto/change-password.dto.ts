import { IsString, MaxLength, MinLength } from 'class-validator';

// Signed in, changing one's own password: the current one proves it is them.
export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword: string;

  // Six, like the password an owner sets for a technician.
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  newPassword: string;
}
