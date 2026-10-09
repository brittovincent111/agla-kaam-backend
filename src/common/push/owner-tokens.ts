export type OwnerPhones = {
  pushToken?: string | null;
  pushTokens?: string[] | null;
};

/** Every phone to reach a business's owner on, newest last, no repeats. */
export function ownerPushTokens(business: OwnerPhones): string[] {
  return [
    ...new Set([
      ...(business.pushTokens ?? []),
      ...(business.pushToken ? [business.pushToken] : []),
    ]),
  ].filter(Boolean);
}
