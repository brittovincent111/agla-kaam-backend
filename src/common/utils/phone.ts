// Customer phone numbers are stored in whatever shape they were entered in:
// "+918086922644" (what the app sends now), but also "8086922644" and
// "08086922644" from before the number field split the dialling code out, and
// from contact cards.

const DEFAULT_COUNTRY_CODE = '91';

/**
 * The digits a wa.me link needs: full international, no "+".
 * Correctly preserves international dialling codes (e.g. +971 for UAE, +966 for KSA).
 */
export function toWhatsAppNumber(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';

  // If already in E.164 format starting with +, return digits only
  if (trimmed.startsWith('+')) {
    return trimmed.replace(/\D/g, '');
  }

  // Handle international 00 prefix (e.g. 00971501234567 -> 971501234567)
  if (trimmed.startsWith('00')) {
    return trimmed.slice(2).replace(/\D/g, '');
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // A bare number of Indian length is Indian, whatever it starts with:
  // "97412 34567" is a Jio number, not Qatar, and "96xxxxxxxx" not Saudi.
  if (digits.length === 10) return `${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) {
    return `${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  }

  // Longer than a local number: it already carries a country code. A
  // pasted "+91" on top of "91…" (14 digits) loses the repeat.
  if (digits.length === 14 && digits.startsWith('9191')) return digits.slice(2);
  const knownPrefixes = [
    '971',
    '966',
    '974',
    '968',
    '965',
    '973',
    '91',
    '1',
    '44',
  ];
  const hasKnownPrefix = knownPrefixes.some(
    (p) => digits.startsWith(p) && digits.length >= p.length + 7,
  );
  if (hasKnownPrefix) {
    return digits;
  }

  // Anything else is taken as a local number.
  return `${DEFAULT_COUNTRY_CODE}${digits.replace(/^0+/, '')}`;
}
