import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { SUBSCRIPTION_TIERS, SubscriptionTier } from '../../common/constants/subscription-options';

// This endpoint is intentionally unauthenticated (a website visitor buying a
// plan isn't logged in to anything), which makes real input validation more
// important here, not less — nothing about the caller is otherwise trusted.
// No `currency` field for the same reason as CreateOrderDto: price is always
// derived server-side from the looked-up business's own country.
export class CreateWebOrderDto {
  @IsString()
  @MinLength(3)
  identifier: string;

  @IsIn(SUBSCRIPTION_TIERS)
  tier: SubscriptionTier;

  @IsOptional()
  @IsBoolean()
  teamEnabled?: boolean;
}
