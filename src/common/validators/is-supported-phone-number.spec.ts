import { validateSync } from 'class-validator';
import { IsSupportedPhoneNumber } from './is-supported-phone-number';
import { phoneMatchPatterns } from '../utils/phone-match';

class Dto {
  @IsSupportedPhoneNumber()
  phone!: string;
}

function accepts(phone: string): boolean {
  const dto = new Dto();
  dto.phone = phone;
  return validateSync(dto).length === 0;
}

// Every country the app's picker offers and Settings sells must be storable.
// `@IsPhoneNumber('IN')` accepted only the first two of these.
describe('IsSupportedPhoneNumber', () => {
  it.each([
    ['+919876543210', 'India E.164'],
    ['9876543210', 'India bare national (legacy clients)'],
    ['+971501234567', 'UAE'],
    ['+966501234567', 'Saudi Arabia'],
    ['+97433123456', 'Qatar'],
    ['+96891234567', 'Oman'],
    ['+96550123456', 'Kuwait'],
    ['+97336001234', 'Bahrain'],
    ['+12124567890', 'United States'],
    ['+447911123456', 'United Kingdom'],
  ])('accepts %s (%s)', (phone) => {
    expect(accepts(phone)).toBe(true);
  });

  it.each([
    [''],
    ['   '],
    ['not-a-number'],
    ['+1'],
    ['12345'],
  ])('still rejects %p', (phone) => {
    expect(accepts(phone)).toBe(false);
  });
});

describe('phoneMatchPatterns', () => {
  it('matches an Indian customer across every stored spelling', () => {
    const forE164 = phoneMatchPatterns('+919876543210');
    // A tail pattern, so it also finds rows saved as "9876543210".
    expect(forE164).toEqual(['9876543210$']);
    expect(phoneMatchPatterns('098765 43210')).toEqual(['9876543210$']);
    expect(phoneMatchPatterns('9876543210')).toEqual(['9876543210$']);
  });

  it('requires the full number for a non-Indian one', () => {
    // A bare 10-digit tail would let a UAE and a US number collide.
    const patterns = phoneMatchPatterns('+971501234567');
    expect(patterns).toContain('971501234567$');
  });

  it('does not produce a pattern that a different country could satisfy', () => {
    // The real collision, found by hitting a live API: Saudi and UAE mobiles
    // share the national tail "501234567", so any pattern shorter than the
    // full number makes one a duplicate of the other.
    const uae = phoneMatchPatterns('+971501234567');
    const saudi = phoneMatchPatterns('+966501234567');
    expect(uae.some((p) => new RegExp(p).test('966501234567'))).toBe(false);
    expect(saudi.some((p) => new RegExp(p).test('971501234567'))).toBe(false);

    const us = phoneMatchPatterns('+12124567890');
    expect(uae.some((p) => new RegExp(p).test('12124567890'))).toBe(false);
    expect(us.some((p) => new RegExp(p).test('971501234567'))).toBe(false);
  });

  it('still recognises the same non-Indian number re-entered', () => {
    const patterns = phoneMatchPatterns('+971501234567');
    expect(patterns.some((p) => new RegExp(p).test('971501234567'))).toBe(true);
  });

  it('returns nothing for an unusable value rather than matching everything', () => {
    expect(phoneMatchPatterns('')).toEqual([]);
    expect(phoneMatchPatterns('abc')).toEqual([]);
  });
});
