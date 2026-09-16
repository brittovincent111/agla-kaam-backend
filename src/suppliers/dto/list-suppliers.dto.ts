import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListSuppliersDto {
  // Matched against name and phone, server-side. The app used to download
  // every supplier and filter in JavaScript.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // Opaque continuation token from the previous page's `nextCursor`.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
