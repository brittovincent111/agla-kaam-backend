import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { SUBSCRIPTION_TIERS, SubscriptionTier } from '../../common/constants/subscription-options';

// No `currency` field, deliberately — the price is always derived server-side
// from the business's own country (see SubscriptionsService.createOrder).
// Accepting a currency here would let whoever fills in this request choose
// what they get charged.
export class CreateOrderDto {
  @IsIn(SUBSCRIPTION_TIERS)
  tier: SubscriptionTier;

  @IsOptional()
  @IsBoolean()
  teamEnabled?: boolean;
}
