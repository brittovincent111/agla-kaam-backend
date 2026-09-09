import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ListPageDto } from '../../common/pagination/list-page.dto';

export class ListServicesDto extends ListPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerId?: string;

  // The overdue / due-today / upcoming split the app used to compute on the
  // device. It cannot be applied to a single page, so it is a query filter.
  @IsOptional()
  @IsIn(['overdue', 'today', 'upcoming'])
  due?: 'overdue' | 'today' | 'upcoming';
}
