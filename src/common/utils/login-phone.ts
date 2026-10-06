/**
 * Phone numbers as a login: technicians rarely have a work email, and making
 * the owner invent one ("ravi123@gmail.com") was the first place adding a
 * team member stalled.
 *
 * A number is stored and looked up as digits only, with the country code —
 * "+91 98470 12345", "098470 12345" and "9847012345" are the same login.
 * A bare 10-digit number is taken as Indian, which is who types it that way.
 * A trunk "0" after the country code ("+91 098470 12345") and the code typed
 * twice ("91919847012345", a paste on top of a prefilled +91) are dropped.
 */
export function loginPhoneDigits(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))
    digits = `91${digits.slice(1)}`;
  if (digits.length === 10) digits = `91${digits}`;
  digits = withoutRepeats(digits);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

// Local-number length after each dial code the app offers. Only these are
// tidied, so a number from anywhere else is kept exactly as typed.
const NATIONAL_LENGTH: [string, number][] = [
  ['971', 9],
  ['966', 9],
  ['974', 8],
  ['968', 8],
  ['965', 8],
  ['973', 8],
  ['91', 10],
  ['1', 10],
  ['44', 10],
];

function withoutRepeats(digits: string): string {
  for (const [code, len] of NATIONAL_LENGTH) {
    if (!digits.startsWith(code)) continue;
    let rest = digits.slice(code.length).replace(/^0+/, '');
    while (rest.length > len && rest.startsWith(code)) {
      rest = rest.slice(code.length).replace(/^0+/, '');
    }
    return rest.length === len ? `${code}${rest}` : digits;
  }
  return digits;
}

// A member added by phone alone still needs a value in the unique, required
// email column. This one can never be typed, never receives mail (.invalid
// is reserved), and is blanked out of every API response.
export const PHONE_ONLY_EMAIL_DOMAIN = 'phone-login.invalid';

export function phoneOnlyEmail(digits: string): string {
  const tag = Math.random().toString(36).slice(2, 8);
  return `p${digits}.${tag}@${PHONE_ONLY_EMAIL_DOMAIN}`;
}

export function isPhoneOnlyEmail(email: string | undefined | null): boolean {
  return !!email && email.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`);
}

// Whether a login box holds a phone number rather than an email.
export function looksLikePhone(identifier: string): boolean {
  return !identifier.includes('@') && loginPhoneDigits(identifier) !== null;
}
