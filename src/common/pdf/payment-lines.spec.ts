import { accountCodeLabel, paymentLines } from './document-render';

// The "Payment Information" block on four of the five layouts. It has to stay
// off the page entirely when a business has entered nothing, and label the
// account code correctly per country.
describe('paymentLines', () => {
  it('is empty when a business has set no payment details', () => {
    expect(paymentLines({ name: 'CoolBreeze' })).toEqual([]);
  });

  it('lists only the details that were actually entered', () => {
    expect(
      paymentLines({ name: 'CoolBreeze', paymentUpiId: 'cool@okaxis' }),
    ).toEqual([{ label: 'UPI', value: 'cool@okaxis' }]);
  });

  it('combines bank name and account number onto one line', () => {
    expect(
      paymentLines({
        name: 'CoolBreeze',
        paymentBankName: 'HDFC Bank',
        paymentAccountNumber: '****4127',
      }),
    ).toEqual([{ label: 'Bank', value: 'HDFC Bank · ****4127' }]);
  });

  it('shows a bank name on its own when no account number is set', () => {
    expect(
      paymentLines({ name: 'CoolBreeze', paymentBankName: 'HDFC Bank' }),
    ).toEqual([{ label: 'Bank', value: 'HDFC Bank' }]);
  });

  it('names the account code per country', () => {
    expect(
      paymentLines({
        name: 'CoolBreeze',
        country: 'IN',
        paymentAccountCode: 'HDFC0001234',
      }),
    ).toEqual([{ label: 'IFSC', value: 'HDFC0001234' }]);
    expect(
      paymentLines({
        name: 'Gulf Cool',
        country: 'AE',
        paymentAccountCode: 'AE07033123456789',
      }),
    ).toEqual([{ label: 'IBAN', value: 'AE07033123456789' }]);
  });

  it('only mentions cash when the business opted in', () => {
    expect(paymentLines({ name: 'CoolBreeze', acceptsCash: true })).toEqual([
      { label: 'Cash', value: 'Accepted' },
    ]);
    expect(paymentLines({ name: 'CoolBreeze', acceptsCash: false })).toEqual([]);
  });

  it('prints nothing when the business has switched the block off', () => {
    // Details stay stored — a business turning this off is choosing not to
    // publish them, not deleting them.
    expect(
      paymentLines({
        name: 'CoolBreeze',
        paymentUpiId: 'cool@okaxis',
        paymentBankName: 'HDFC Bank',
        acceptsCash: true,
        showPaymentDetailsOnInvoice: false,
      }),
    ).toEqual([]);
  });

  it('treats the switch as on when it was never set', () => {
    // Businesses that existed before the switch did must keep seeing their
    // payment details.
    expect(
      paymentLines({ name: 'CoolBreeze', paymentUpiId: 'cool@okaxis' }),
    ).toEqual([{ label: 'UPI', value: 'cool@okaxis' }]);
    expect(
      paymentLines({
        name: 'CoolBreeze',
        paymentUpiId: 'cool@okaxis',
        showPaymentDetailsOnInvoice: true,
      }),
    ).toEqual([{ label: 'UPI', value: 'cool@okaxis' }]);
  });

  it('orders the lines the way an invoice reads them', () => {
    const lines = paymentLines({
      name: 'CoolBreeze',
      country: 'IN',
      paymentUpiId: 'cool@okaxis',
      paymentBankName: 'HDFC Bank',
      paymentAccountNumber: '****4127',
      paymentAccountCode: 'HDFC0001234',
      acceptsCash: true,
    });
    expect(lines.map((line) => line.label)).toEqual(['UPI', 'Bank', 'IFSC', 'Cash']);
  });
});

describe('accountCodeLabel', () => {
  it('uses the right name for each supported market', () => {
    expect(accountCodeLabel('IN')).toBe('IFSC');
    expect(accountCodeLabel('US')).toBe('Routing No.');
    expect(accountCodeLabel('AE')).toBe('IBAN');
    expect(accountCodeLabel(undefined)).toBe('IBAN');
  });
});
