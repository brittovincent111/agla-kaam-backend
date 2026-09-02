import { IsString } from 'class-validator';

export class GoogleAuthDto {
  // The ID token returned by the Google Sign-In SDK on the client —
  // verified server-side against Google's public keys before it's trusted.
  @IsString()
  idToken: string;
}
