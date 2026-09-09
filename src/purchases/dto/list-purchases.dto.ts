import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ListPageDto } from '../../common/pagination/list-page.dto';

export class ListPurchasesDto extends ListPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentStatus?: string;
}
