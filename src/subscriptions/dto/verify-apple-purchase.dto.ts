import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyApplePurchaseDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  // The signed transaction JWS expo-iap returns as Purchase.purchaseToken
  // on iOS — the backend decodes it to find the transactionId and then
  // asks Apple directly whether it's real, never trusting it as-is.
  @IsString()
  @IsNotEmpty()
  purchaseToken: string;
}
