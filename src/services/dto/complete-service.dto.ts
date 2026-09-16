import { IsOptional, ValidateNested } from 'class-validator';
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
}
