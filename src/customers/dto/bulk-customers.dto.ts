import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// One row of an import. Kept loose on purpose: a bad phone number or an
// empty name is reported back for that row, not a reason to reject the
// other 199.
export class BulkCustomerRow {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(40)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class BulkCustomersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkCustomerRow)
  customers: BulkCustomerRow[];

  @IsOptional()
  @IsIn(['contacts', 'manual'])
  source?: 'contacts' | 'manual';
}
