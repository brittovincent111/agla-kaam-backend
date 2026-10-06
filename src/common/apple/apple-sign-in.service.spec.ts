import { Logger } from '@nestjs/common';
import { AppleSignInService } from './apple-sign-in.service';

describe('AppleSignInService', () => {
  const configured: Record<string, string> = {
    APPLE_TEAM_ID: 'TEAM123',
    APPLE_SIGNIN_KEY_ID: 'KEY123',
    APPLE_SIGNIN_PRIVATE_KEY: 'pem',
  };

  const build = (env: Record<string, string>) => {
    const service = new AppleSignInService({
      get: (key: string) => env[key],
    } as never);
    // Signing is jose's job; stub it so these run without a real key.
    (service as any).clientSecret = async () => 'client-secret';
    return service;
  };

  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });
  afterEach(() => jest.restoreAllMocks());

  // decodeJwt comes from jose through a dynamic import (see the service).
  const stubDecodedSub = (sub: string) => {
    const realEval = global.eval;
    jest.spyOn(global, 'eval').mockImplementation(((src: string) =>
      src === 'import("jose")'
        ? Promise.resolve({ decodeJwt: () => ({ sub }) })
        : realEval(src)) as never);
  };

  it('skips both calls, with a single warning, when not configured', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = build({});

    expect(await service.exchangeAuthorizationCode('code', 'sub')).toBeNull();
    expect(await service.revokeRefreshToken('token')).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns the refresh token for the same Apple user', async () => {
    stubDecodedSub('apple-sub-1');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ refresh_token: 'refresh-1', id_token: 'x.y.z' }),
    });

    const token = await build(configured).exchangeAuthorizationCode(
      'code',
      'apple-sub-1',
    );

    expect(token).toBe('refresh-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://appleid.apple.com/auth/token');
    expect(init.body).toContain('grant_type=authorization_code');
    expect(init.body).toContain('client_id=com.aglakaam.app');
  });

  it('refuses a code that belongs to a different Apple user', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    stubDecodedSub('someone-else');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ refresh_token: 'refresh-1', id_token: 'x.y.z' }),
    });

    expect(
      await build(configured).exchangeAuthorizationCode('code', 'apple-sub-1'),
    ).toBeNull();
  });

  it('revokes a refresh token, and never throws when Apple fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = build(configured);

    fetchMock.mockResolvedValueOnce({ ok: true });
    expect(await service.revokeRefreshToken('refresh-1')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    expect(init.body).toContain('token=refresh-1');
    expect(init.body).toContain('token_type_hint=refresh_token');

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await service.revokeRefreshToken('refresh-1')).toBe(false);
  });
});
