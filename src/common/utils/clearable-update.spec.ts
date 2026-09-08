import { splitClearableUpdate } from './clearable-update';

// A business must be able to remove payment details it once entered — a stale
// bank account or UPI id printing on every invoice is worse than none at all.
describe('splitClearableUpdate', () => {
  it('writes ordinary values with $set', () => {
    expect(splitClearableUpdate({ name: 'CoolBreeze', acceptsCash: true })).toEqual({
      $set: { name: 'CoolBreeze', acceptsCash: true },
    });
  });

  it('clears a payment field sent as an empty string', () => {
    expect(splitClearableUpdate({ paymentUpiId: '' })).toEqual({
      $unset: { paymentUpiId: '' },
    });
  });

  it('treats whitespace as a clear, not a value', () => {
    expect(splitClearableUpdate({ paymentBankName: '   ' })).toEqual({
      $unset: { paymentBankName: '' },
    });
  });

  it('mixes writes and clears in one update', () => {
    expect(
      splitClearableUpdate({
        name: 'CoolBreeze',
        paymentUpiId: 'cool@okaxis',
        paymentAccountNumber: '',
        acceptsCash: false,
      }),
    ).toEqual({
      $set: { name: 'CoolBreeze', paymentUpiId: 'cool@okaxis', acceptsCash: false },
      $unset: { paymentAccountNumber: '' },
    });
  });

  it('ignores keys that were not sent at all', () => {
    expect(splitClearableUpdate({ name: 'CoolBreeze', paymentUpiId: undefined })).toEqual({
      $set: { name: 'CoolBreeze' },
    });
  });

  it('never emits an empty $set, which MongoDB rejects', () => {
    const update = splitClearableUpdate({ paymentUpiId: '' });
    expect(update.$set).toBeUndefined();
  });

  it('does not treat an empty non-payment field as a clear', () => {
    // Only the fields named in CLEARABLE_TEXT_FIELDS opt into this; blanking
    // anything else keeps its existing (pre-existing) behaviour.
    expect(splitClearableUpdate({ tradeType: '' })).toEqual({
      $set: { tradeType: '' },
    });
  });

  it('keeps a legitimately falsy boolean out of the clear path', () => {
    expect(splitClearableUpdate({ acceptsCash: false })).toEqual({
      $set: { acceptsCash: false },
    });
  });
});
