import { IsIn, IsOptional, IsString } from 'class-validator';
import { ListPageDto } from '../../common/pagination/list-page.dto';

export class ListInventoryDto extends ListPageDto {
  /**
   * Narrows the catalogue to stocked parts or to labour lines. The list
   * screen shows both, but a purchase picker only ever wants products —
   * filtering on the server keeps that from depending on what happens to
   * have been paged in.
   */
  @IsOptional()
  @IsString()
  @IsIn(['all', 'product', 'service'])
  type?: string;
}
