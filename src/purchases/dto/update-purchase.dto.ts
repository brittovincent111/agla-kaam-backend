import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreatePurchaseDto } from './create-purchase.dto';

// Everything a purchase was logged with can be corrected except the
// currency, and paymentStatus is left out on purpose: on an edit the status
// is always re-derived from amountPaid (sent, or the one already recorded),
// so the two can never disagree. The purchase number is never editable.
export class UpdatePurchaseDto extends PartialType(
  OmitType(CreatePurchaseDto, ['currency', 'paymentStatus'] as const),
) {}
