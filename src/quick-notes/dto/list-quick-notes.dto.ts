import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListQuickNotesDto {
  @IsOptional()
  @IsIn(['all', 'active', 'completed'])
  status?: 'all' | 'active' | 'completed' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
