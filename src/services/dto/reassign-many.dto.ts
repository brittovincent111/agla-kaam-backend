import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsOptional,
} from 'class-validator';

export class ReassignManyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  serviceIds: string[];

  // Omitted or null: leave them with nobody.
  @IsOptional()
  @IsMongoId()
  assignedTechnicianId?: string | null;

  // The owner is doing these themself. Ignores assignedTechnicianId.
  @IsOptional()
  @IsBoolean()
  toOwner?: boolean;
}
