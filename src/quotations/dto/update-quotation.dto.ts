import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';
import { CreateQuotationDto } from './create-quotation.dto';

// A quotation's status can only move to 'accepted' or 'rejected' through an
// explicit update — 'sent' has its own /send endpoint (mirroring Invoicing)
// and 'converted' is only ever set by QuotationsService.convert().
const UPDATABLE_QUOTATION_STATUSES = ['accepted', 'rejected'] as const;

export class UpdateQuotationDto extends PartialType(
  OmitType(CreateQuotationDto, ['customerId'] as const),
) {
  @IsOptional()
  @IsIn(UPDATABLE_QUOTATION_STATUSES)
  status?: (typeof UPDATABLE_QUOTATION_STATUSES)[number];
}
