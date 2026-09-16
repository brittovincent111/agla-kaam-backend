import { IsDateString, IsMongoId, IsOptional } from 'class-validator';

export class RescheduleServiceDto {
  // When THIS job is due. Moving it is what the Services list follows:
  // dueStatus() and the server's due-window buckets both read serviceDate,
  // so a reschedule that only touched nextServiceDate looked like it did
  // nothing.
  //
  // Optional, and so is nextServiceDate: already-installed app versions send
  // only nextServiceDate and must keep working, and a pure reassign sends
  // neither.
  @IsOptional()
  @IsDateString()
  serviceDate?: string;

  // When the FOLLOWING visit falls. Still what the completed-service
  // "Next Service Reminder" row moves.
  @IsOptional()
  @IsDateString()
  nextServiceDate?: string;

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
