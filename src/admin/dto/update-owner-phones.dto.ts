import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Admin: how many phones an owner's login works on, or sign them all out. */
export class UpdateOwnerPhonesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPhones?: number;

  @IsOptional()
  @IsBoolean()
  signOutAll?: boolean;
}
