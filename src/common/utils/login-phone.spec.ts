import {
  isPhoneOnlyEmail,
  loginPhoneDigits,
  looksLikePhone,
  phoneOnlyEmail,
} from './login-phone';

describe('login phone', () => {
  it('treats the usual ways of writing one Indian number as the same login', () => {
    for (const raw of [
      '+91 98470 12345',
      '9847012345',
      '098470 12345',
      '0091-98470-12345',
      '919847012345',
      '09847012345',
      '+91 09847 012345',
      '91919847012345',
      '+91 91 98470 12345',
    ]) {
      expect(loginPhoneDigits(raw)).toBe('919847012345');
    }
  });

  it('keeps other country codes as typed', () => {
    expect(loginPhoneDigits('+1 415 555 0100')).toBe('14155550100');
    expect(loginPhoneDigits('+971 50 123 4567')).toBe('971501234567');
    expect(loginPhoneDigits('+971 050 123 4567')).toBe('971501234567');
    expect(loginPhoneDigits('971971501234567')).toBe('971501234567');
    expect(loginPhoneDigits('+966 55 123 4567')).toBe('966551234567');
    expect(loginPhoneDigits('+974 3312 3456')).toBe('97433123456');
    expect(loginPhoneDigits('+968 9123 4567')).toBe('96891234567');
    expect(loginPhoneDigits('+965 5123 4567')).toBe('96551234567');
    expect(loginPhoneDigits('+973 3612 3456')).toBe('97336123456');
  });

  it('reads a bare Indian mobile that starts like a Gulf code as Indian', () => {
    expect(loginPhoneDigits('97412 34567')).toBe('919741234567');
    expect(loginPhoneDigits('9661234567')).toBe('919661234567');
    expect(loginPhoneDigits('9123456789')).toBe('919123456789');
  });

  it('rejects things that are not a phone number', () => {
    expect(loginPhoneDigits('')).toBeNull();
    expect(loginPhoneDigits('12345')).toBeNull();
    expect(loginPhoneDigits(undefined)).toBeNull();
    expect(looksLikePhone('ravi@example.com')).toBe(false);
    expect(looksLikePhone('98470 12345')).toBe(true);
  });

  it('makes a stand-in email that is recognisable and never real', () => {
    const email = phoneOnlyEmail('919847012345');
    expect(email).toMatch(/^p919847012345\.[a-z0-9]+@phone-login\.invalid$/);
    expect(isPhoneOnlyEmail(email)).toBe(true);
    expect(isPhoneOnlyEmail('ravi@gmail.com')).toBe(false);
  });
});
