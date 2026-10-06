import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

/** Admin edit of a business's plan, Team access and technician seats. */
export class UpdateBusinessSubscriptionDto {
  @IsIn(['free', 'active', 'expired'])
  subscriptionStatus: 'free' | 'active' | 'expired';

  // reminders | invoicing | combo ('combo_team' from the old form = combo with Team)
  @IsOptional()
  @IsString()
  @IsIn(['reminders', 'invoicing', 'combo', 'combo_team'])
  tier?: string;

  @IsOptional()
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsBoolean()
  teamEnabled?: boolean;

  // Seats granted to this company (null = back to the standard limit).
  @IsOptional()
  @ValidateIf((o) => o.teamSeatLimit !== null)
  @IsInt()
  @Min(1)
  @Max(500)
  teamSeatLimit?: number | null;
}
