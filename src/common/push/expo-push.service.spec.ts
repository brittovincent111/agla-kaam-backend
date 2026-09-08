import { collectInvalidTokens } from './expo-push.service';

// A token that no longer maps to an installed app is retried forever unless
// it is cleared, so the classification matters.
describe('collectInvalidTokens', () => {
  const messages = [
    { to: 'tok-a', title: 't', body: 'b' },
    { to: 'tok-b', title: 't', body: 'b' },
    { to: 'tok-c', title: 't', body: 'b' },
  ];

  it('returns nothing when every ticket succeeded', () => {
    expect(
      collectInvalidTokens(messages, [
        { status: 'ok', id: '1' },
        { status: 'ok', id: '2' },
        { status: 'ok', id: '3' },
      ]),
    ).toEqual([]);
  });

  it('picks out only the permanently dead tokens, by position', () => {
    expect(
      collectInvalidTokens(messages, [
        { status: 'ok', id: '1' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: '3' },
      ]),
    ).toEqual(['tok-b']);
  });

  it('leaves a token alone for a transient error', () => {
    // Worth retrying tomorrow — clearing it would silently unsubscribe a
    // working device because Expo was briefly rate limiting us.
    expect(
      collectInvalidTokens(messages, [
        { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } },
        { status: 'error', message: 'oops', details: {} },
        { status: 'error', message: 'no details' },
      ]),
    ).toEqual([]);
  });

  it('does NOT clear tokens when our own push credentials are wrong', () => {
    // Expo returns this with fault: 'developer' when the FCM/APNs server key
    // is missing — the device is fine. Treating it as permanent would wipe
    // every push token in the database on the first run after a
    // misconfiguration, and every user would have to reopen the app.
    // Verified against the live Expo API with credentials deliberately unset.
    expect(
      collectInvalidTokens(messages, [
        {
          status: 'error',
          message:
            'Unable to retrieve the FCM server key for the recipient\'s app.',
          details: { error: 'InvalidCredentials', fault: 'developer' },
        },
      ]),
    ).toEqual([]);
  });

  it('survives a short or ragged ticket array', () => {
    expect(collectInvalidTokens(messages, [])).toEqual([]);
    expect(
      collectInvalidTokens(messages, [
        undefined as never,
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ]),
    ).toEqual(['tok-b']);
  });
});
