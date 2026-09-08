import { amountInWords } from './amount-in-words';

// The Formal layout prints this on every invoice, so a wrong word is a wrong
// legal document. Two numbering systems and three minor-unit precisions make
// it worth covering properly.
describe('amountInWords — Indian system (INR)', () => {
  it('reads plain amounts', () => {
    expect(amountInWords(0, 'INR')).toBe('Rupees Zero Only');
    expect(amountInWords(1, 'INR')).toBe('Rupees One Only');
    expect(amountInWords(19, 'INR')).toBe('Rupees Nineteen Only');
    expect(amountInWords(20, 'INR')).toBe('Rupees Twenty Only');
    expect(amountInWords(72, 'INR')).toBe('Rupees Seventy Two Only');
    expect(amountInWords(100, 'INR')).toBe('Rupees One Hundred Only');
    expect(amountInWords(999, 'INR')).toBe('Rupees Nine Hundred Ninety Nine Only');
  });

  it('groups as thousand / lakh / crore, not million', () => {
    expect(amountInWords(1000, 'INR')).toBe('Rupees One Thousand Only');
    expect(amountInWords(100000, 'INR')).toBe('Rupees One Lakh Only');
    expect(amountInWords(1000000, 'INR')).toBe('Rupees Ten Lakh Only');
    expect(amountInWords(10000000, 'INR')).toBe('Rupees One Crore Only');
    expect(amountInWords(12345678, 'INR')).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    );
  });

  it('names the minor unit', () => {
    expect(amountInWords(7177.64, 'INR')).toBe(
      'Rupees Seven Thousand One Hundred Seventy Seven and Paise Sixty Four Only',
    );
    expect(amountInWords(0.5, 'INR')).toBe('Rupees Zero and Paise Fifty Only');
  });

  it('rounds to the currency precision before spelling it out', () => {
    // Not "...Eight Hundred Ninety Nine and Paise One Hundred".
    expect(amountInWords(1899.999, 'INR')).toBe('Rupees One Thousand Nine Hundred Only');
    expect(amountInWords(1899.994, 'INR')).toBe(
      'Rupees One Thousand Eight Hundred Ninety Nine and Paise Ninety Nine Only',
    );
  });
});

describe('amountInWords — international system', () => {
  it('groups as thousand / million / billion', () => {
    expect(amountInWords(1000000, 'USD')).toBe('Dollars One Million Only');
    expect(amountInWords(2500000, 'AED')).toBe('Dirhams Two Million Five Hundred Thousand Only');
    expect(amountInWords(1000000000, 'USD')).toBe('Dollars One Billion Only');
  });

  it('uses each currency its own major and minor unit names', () => {
    expect(amountInWords(12.34, 'USD')).toBe('Dollars Twelve and Cents Thirty Four Only');
    expect(amountInWords(12.34, 'AED')).toBe('Dirhams Twelve and Fils Thirty Four Only');
    expect(amountInWords(12.34, 'SAR')).toBe('Riyals Twelve and Halalas Thirty Four Only');
    expect(amountInWords(12.34, 'GBP')).toBe('Pounds Twelve and Pence Thirty Four Only');
  });

  it('honours 3-decimal Gulf currencies', () => {
    // 1000 fils to the dinar — 12.345 is 345 fils, not 35 cents.
    expect(amountInWords(12.345, 'KWD')).toBe(
      'Dinars Twelve and Fils Three Hundred Forty Five Only',
    );
    expect(amountInWords(12.345, 'BHD')).toBe(
      'Dinars Twelve and Fils Three Hundred Forty Five Only',
    );
    expect(amountInWords(5.006, 'OMR')).toBe('Rials Five and Baisa Six Only');
  });

  it('falls back to the ISO code for a currency it has no words for', () => {
    expect(amountInWords(42, 'JPY')).toBe('JPY Forty Two Only');
  });

  it('handles a negative amount', () => {
    expect(amountInWords(-50, 'INR')).toBe('Minus Rupees Fifty Only');
  });
});
