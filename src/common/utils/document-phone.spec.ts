import { documentPhone } from './document-phone';
import { splitClearableUpdate } from './clearable-update';

describe('documentPhone', () => {
  it('prints the phone chosen for documents', () => {
    expect(documentPhone({ phone: '+919847012345', documentPhone: '+91 80000 11111' })).toBe('+91 80000 11111');
  });

  it('falls back to the registered phone when none is set or it is blank', () => {
    expect(documentPhone({ phone: '+919847012345' })).toBe('+919847012345');
    expect(documentPhone({ phone: '+919847012345', documentPhone: '   ' })).toBe('+919847012345');
  });

  it('can be cleared from the profile form', () => {
    expect(splitClearableUpdate({ documentPhone: '' })).toEqual({ $unset: { documentPhone: '' } });
  });
});
