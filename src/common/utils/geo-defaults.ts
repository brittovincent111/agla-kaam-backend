export interface GeoDefaults {
  country: string;
  currency: string;
  timezone: string;
  taxType: 'gst' | 'vat' | 'sales_tax' | 'none';
  /** Shown in country pickers, so the client never keeps its own list. */
  label: string;
  /** Pickers show these verbatim; the app keeps no wording of its own. */
  currencyLabel: string;
  timezoneLabel: string;
  flag: string;
  /** Seeds the phone field, so a UAE business is not offered +91. */
  dialCode: string;
  /** What this country calls the tax: "GST", "VAT", "Sales Tax". */
  taxLabel: string;
  /**
   * The statutory rates a business can charge. Empty means the rate cannot be
   * stated for the whole country — there is no VAT at all (Qatar, Kuwait), or
   * it varies locally (US sales tax) — and the tax calculator hides itself
   * rather than inventing a number.
   */
  taxRates: number[];
  /**
   * India splits GST into CGST + SGST/UTGST on an intra-state invoice. No
   * other country here does, so showing that split anywhere else is wrong.
   */
  splitsTax: boolean;
}

// The single source of truth for what a country implies — used both to seed
// a new business from their phone number, and (via geoDefaultsForCountry) to
// resolve what a subscription actually costs. Pricing must derive from this
// map, not from Business.currency: that field is user-editable at any time
// (for invoicing display — a business may legitimately invoice customers in a
// currency other than its own), so treating it as authoritative for billing
// would let a subscription's price be picked by whoever fills in a form.
const GEO_DEFAULTS_BY_COUNTRY: Record<string, GeoDefaults> = {
  IN: {
    currencyLabel: 'INR (₹)', timezoneLabel: 'Asia/Kolkata (IST +5:30)',
    country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', taxType: 'gst',
    label: 'India', flag: '🇮🇳', dialCode: '+91',
    taxLabel: 'GST', taxRates: [5, 12, 18, 28], splitsTax: true,
  },
  AE: {
    currencyLabel: 'AED (د.إ)', timezoneLabel: 'Asia/Dubai (GST +4:00)',
    country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', taxType: 'vat',
    label: 'United Arab Emirates', flag: '🇦🇪', dialCode: '+971',
    taxLabel: 'VAT', taxRates: [5], splitsTax: false,
  },
  SA: {
    currencyLabel: 'SAR (﷼)', timezoneLabel: 'Asia/Riyadh (AST +3:00)',
    country: 'SA', currency: 'SAR', timezone: 'Asia/Riyadh', taxType: 'vat',
    label: 'Saudi Arabia', flag: '🇸🇦', dialCode: '+966',
    taxLabel: 'VAT', taxRates: [15], splitsTax: false,
  },
  QA: {
    currencyLabel: 'QAR (﷼)', timezoneLabel: 'Asia/Qatar (AST +3:00)',
    country: 'QA', currency: 'QAR', timezone: 'Asia/Qatar', taxType: 'none',
    label: 'Qatar', flag: '🇶🇦', dialCode: '+974',
    taxLabel: 'Tax', taxRates: [], splitsTax: false,
  },
  OM: {
    currencyLabel: 'OMR (﷼)', timezoneLabel: 'Asia/Muscat (GST +4:00)',
    country: 'OM', currency: 'OMR', timezone: 'Asia/Muscat', taxType: 'vat',
    label: 'Oman', flag: '🇴🇲', dialCode: '+968',
    taxLabel: 'VAT', taxRates: [5], splitsTax: false,
  },
  KW: {
    currencyLabel: 'KWD (د.ك)', timezoneLabel: 'Asia/Kuwait (AST +3:00)',
    country: 'KW', currency: 'KWD', timezone: 'Asia/Kuwait', taxType: 'none',
    label: 'Kuwait', flag: '🇰🇼', dialCode: '+965',
    taxLabel: 'Tax', taxRates: [], splitsTax: false,
  },
  BH: {
    currencyLabel: 'BHD (.د.ب)', timezoneLabel: 'Asia/Bahrain (AST +3:00)',
    country: 'BH', currency: 'BHD', timezone: 'Asia/Bahrain', taxType: 'vat',
    label: 'Bahrain', flag: '🇧🇭', dialCode: '+973',
    taxLabel: 'VAT', taxRates: [10], splitsTax: false,
  },
  US: {
    currencyLabel: 'USD ($)', timezoneLabel: 'America/New_York (ET -5:00)',
    country: 'US', currency: 'USD', timezone: 'America/New_York', taxType: 'sales_tax',
    label: 'United States', flag: '🇺🇸', dialCode: '+1',
    taxLabel: 'Sales Tax', taxRates: [], splitsTax: false,
  },
};

/** Every country, for the settings picker. */
export function allGeoDefaults(): GeoDefaults[] {
  return Object.values(GEO_DEFAULTS_BY_COUNTRY);
}

export const KNOWN_COUNTRY_CODES = Object.keys(GEO_DEFAULTS_BY_COUNTRY);

const DEFAULT_GEO = GEO_DEFAULTS_BY_COUNTRY.IN;

// Order matters: '+1' must be checked after every other prefix, since it's a
// single digit and would otherwise never let a more specific prefix match.
const DIAL_CODE_TO_COUNTRY: [prefix: string, country: string][] = [
  ['971', 'AE'],
  ['966', 'SA'],
  ['974', 'QA'],
  ['968', 'OM'],
  ['965', 'KW'],
  ['973', 'BH'],
  ['1', 'US'],
];

export function geoDefaultsForCountry(country?: string): GeoDefaults {
  if (!country) return DEFAULT_GEO;
  return GEO_DEFAULTS_BY_COUNTRY[country.toUpperCase()] ?? DEFAULT_GEO;
}

export function isKnownCountryCode(country: string): boolean {
  return country.toUpperCase() in GEO_DEFAULTS_BY_COUNTRY;
}

export function inferBusinessGeoDefaults(phone?: string): GeoDefaults {
  if (!phone) return DEFAULT_GEO;

  const clean = phone.replace(/\s+/g, '');
  for (const [code, country] of DIAL_CODE_TO_COUNTRY) {
    // '+1' only, deliberately not bare '1' — unlike the other codes here, a
    // single digit is too weak a signal to match without the explicit '+'.
    if (code === '1') {
      if (clean.startsWith('+1')) return geoDefaultsForCountry(country);
      continue;
    }
    if (clean.startsWith(`+${code}`) || clean.startsWith(code)) {
      return geoDefaultsForCountry(country);
    }
  }

  return DEFAULT_GEO;
}
