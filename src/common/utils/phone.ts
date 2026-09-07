// Customer phone numbers are stored in whatever shape they were entered in:
// "+918086922644" (what the app sends now), but also "8086922644" and
// "08086922644" from before the number field split the dialling code out, and
// from contact cards.

const DEFAULT_COUNTRY_CODE = '91';
const NATIONAL_LENGTH = 10;

/**
 * The digits a wa.me link needs: full international, no "+".
 *
 * A link missing its country code does not fail loudly — WhatsApp guesses the
 * country from the recipient's SIM and then reports "Couldn't look up phone
 * number ... Check your phone's Internet connection", which reads like a
 * network fault rather than a malformed link. Normalising here means a
 * customer saved without +91 still gets a working link.
 */
export function toWhatsAppNumber(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= NATIONAL_LENGTH) {
    return `${DEFAULT_COUNTRY_CODE}${digits}`;
  }
  const national = digits.slice(-NATIONAL_LENGTH);
  // Strips the international access prefix ("00") and the trunk "0".
  const prefix = digits.slice(0, -NATIONAL_LENGTH).replace(/^0+/, '');
  return `${prefix || DEFAULT_COUNTRY_CODE}${national}`;
}
