import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PRODUCTION_HOST = 'https://api.storekit.itunes.apple.com';
const SANDBOX_HOST = 'https://api.storekit-sandbox.itunes.apple.com';
const JWT_TTL_SECONDS = 55 * 60; // Apple caps this token at 1 hour.

// Subset of the App Store Server API's JWSTransactionDecodedPayload we
// actually use.
// https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
interface AppleTransactionInfo {
  transactionId?: string;
  productId?: string;
  expiresDate?: number;
  revocationDate?: number;
}

export interface ApplePurchaseVerification {
  isActive: boolean;
  transactionId: string;
  productId: string;
}

// Talks to Apple's App Store Server API server-to-server, mirroring
// GooglePlayVerificationService's role: a client-reported purchase is
// never trusted without an independent check against the store itself.
@Injectable()
export class AppleVerificationService {
  private signingKeyPromise?: Promise<CryptoKey>;

  constructor(private readonly configService: ConfigService) {}

  private isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('APPLE_IAP_KEY_ID') &&
      this.configService.get<string>('APPLE_IAP_ISSUER_ID') &&
      this.configService.get<string>('APPLE_IAP_PRIVATE_KEY'),
    );
  }

  private getBundleId(): string {
    return (
      this.configService.get<string>('APPLE_BUNDLE_ID') ?? 'com.aglakaam.app'
    );
  }

  private getHost(): string {
    const env = this.configService.get<string>('APPLE_IAP_ENVIRONMENT');
    return env === 'sandbox' ? SANDBOX_HOST : PRODUCTION_HOST;
  }

  private async getSigningKey(): Promise<CryptoKey> {
    if (!this.signingKeyPromise) {
      const pem = this.configService.get<string>('APPLE_IAP_PRIVATE_KEY');
      if (!pem) {
        throw new InternalServerErrorException(
          'Apple in-app purchase is not configured on this server.',
        );
      }
      // .env files can't hold real newlines — the key is stored with
      // literal "\n" sequences and unescaped here, same convention as
      // other multi-line secrets.
      const { importPKCS8 } = await (eval('import("jose")') as Promise<typeof import('jose')>);
      this.signingKeyPromise = importPKCS8(pem.replace(/\\n/g, '\n'), 'ES256');
    }
    return this.signingKeyPromise;
  }

  private async signRequestJWT(): Promise<string> {
    const keyId = this.configService.get<string>('APPLE_IAP_KEY_ID');
    const issuerId = this.configService.get<string>('APPLE_IAP_ISSUER_ID');
    if (!keyId || !issuerId) {
      throw new InternalServerErrorException(
        'Apple in-app purchase is not configured on this server.',
      );
    }
    const key = await this.getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const { SignJWT } = await (eval('import("jose")') as Promise<typeof import('jose')>);
    return new SignJWT({ bid: this.getBundleId() })
      .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
      .setIssuer(issuerId)
      .setIssuedAt(now)
      .setExpirationTime(now + JWT_TTL_SECONDS)
      .setAudience('appstoreconnect-v1')
      .sign(key);
  }

  // Given the raw signed transaction (the JWS expo-iap surfaces as
  // Purchase.purchaseToken on iOS), pulls the transactionId out of it —
  // this is only used to know which transaction to ask Apple about next;
  // it is not itself trusted as proof of anything.
  async extractTransactionId(signedTransaction: string): Promise<string> {
    if (!signedTransaction || typeof signedTransaction !== 'string') {
      throw new BadRequestException('This purchase token is not valid.');
    }
    const trimmed = signedTransaction.trim();

    if (trimmed.includes('.')) {
      try {
        const { decodeJwt } = await (eval('import("jose")') as Promise<typeof import('jose')>);
        const payload = decodeJwt(trimmed) as AppleTransactionInfo;
        if (payload?.transactionId) {
          return payload.transactionId;
        }
      } catch {
        throw new BadRequestException('This purchase token is not valid.');
      }
    }

    if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return trimmed;
    }

    throw new BadRequestException(
      'Could not read a transaction id from this purchase.',
    );
  }

  async verifyTransaction(
    transactionId: string,
  ): Promise<ApplePurchaseVerification> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException(
        'Apple in-app purchase is not configured on this server.',
      );
    }
    const jwt = await this.signRequestJWT();
    const primaryHost = this.getHost();
    const fallbackHost =
      primaryHost === PRODUCTION_HOST ? SANDBOX_HOST : PRODUCTION_HOST;

    let response = await fetch(
      `${primaryHost}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );

    // If primary host fails (e.g. TestFlight transaction sent to Production host or vice versa), fallback.
    if (!response.ok) {
      console.log(
        `[AppleVerificationService] Primary host (${primaryHost}) returned ${response.status}. Trying fallback host (${fallbackHost})...`,
      );
      const fallbackResponse = await fetch(
        `${fallbackHost}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      if (fallbackResponse.ok) {
        response = fallbackResponse;
      }
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '<unreadable>');
      console.error(
        `[AppleVerificationService] Apple API returned ${response.status}: ${errorBody}`,
      );
      return { isActive: false, transactionId, productId: '' };
    }
    const body = (await response.json()) as { signedTransactionInfo?: string };
    if (!body.signedTransactionInfo) {
      console.error(
        '[AppleVerificationService] response missing signedTransactionInfo:',
        body,
      );
      return { isActive: false, transactionId, productId: '' };
    }
    // The transport itself is the trust boundary here — this response came
    // straight from Apple's own API over HTTPS in reply to our own signed
    // request, so decoding (not re-verifying) the JWS payload is enough,
    // the same trust model used for Google Play's subscriptionsv2.get.
    const { decodeJwt } = await (eval('import("jose")') as Promise<typeof import('jose')>);
    const info = decodeJwt(body.signedTransactionInfo) as AppleTransactionInfo;
    const isActive =
      !info.revocationDate &&
      (!info.expiresDate || info.expiresDate > Date.now());

    return {
      isActive,
      transactionId: info.transactionId ?? transactionId,
      productId: info.productId ?? '',
    };
  }
}
