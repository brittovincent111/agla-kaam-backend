import { IsString, MinLength } from 'class-validator';

export class LookupAccountDto {
  @IsString()
  @MinLength(3)
  identifier: string;
}
