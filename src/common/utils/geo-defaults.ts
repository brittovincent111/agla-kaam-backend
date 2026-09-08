export interface GeoDefaults {
  country: string;
  currency: string;
  timezone: string;
  taxType: 'gst' | 'vat' | 'sales_tax' | 'none';
}

// The single source of truth for what a country implies — used both to seed
// a new business from their phone number, and (via geoDefaultsForCountry) to
// resolve what a subscription actually costs. Pricing must derive from this
// map, not from Business.currency: that field is user-editable at any time
// (for invoicing display — a business may legitimately invoice customers in a
// currency other than its own), so treating it as authoritative for billing
// would let a subscription's price be picked by whoever fills in a form.
const GEO_DEFAULTS_BY_COUNTRY: Record<string, GeoDefaults> = {
  IN: { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', taxType: 'gst' },
  AE: { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai', taxType: 'vat' },
  SA: { country: 'SA', currency: 'SAR', timezone: 'Asia/Riyadh', taxType: 'vat' },
  QA: { country: 'QA', currency: 'QAR', timezone: 'Asia/Qatar', taxType: 'none' },
  OM: { country: 'OM', currency: 'OMR', timezone: 'Asia/Muscat', taxType: 'vat' },
  KW: { country: 'KW', currency: 'KWD', timezone: 'Asia/Kuwait', taxType: 'none' },
  BH: { country: 'BH', currency: 'BHD', timezone: 'Asia/Bahrain', taxType: 'vat' },
  US: { country: 'US', currency: 'USD', timezone: 'America/New_York', taxType: 'sales_tax' },
};

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
