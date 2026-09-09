import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ListPageDto } from '../../common/pagination/list-page.dto';

export class ListProformaInvoicesDto extends ListPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerId?: string;
}
