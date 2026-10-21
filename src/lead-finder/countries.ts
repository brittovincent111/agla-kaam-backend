/**
 * Countries lead search and outreach know beyond India. Google gets the
 * country name as written here, leads keep it in `country`, and phone
 * numbers are put in +<code> form by it.
 */

export const INDIA = 'India';
export const UAE = 'United Arab Emirates';

export const OUTREACH_COUNTRIES = [INDIA, UAE] as const;

export function isUae(country?: string | null): boolean {
  const c = (country ?? '').trim().toLowerCase();
  return c === 'united arab emirates' || c === 'uae';
}

/** A UAE number written any local way ("050 123 4567", "04 123 4567", "00971…") as digits with 971. */
export function uaeDigits(raw: string): string | undefined {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('971')) return d.length >= 11 && d.length <= 12 ? d : undefined;
  if (d.startsWith('0') && (d.length === 9 || d.length === 10)) return `971${d.slice(1)}`;
  if (d.length === 8 || d.length === 9) return `971${d}`;
  return undefined;
}

/** UAE mobiles are 05x xxx xxxx (50, 52–56, 58); everything else is a landline or toll-free. */
export function isUaeMobile(digits971: string): boolean {
  return /^9715[0-8]\d{7}$/.test(digits971);
}

/** A WhatsApp number (digits, with or without +) in the UAE. */
export function isUaePhone(phone?: string | null): boolean {
  return (phone ?? '').replace(/\D/g, '').startsWith('971');
}
