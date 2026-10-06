import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// A link to one job's service record that the customer can open and keep —
// the record the WhatsApp "service card" message points to.
//
// Signed with its own key derived from JWT_SECRET, so it can never verify as
// an API login or as an invoice link. Valid for a year: this is a record a
// customer keeps (and, later, what an appliance sticker points at), not a
// one-off.
const SHARE_TTL = '365d';

interface SharePayload {
  svc: string;
  biz: string;
  typ: 'service-share';
}

@Injectable()
export class ServiceShareService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private secret(): string {
    return `${this.configService.get<string>('JWT_SECRET')}::service-share`;
  }

  createToken(businessId: string, serviceId: string): string {
    const payload: SharePayload = {
      svc: serviceId,
      biz: businessId,
      typ: 'service-share',
    };
    return this.jwtService.sign(payload, {
      secret: this.secret(),
      expiresIn: SHARE_TTL,
    });
  }

  verify(token: string): { businessId: string; serviceId: string } | null {
    try {
      const p = this.jwtService.verify<SharePayload>(token, {
        secret: this.secret(),
      });
      if (p.typ !== 'service-share' || !p.svc || !p.biz) return null;
      return { businessId: p.biz, serviceId: p.svc };
    } catch {
      return null;
    }
  }

  url(token: string, requestBase?: string): string {
    const configured = this.configService
      .get<string>('PUBLIC_API_URL')
      ?.replace(/\/+$/, '');
    const base = configured || requestBase?.replace(/\/+$/, '') || '';
    return `${base}/api/public/services/${token}`;
  }
}
