// "Amount in words" for the Formal invoice layout.
//
// Two numbering systems, picked from the currency rather than hard-coded:
// INR groups as thousand/lakh/crore, everything else as thousand/million/
// billion. The minor-unit name also varies (paise, fils, halalas, cents), and
// a few Gulf currencies use 3 decimal places rather than 2 — printing
// "Rupees ... and 50 Cents" on a UAE invoice would be plainly wrong, so none
// of it is assumed.

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

interface CurrencyWords {
  major: string;
  minor: string;
  // Gulf currencies use 3 minor digits (1000 fils/baisa to the dinar/rial).
  minorDigits: number;
  system: 'indian' | 'international';
}

const CURRENCY_WORDS: Record<string, CurrencyWords> = {
  INR: { major: 'Rupees', minor: 'Paise', minorDigits: 2, system: 'indian' },
  AED: { major: 'Dirhams', minor: 'Fils', minorDigits: 2, system: 'international' },
  SAR: { major: 'Riyals', minor: 'Halalas', minorDigits: 2, system: 'international' },
  QAR: { major: 'Riyals', minor: 'Dirhams', minorDigits: 2, system: 'international' },
  OMR: { major: 'Rials', minor: 'Baisa', minorDigits: 3, system: 'international' },
  KWD: { major: 'Dinars', minor: 'Fils', minorDigits: 3, system: 'international' },
  BHD: { major: 'Dinars', minor: 'Fils', minorDigits: 3, system: 'international' },
  USD: { major: 'Dollars', minor: 'Cents', minorDigits: 2, system: 'international' },
  EUR: { major: 'Euros', minor: 'Cents', minorDigits: 2, system: 'international' },
  GBP: { major: 'Pounds', minor: 'Pence', minorDigits: 2, system: 'international' },
};

function belowThousand(value: number): string {
  if (value === 0) return '';
  if (value < 20) return ONES[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const ones = ONES[value % 10];
    return ones ? `${tens} ${ones}` : tens;
  }
  const hundreds = `${ONES[Math.floor(value / 100)]} Hundred`;
  const remainder = belowThousand(value % 100);
  return remainder ? `${hundreds} ${remainder}` : hundreds;
}

// thousand / lakh / crore — the grouping used on Indian tax invoices.
function indianSystem(value: number): string {
  if (value === 0) return 'Zero';
  const parts: string[] = [];

  const crore = Math.floor(value / 10000000);
  if (crore > 0) {
    parts.push(`${indianSystem(crore)} Crore`);
    value %= 10000000;
  }
  const lakh = Math.floor(value / 100000);
  if (lakh > 0) {
    parts.push(`${belowThousand(lakh)} Lakh`);
    value %= 100000;
  }
  const thousand = Math.floor(value / 1000);
  if (thousand > 0) {
    parts.push(`${belowThousand(thousand)} Thousand`);
    value %= 1000;
  }
  const rest = belowThousand(value);
  if (rest) parts.push(rest);

  return parts.join(' ');
}

const INTERNATIONAL_SCALES: [number, string][] = [
  [1_000_000_000_000, 'Trillion'],
  [1_000_000_000, 'Billion'],
  [1_000_000, 'Million'],
  [1_000, 'Thousand'],
];

function internationalSystem(value: number): string {
  if (value === 0) return 'Zero';
  const parts: string[] = [];

  for (const [scale, name] of INTERNATIONAL_SCALES) {
    if (value >= scale) {
      const count = Math.floor(value / scale);
      parts.push(`${internationalSystem(count)} ${name}`);
      value %= scale;
    }
  }
  const rest = belowThousand(value);
  if (rest) parts.push(rest);

  return parts.join(' ');
}

export function amountInWords(amount: number, currencyCode = 'INR'): string {
  const config =
    CURRENCY_WORDS[(currencyCode || 'INR').toUpperCase()] ??
    // An unmapped currency still gets a correct number, just with the ISO
    // code standing in for a major-unit name it has no word for.
    {
      major: (currencyCode || '').toUpperCase(),
      minor: '',
      minorDigits: 2,
      system: 'international' as const,
    };

  const factor = Math.pow(10, config.minorDigits);
  // Round to the currency's own precision FIRST, so 1899.999 reads as
  // "One Thousand Nine Hundred" and not "...Eight Hundred Ninety Nine and
  // 100 Paise".
  const totalMinor = Math.round(Math.abs(amount) * factor);
  const major = Math.floor(totalMinor / factor);
  const minor = totalMinor % factor;

  const toWords = config.system === 'indian' ? indianSystem : internationalSystem;
  const sign = amount < 0 ? 'Minus ' : '';
  const majorWords = `${sign}${config.major} ${toWords(major)}`.trim();

  if (minor > 0 && config.minor) {
    return `${majorWords} and ${config.minor} ${internationalSystem(minor)} Only`;
  }
  return `${majorWords} Only`;
}
