import { toWhatsAppNumber } from './phone';

describe('toWhatsAppNumber', () => {
  it.each([
    ['9847012345', '919847012345'],
    ['09847012345', '919847012345'],
    ['+91 98470 12345', '919847012345'],
    ['919847012345', '919847012345'],
    ['91919847012345', '919847012345'],
    // Indian numbers that start like Gulf codes stay Indian.
    ['97412 34567', '919741234567'],
    ['9661234567', '919661234567'],
    ['9715012345', '919715012345'],
  ])('India: %s -> %s', (raw, want) => expect(toWhatsAppNumber(raw)).toBe(want));

  it.each([
    ['+971 50 123 4567', '971501234567'],
    ['00971501234567', '971501234567'],
    ['971501234567', '971501234567'],
    ['+966 55 123 4567', '966551234567'],
  ])('Gulf: %s -> %s', (raw, want) => expect(toWhatsAppNumber(raw)).toBe(want));

  it('empty stays empty', () => expect(toWhatsAppNumber('')).toBe(''));
});
