import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StarterPackDto {
  // The trade to load for. Omitted: the business's saved trade.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tradeType?: string;
}
