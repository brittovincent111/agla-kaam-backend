import {
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsPhoneNumber('IN')
  phone: string;

  @IsOptional()
  @IsIn(['contacts', 'manual'])
  source?: 'contacts' | 'manual';
}
