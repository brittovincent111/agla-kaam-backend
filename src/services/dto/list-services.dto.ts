import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListPageDto } from '../../common/pagination/list-page.dto';

export class ListServicesDto extends ListPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @IsOptional()
  @IsString()
  // One id, or several comma-separated.
  @MaxLength(1300)
  customerId?: string;

  // The overdue / due-today / upcoming split the app used to compute on the
  // device. It cannot be applied to a single page, so it is a query filter.
  @IsOptional()
  @IsIn(['overdue', 'today', 'upcoming'])
  due?: 'overdue' | 'today' | 'upcoming';

  // One technician's jobs — theirs directly, or their customers' when the
  // job has no technician of its own. Owners and managers use it; a
  // technician is already limited to their own.
  @IsOptional()
  @IsString()
  // One id, or several comma-separated.
  @MaxLength(1300)
  technicianId?: string;

  // Exact service type, any case ("AC General Service"); several are
  // separated by "|" since a type name can itself contain a comma.
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  serviceType?: string;

  // Visit date range: from inclusive, to exclusive.
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // On/off narrowing from the Filters sheet. Query strings, so 'true'.
  @IsOptional()
  @IsIn(['true', 'false'])
  amcOnly?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  callbacksOnly?: string;

  // Nobody has sent this visit a reminder yet.
  @IsOptional()
  @IsIn(['true', 'false'])
  notReminded?: string;

  // Booked visits only (a technician's Today list).
  @IsOptional()
  @IsIn(['true', 'false'])
  bookedOnly?: string;

  // The "To book" chip: reminders that need booking now.
  @IsOptional()
  @IsIn(['true', 'false'])
  toBook?: string;

  // The Filters sheet's "Booked / Not booked yet".
  @IsOptional()
  @IsIn(['booked', 'notbooked'])
  booking?: 'booked' | 'notbooked';

  // soonest: due date ascending (the default for work to do);
  // latest: newest first (the default for finished or cancelled work).
  @IsOptional()
  @IsIn(['soonest', 'latest'])
  sort?: 'soonest' | 'latest';
}
