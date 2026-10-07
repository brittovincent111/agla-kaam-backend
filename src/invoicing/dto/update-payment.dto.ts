import { PartialType } from '@nestjs/mapped-types';
import { RecordPaymentDto } from './record-payment.dto';

// Correcting a payment already recorded — every field optional, each one
// validated exactly as when the payment was first recorded.
export class UpdatePaymentDto extends PartialType(RecordPaymentDto) {}
