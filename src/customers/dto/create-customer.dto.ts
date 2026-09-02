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
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsIn(['contacts', 'manual'])
  source?: 'contacts' | 'manual';
}
