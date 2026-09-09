import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_PAGE_SIZE } from './cursor-page';

/**
 * Query parameters every paged list route accepts.
 *
 * Resource-specific filters (status, customerId, …) are added by subclassing
 * this, so the paging contract stays identical everywhere.
 */
export class ListPageDto {
  // Matched server-side, so it finds rows that have not been scrolled to yet.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  // Opaque continuation token from the previous page's `nextCursor`.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
