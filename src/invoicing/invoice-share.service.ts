import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// A link a customer can open to see their invoice PDF without an account —
// what a payment reminder attaches, so "please send the invoice" stops being
// the reply to every reminder.
//
// Signed with a key derived from JWT_SECRET rather than JWT_SECRET itself:
// these tokens are handed to customers, and one must never verify as an API
// login token (or the reverse). The token names one invoice of one business
// and expires; nothing else can be reached with it.
const SHARE_TTL = '60d';

interface SharePayload {
  inv: string;
  biz: string;
  typ: 'invoice-share';
}

@Injectable()
export class InvoiceShareService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private secret(): string {
    return `${this.configService.get<string>('JWT_SECRET')}::invoice-share`;
  }

  createToken(businessId: string, invoiceId: string): string {
    const payload: SharePayload = {
      inv: invoiceId,
      biz: businessId,
      typ: 'invoice-share',
    };
    return this.jwtService.sign(payload, {
      secret: this.secret(),
      expiresIn: SHARE_TTL,
    });
  }

  // Null for anything that is not a live share token of ours.
  verify(token: string): { businessId: string; invoiceId: string } | null {
    try {
      const payload = this.jwtService.verify<SharePayload>(token, {
        secret: this.secret(),
      });
      if (payload.typ !== 'invoice-share' || !payload.inv || !payload.biz)
        return null;
      return { businessId: payload.biz, invoiceId: payload.inv };
    } catch {
      return null;
    }
  }

  /**
   * The public URL for a token. PUBLIC_API_URL when configured (the address
   * customers can reach, e.g. https://agla-kaam-api.velocrew.in); otherwise
   * the host this request arrived on.
   */
  url(token: string, requestBase?: string): string {
    const configured = this.configService
      .get<string>('PUBLIC_API_URL')
      ?.replace(/\/+$/, '');
    const base = configured || requestBase?.replace(/\/+$/, '') || '';
    return `${base}/api/public/invoices/${token}`;
  }
}
