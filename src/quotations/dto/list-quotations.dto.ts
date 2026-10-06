import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ListPageDto } from '../../common/pagination/list-page.dto';

export class ListQuotationsDto extends ListPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @IsOptional()
  @IsString()
  // One id, or several comma-separated (the Filters sheet's customer pick).
  @MaxLength(1300)
  customerId?: string;

  // Date range on the document's own date: from inclusive, to exclusive.
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Amount range on the document total, rupees.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'amount'])
  sort?: string;
}
