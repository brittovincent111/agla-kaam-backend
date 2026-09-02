export const QUOTATION_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'converted',
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
