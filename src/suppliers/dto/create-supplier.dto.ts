import {
  IsEmail,
  ValidateIf,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsSupportedPhoneNumber } from '../../common/validators/is-supported-phone-number';

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  // Same validator the customer book uses, so a supplier's number is held to
  // the identical country rules and the app can reuse PhoneField unchanged.
  @IsSupportedPhoneNumber()
  phone: string;

  // An empty string is how the edit screen clears the field, and @IsEmail
  // rejects it — saving a supplier that simply has no email came back as
  // "email must be an email". ValidateIf lets "" through to clear it while
  // still rejecting a malformed address.
  @IsOptional()
  @ValidateIf((o: { email?: string }) => o.email !== '')
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsIn(['contacts', 'manual'])
  source?: 'contacts' | 'manual';
}
