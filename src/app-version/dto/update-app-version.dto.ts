import { IsIn, IsOptional, IsString, MaxLength, Validate } from 'class-validator';
import { IsVersionString } from './is-version-string.validator';

export class UpdateAppVersionDto {
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';

  @Validate(IsVersionString)
  minimumVersion: string;

  @Validate(IsVersionString)
  latestVersion: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}
