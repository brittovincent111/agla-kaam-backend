import { IsOptional, IsString } from 'class-validator';

export class AppleAuthDto {
  // The identity token returned by expo-apple-authentication on the client
  // — verified server-side against Apple's public keys before it's trusted.
  @IsString()
  identityToken: string;

  // Apple sends the user's name only once, on the very first authorization
  // — the client passes it along here since there's no other way to get it.
  @IsOptional()
  @IsString()
  fullName?: string;
}
