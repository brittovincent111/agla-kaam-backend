import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import { ShortLink, ShortLinkDocument } from './short-link.schema';
import { publicWebBase } from '../common/public/public-urls';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_PATTERN = /^[A-Za-z0-9]{4,16}$/;

export function isShortCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export type ShareLinkKind = 'service' | 'invoice';

/**
 * What a stored long link opens: a service record or an invoice, and its
 * signed token. Read from the URL itself, so links stored before the website
 * pages existed resolve the same way. Null for anything else.
 */
export function parseShareTarget(
  target: string,
): { kind: ShareLinkKind; token: string } | null {
  let path: string;
  try {
    path = new URL(target, 'http://relative.invalid').pathname;
  } catch {
    return null;
  }
  const m =
    /^\/api\/public\/(services|invoices)\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/?$/.exec(
      path,
    );
  if (!m) return null;
  return { kind: m[1] === 'services' ? 'service' : 'invoice', token: m[2] };
}

/**
 * Turns a long signed share link into https://…/api/s/Ab3xK9q2 for WhatsApp —
 * or https://aglakaam.app/r/Ab3xK9q2 when PUBLIC_WEB_URL is set, the
 * website's page for the same record.
 *
 * The signed links are 250+ characters and filled most of the customer's
 * screen. 8 characters from 56 symbols is ~10^14 codes, far too many to
 * guess. If anything fails here the long link is used, so a share never
 * breaks because of this.
 */
@Injectable()
export class ShortLinksService {
  constructor(
    @InjectModel(ShortLink.name)
    private readonly shortLinkModel: Model<ShortLinkDocument>,
    private readonly configService: ConfigService,
  ) {}

  async shorten(
    target: string,
    ttlDays: number,
    requestBase?: string,
  ): Promise<string> {
    const web = publicWebBase(this.configService);
    const api =
      this.configService.get<string>('PUBLIC_API_URL')?.replace(/\/+$/, '') ||
      requestBase?.replace(/\/+$/, '') ||
      '';
    if (!web && !api) return target;
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeCode();
      try {
        await this.shortLinkModel.create({ code, target, expiresAt });
        return web ? `${web}/r/${code}` : `${api}/api/s/${code}`;
      } catch (err) {
        // A clash on the unique code: try another. Anything else: long link.
        if ((err as { code?: number }).code !== 11000) return target;
      }
    }
    return target;
  }

  async resolve(code: string): Promise<string | null> {
    if (!isShortCode(code)) return null;
    const link = await this.shortLinkModel
      .findOne({ code, expiresAt: { $gt: new Date() } })
      .lean()
      .exec();
    return link?.target ?? null;
  }

  // For the website's /r/:code page: which kind of page, and its token.
  async resolveShare(
    code: string,
  ): Promise<{ kind: ShareLinkKind; token: string } | null> {
    const target = await this.resolve(code);
    return target ? parseShareTarget(target) : null;
  }
}

function makeCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++)
    code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}
