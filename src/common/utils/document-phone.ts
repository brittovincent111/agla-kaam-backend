/**
 * The number customers see: the owner's "phone on documents" when set, else
 * the registered phone. The registered phone also signs the owner in and is
 * how the web checkout finds the account, so it is not changed for this.
 */
export function documentPhone(business: {
  documentPhone?: string | null;
  phone?: string | null;
}): string | undefined {
  return business.documentPhone?.trim() || business.phone || undefined;
}
