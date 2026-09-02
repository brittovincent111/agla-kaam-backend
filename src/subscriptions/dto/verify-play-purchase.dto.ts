import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyPlayPurchaseDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  purchaseToken: string;
}
