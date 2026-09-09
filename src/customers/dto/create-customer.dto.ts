import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsSupportedPhoneNumber } from '../../common/validators/is-supported-phone-number';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsSupportedPhoneNumber()
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string;

  @IsOptional()
  @IsIn(['contacts', 'manual'])
  source?: 'contacts' | 'manual';
}
