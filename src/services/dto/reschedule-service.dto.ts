import { IsDateString } from 'class-validator';

export class RescheduleServiceDto {
  @IsDateString()
  nextServiceDate: string;
}
