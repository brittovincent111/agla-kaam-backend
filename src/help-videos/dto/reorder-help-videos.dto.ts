import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsMongoId,
} from 'class-validator';

export class ReorderHelpVideosDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsMongoId({ each: true })
  ids: string[];
}
