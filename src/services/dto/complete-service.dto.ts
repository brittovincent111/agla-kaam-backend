import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceLocationDto } from './service-location.dto';

export class CompleteServiceDto {
  /**
   * Where the technician actually was when they finished the job.
   *
   * Optional, and this is the only moment the app can trust a live GPS read:
   * the log form offers capture while a visit is being *scheduled*, which is
   * usually from the office, so it recorded the wrong place. Completing a job
   * happens at the door.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceLocationDto)
  location?: ServiceLocationDto;

  /**
   * When the job was actually finished, for a completion the app saved
   * offline (no signal at the customer's) and sent later. Without it the job
   * would be recorded as done when the phone found signal, and its warranty
   * and next visit would count from then.
   */
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  /**
   * The completion sheet's "next service" answer: book the next visit this
   * far ahead, or on this date, or not at all. Omitted by older app builds,
   * which book the next visit through their own log form — so nothing is
   * created automatically unless the app asks.
   */
  @IsOptional()
  @IsIn(['1m', '3m', '6m', '1y'])
  nextVisitInterval?: '1m' | '3m' | '6m' | '1y';

  @IsOptional()
  @IsDateString()
  nextVisitDate?: string;

  @IsOptional()
  @IsBoolean()
  skipNextVisit?: boolean;

  /**
   * What the customer paid at the door. Omitted means "not asked" (older
   * apps), which records nothing.
   */
  @IsOptional()
  @IsIn(['cash', 'upi', 'unpaid'])
  collectionMethod?: 'cash' | 'upi' | 'unpaid';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  collectionAmount?: number;
}

// The owner correcting a completed job's door payment.
export class CorrectCollectionDto {
  @IsIn(['cash', 'upi', 'unpaid'])
  collectionMethod: 'cash' | 'upi' | 'unpaid';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  collectionAmount?: number;
}
