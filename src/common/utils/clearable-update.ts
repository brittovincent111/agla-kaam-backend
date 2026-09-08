// Optional text fields a business can legitimately blank out again. An empty
// string in an update means "clear this", which has to become a $unset:
// simply omitting the key — which is what `value || undefined` produces on
// the client — leaves the stored value untouched, so a business that changed
// banks would go on printing a stale account number on every invoice.
export const CLEARABLE_TEXT_FIELDS = [
  'paymentUpiId',
  'paymentBankName',
  'paymentAccountNumber',
  'paymentAccountCode',
] as const;

export interface ClearableUpdate {
  $set?: Record<string, unknown>;
  $unset?: Record<string, ''>;
}

// Splits an update into the fields being written and the ones being cleared.
// Kept as a pure function in its own module so it can be unit-tested without
// pulling the whole BusinessesService (and Mongoose) into the test.
export function splitClearableUpdate(dto: Record<string, unknown>): ClearableUpdate {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};

  for (const [key, value] of Object.entries(dto)) {
    if (value === undefined) continue;
    const clearable = (CLEARABLE_TEXT_FIELDS as readonly string[]).includes(key);
    if (clearable && typeof value === 'string' && value.trim() === '') {
      unset[key] = '';
    } else {
      set[key] = value;
    }
  }

  // MongoDB rejects an empty $set, so each operator is only included when it
  // actually has something to do.
  return {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
  };
}
