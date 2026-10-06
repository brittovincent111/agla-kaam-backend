import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
// Apple accepts a client secret valid for up to six months; it is minted per
// call here, so a few minutes is plenty.
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

/**
 * Sign in with Apple, server to server: turning the one-time authorization
 * code from the app into a refresh token at sign-in, and revoking that token
 * when the account is deleted (App Store Review Guideline 5.1.1(v)).
 *
 * Both are best-effort. Sign-in itself is already proved by the identity
 * token (AuthService.loginWithApple), so a failure here never blocks a login
 * or an account deletion — it is logged and skipped.
 *
 * Needs a "Sign in with Apple" key, separate from the App Store Server API
 * key the subscription code uses: APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID and
 * APPLE_SIGNIN_PRIVATE_KEY. Left unset, both calls are skipped with a single
 * warning.
 */
@Injectable()
export class AppleSignInService {
  private readonly logger = new Logger(AppleSignInService.name);
  private signingKeyPromise?: Promise<CryptoKey>;
  private warnedUnconfigured = false;

  constructor(private readonly configService: ConfigService) {}

  // The iOS bundle id is the client_id for a native app's tokens — the same
  // value the identity token's audience is checked against.
  private getClientId(): string {
    return (
      this.configService.get<string>('APPLE_BUNDLE_ID') ?? 'com.aglakaam.app'
    );
  }

  private isConfigured(): boolean {
    const ok = Boolean(
      this.configService.get<string>('APPLE_TEAM_ID') &&
      this.configService.get<string>('APPLE_SIGNIN_KEY_ID') &&
      this.configService.get<string>('APPLE_SIGNIN_PRIVATE_KEY'),
    );
    if (!ok && !this.warnedUnconfigured) {
      this.warnedUnconfigured = true;
      this.logger.warn(
        'Sign in with Apple token exchange/revoke skipped: APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID or APPLE_SIGNIN_PRIVATE_KEY is not set.',
      );
    }
    return ok;
  }

  private async getSigningKey(): Promise<CryptoKey> {
    if (!this.signingKeyPromise) {
      const pem = this.configService.get<string>('APPLE_SIGNIN_PRIVATE_KEY')!;
      // Stored with literal "\n" sequences in .env, same as the IAP key.
      const { importPKCS8 } = await (eval('import("jose")') as Promise<
        typeof import('jose')
      >);
      this.signingKeyPromise = importPKCS8(pem.replace(/\\n/g, '\n'), 'ES256');
      // A bad key must not stay cached as a rejected promise forever.
      this.signingKeyPromise.catch(() => (this.signingKeyPromise = undefined));
    }
    return this.signingKeyPromise;
  }

  // https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
  private async clientSecret(): Promise<string> {
    const key = await this.getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const { SignJWT } = await (eval('import("jose")') as Promise<
      typeof import('jose')
    >);
    return new SignJWT({})
      .setProtectedHeader({
        alg: 'ES256',
        kid: this.configService.get<string>('APPLE_SIGNIN_KEY_ID')!,
      })
      .setIssuer(this.configService.get<string>('APPLE_TEAM_ID')!)
      .setIssuedAt(now)
      .setExpirationTime(now + CLIENT_SECRET_TTL_SECONDS)
      .setAudience(APPLE_AUDIENCE)
      .setSubject(this.getClientId())
      .sign(key);
  }

  private async post(url: string, form: Record<string, string>) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  }

  /**
   * Exchanges the app's one-time authorization code for a refresh token.
   * Returns null when not configured or when Apple refuses — the caller
   * signs the user in either way.
   *
   * `expectedSub` is the Apple user the verified identity token named. The
   * code arrives in the same request but is a separate value, so the token
   * is only kept if Apple says it belongs to that same user.
   */
  async exchangeAuthorizationCode(
    code: string,
    expectedSub: string,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const response = await this.post(APPLE_TOKEN_URL, {
        client_id: this.getClientId(),
        client_secret: await this.clientSecret(),
        code,
        grant_type: 'authorization_code',
      });
      if (!response.ok) {
        // Apple's error body is a short code ("invalid_grant"), never a token.
        const body = await response.text().catch(() => '<unreadable>');
        this.logger.warn(
          `Apple authorization code exchange failed (${response.status}): ${body}`,
        );
        return null;
      }
      const body = (await response.json()) as {
        refresh_token?: string;
        id_token?: string;
      };
      // Straight from Apple over TLS, so decoding is enough here.
      const { decodeJwt } = await (eval('import("jose")') as Promise<
        typeof import('jose')
      >);
      const sub = body.id_token ? decodeJwt(body.id_token).sub : undefined;
      if (sub !== expectedSub) {
        this.logger.warn(
          'Apple authorization code belongs to a different user than the identity token — not stored.',
        );
        return null;
      }
      return body.refresh_token ?? null;
    } catch (err) {
      this.logger.warn(
        `Apple authorization code exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Revokes a stored refresh token. Never throws. */
  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const response = await this.post(APPLE_REVOKE_URL, {
        client_id: this.getClientId(),
        client_secret: await this.clientSecret(),
        token: refreshToken,
        token_type_hint: 'refresh_token',
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable>');
        this.logger.warn(
          `Apple token revoke failed (${response.status}): ${body}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Apple token revoke failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
