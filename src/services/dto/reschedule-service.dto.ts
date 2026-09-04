import { IsDateString, IsMongoId, IsOptional } from 'class-validator';

export class RescheduleServiceDto {
  @IsDateString()
  nextServiceDate: string;

  // Owner-only (enforced in ServicesService.reschedule, not here — this DTO
  // doesn't have the caller's role available). Omit the field to leave the
  // current assignment untouched; pass null to clear an override back to the
  // customer's default technician; pass an id to reassign to that technician.
  // Same IsOptional + IsMongoId pairing as UpdateCustomerDto.assignedTechnicianId
  // — IsOptional skips validation for both null and undefined, so IsMongoId
  // only ever runs against a real id.
  @IsOptional()
  @IsMongoId()
  assignedTechnicianId?: string | null;
}
