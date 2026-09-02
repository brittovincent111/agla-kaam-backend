import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAppFeedbackDto {
  @IsIn([1, 2, 3, 4, 5])
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
