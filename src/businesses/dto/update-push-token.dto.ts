import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdatePushTokenDto {
  // Expo issues these as `ExponentPushToken[...]`. Validated so a malformed
  // value is rejected at the edge rather than stored and silently failing on
  // every send. This endpoint previously took an unvalidated inline object.
  @IsString()
  @MaxLength(200)
  @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/, {
    message: 'pushToken must be an Expo push token.',
  })
  pushToken: string;
}
