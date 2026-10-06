import { buildUpiLink } from './upi';

describe('UPI pay links', () => {
  it('fills in the amount and the invoice number', () => {
    const link = buildUpiLink({
      upiIdOrLink: 'vt@okaxis',
      payeeName: 'Vincent Traders',
      amount: 1737,
      note: 'INV-0142',
    })!;
    const u = new URL(link);
    expect(u.searchParams.get('pa')).toBe('vt@okaxis');
    expect(u.searchParams.get('am')).toBe('1737.00');
    expect(u.searchParams.get('cu')).toBe('INR');
    expect(u.searchParams.get('tn')).toBe('INV-0142');
    expect(link).not.toContain('+');
  });

  it('adds the amount to a bank-issued upi:// QR too', () => {
    const link = buildUpiLink({
      upiIdOrLink: 'upi://pay?pa=shop@hdfc&pn=Shop&mc=5411',
      payeeName: 'x',
      amount: 500,
    })!;
    const u = new URL(link);
    expect(u.searchParams.get('pa')).toBe('shop@hdfc');
    expect(u.searchParams.get('mc')).toBe('5411');
    expect(u.searchParams.get('am')).toBe('500.00');
  });

  it('never puts an amount on a non-rupee invoice, and leaves unknown QR text alone', () => {
    const link = buildUpiLink({
      upiIdOrLink: 'vt@okaxis',
      payeeName: 'x',
      amount: 50,
      currency: 'AED',
    })!;
    expect(new URL(link).searchParams.get('am')).toBeNull();
    expect(
      buildUpiLink({ upiIdOrLink: 'BANKQR123', payeeName: 'x', amount: 5 }),
    ).toBe('BANKQR123');
    expect(buildUpiLink({ upiIdOrLink: '', payeeName: 'x' })).toBeNull();
  });
});
