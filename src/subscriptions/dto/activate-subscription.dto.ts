import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { SUBSCRIPTION_TIERS, SubscriptionTier } from '../../common/constants/subscription-options';

export class ActivateSubscriptionDto {
  @IsIn(SUBSCRIPTION_TIERS)
  tier: SubscriptionTier;

  @IsOptional()
  @IsBoolean()
  teamEnabled?: boolean;
}
