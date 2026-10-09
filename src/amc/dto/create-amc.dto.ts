import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateAmcDto {
  @IsMongoId()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsOptional()
  planName?: string;

  @IsString()
  @IsNotEmpty()
  serviceType: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsInt()
  @Min(1)
  totalVisits: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  contractValue?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  // A team member's id, or '' (on edit) to go back to the customer's usual
  // technician.
  @IsOptional()
  @ValidateIf((o: CreateAmcDto) => o.technicianId !== '')
  @IsMongoId()
  technicianId?: string;
}
