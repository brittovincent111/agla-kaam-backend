// Builds the patterns that decide whether an incoming phone number is the
// same person as one already stored.
//
// Matching on "the last 10 digits" was correct while the product was
// India-only, but it is unsafe internationally: a UAE mobile
// (+971 50 123 4567) and a US number can share a 10-digit tail and would be
// reported as duplicates of each other. Conversely the same Indian customer
// may be stored as "9876543210", "098765 43210" or "+919876543210" and must
// still be recognised.
//
// So: for an Indian number keep the lenient 10-digit tail (that is where the
// mixed-format legacy rows are), and for anything else require the full
// digit string to match.
export function phoneMatchPatterns(rawPhone: string): string[] {
  const digits = (rawPhone ?? '').replace(/\D/g, '');
  if (!digits) return [];

  const isIndian =
    rawPhone.trim().startsWith('+91') ||
    digits.startsWith('91') && digits.length === 12 ||
    digits.length <= 11;

  if (isIndian) {
    const national = digits.slice(-10);
    return national ? [`${national}$`] : [];
  }

  // Full digits only. An earlier version of this also matched the national
  // part without the country code, to catch rows saved before country codes
  // were collected — but that reintroduced the very collision it was meant to
  // avoid: Saudi +966 50 123 4567 and UAE +971 50 123 4567 share the tail
  // "501234567", so adding the second number reported the first as a
  // duplicate. There are no country-code-less non-Indian rows anyway; the
  // product was India-only before country codes existed.
  return [`${digits}$`];
}
