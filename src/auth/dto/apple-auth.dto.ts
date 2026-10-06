import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AppleAuthDto {
  // The identity token returned by expo-apple-authentication on the client
  // — verified server-side against Apple's public keys before it's trusted.
  @IsString()
  identityToken: string;

  // Apple sends the user's name only once, on the very first authorization
  // — the client passes it along here since there's no other way to get it.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  // The one-time authorization code from the same Apple sign-in. Exchanged
  // for a refresh token so account deletion can revoke the app's access at
  // Apple (App Store Review Guideline 5.1.1(v)). Optional: older app builds
  // do not send it.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  authorizationCode?: string;
}
