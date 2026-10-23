import { DeduplicationService } from './deduplication.service';
import { GooglePlacesProvider } from './providers/google-places.provider';
import { isUaePhone, uaeDigits } from './countries';
import { MALAYALI_NAME, looksMalayali } from './malayali';
import { whatsappBudget } from '../common/utils/outreach-budget';
import { priceLine } from '../whatsapp-campaigns/bot-copy';

// UAE outreach: numbers in every local form, which are WhatsApp mobiles,
// whose shop reads as Kerala-run, and what a UAE message costs.

const UAE = 'United Arab Emirates';

describe('UAE phone numbers', () => {
  const dedup = new DeduplicationService({} as any);
  const places = new GooglePlacesProvider({ get: () => undefined } as any);
  const type = (p: string) => (places as any).detectPhoneType(p, UAE);

  it.each([
    ['+971 50 123 4567', '+971501234567'],
    ['050 123 4567', '+971501234567'],
    ['00971 55 765 4321', '+971557654321'],
    ['04 234 5678', '+97142345678'],
    ['56 111 2222', '+971561112222'],
  ])('%s → %s', (raw, e164) => {
    expect(dedup.normalizePhoneNumber(raw, UAE)).toBe(e164);
  });

  it('leaves Indian numbers as they were', () => {
    expect(dedup.normalizePhoneNumber('98765 43210', 'India')).toBe('+919876543210');
    expect(dedup.normalizePhoneNumber('+91 98765 43210', UAE)).toBe('+919876543210');
  });

  it('knows a UAE mobile from a landline', () => {
    expect(type('+971 50 123 4567')).toBe('mobile');
    expect(type('058 999 0000')).toBe('mobile');
    expect(type('04 234 5678')).toBe('landline');
    expect(type('800 1234')).toBe('unknown');
    expect(uaeDigits('+971 4 234 5678')).toBe('97142345678');
    expect(isUaePhone('971501234567')).toBe(true);
    expect(isUaePhone('919876543210')).toBe(false);
  });
});

describe('Malayali-run shop names', () => {
  it.each([
    'Malabar Technical Services LLC',
    'Biju AC Repairing',
    'Kerala Electrical & Sanitary',
    'Thrissur Cooling Centre',
    'Shameer Technical Works',
    'Nair Electromechanical',
    'കേരള എസി സർവീസ്',
  ])('%s', (name) => {
    expect(looksMalayali(name)).toBe(true);
    expect(MALAYALI_NAME.test(name)).toBe(true);
  });

  it('has no \\u escape MongoDB would refuse', () => {
    expect(MALAYALI_NAME.source).not.toMatch(/\\u/);
  });

  it.each(['Al Faisal Technical Services LLC', 'Emirates Cool AC', 'Ashraf Electrical', 'Lahore AC Repair', 'Palace Cooling'])(
    'not %s',
    (name) => {
      expect(looksMalayali(name)).toBe(false);
      expect(MALAYALI_NAME.test(name)).toBe(false);
    },
  );
});

describe('UAE cost and price', () => {
  it('counts a UAE message as several India ones', () => {
    const b = whatsappBudget((k) => ({ OUTREACH_MONTHLY_BUDGET_INR: '6500', WHATSAPP_COST_PER_MESSAGE_INR: '1', WHATSAPP_COST_PER_MESSAGE_INR_AE: '4' })[k]);
    expect(b.uaeFactor).toBe(4);
  });

  it('quotes dirhams to a UAE number', () => {
    expect(priceLine('en', '971501234567')).toContain('AED 49');
    expect(priceLine('en', '919876543210')).toContain('₹799');
  });
});
