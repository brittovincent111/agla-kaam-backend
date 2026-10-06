import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { LeadActivity, LeadActivityDocument } from './schemas/lead-activity.schema';

// Listings, not the business's own site: they never show the owner's email,
// and reading them is against their terms.
const SKIP_HOSTS = [
  'facebook.com', 'instagram.com', 'wa.me', 'whatsapp.com', 'google.com', 'goo.gl', 'g.page',
  'justdial.com', 'indiamart.com', 'sulekha.com', 'linkedin.com', 'youtube.com', 'twitter.com', 'x.com',
  'urbancompany.com', 'business.site', 'linktr.ee',
];
// Addresses that show up in page code but aren't anyone's inbox.
const JUNK_DOMAINS = [
  'example.com', 'example.org', 'domain.com', 'email.com', 'yourdomain.com', 'sentry.io', 'wixpress.com',
  'sentry-next.wixpress.com', 'w3.org', 'schema.org', 'godaddy.com', 'wordpress.org', 'mysite.com', 'test.com',
];
const FREE_MAIL = ['gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'icloud.com'];
const GOOD_PREFIX = ['info', 'contact', 'sales', 'service', 'services', 'enquiry', 'enquiries', 'support', 'care', 'hello', 'office', 'admin'];

const PAGE_TIMEOUT_MS = 8000;
const MAX_BYTES = 600_000;
const RECHECK_DAYS = 30;

/** One HTTP response, as much as the finder needs of it. */
export interface PageResponse {
  status: number;
  location?: string;
  contentType?: string;
  body?: string;
}

export interface EmailFinderStatus {
  running: boolean;
  checked: number;
  found: number;
  total: number;
  startedAt?: Date;
  finishedAt?: Date;
  lastError?: string;
}

/**
 * Reads a lead's own website (home page and contact page) for a business
 * email. Google Maps rarely lists emails, so without this email campaigns
 * have almost nobody to send to.
 */
@Injectable()
export class EmailFinderService {
  private readonly logger = new Logger(EmailFinderService.name);
  private state: EmailFinderStatus = { running: false, checked: 0, found: 0, total: 0 };

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadActivity.name) private readonly activityModel: Model<LeadActivityDocument>,
  ) {}

  private candidateFilter(city?: string, area?: string, recheck = false) {
    const filter: Record<string, any> = {
      website: { $exists: true, $nin: [null, ''] },
      $or: [{ email: { $exists: false } }, { email: { $in: [null, ''] } }],
      status: { $nin: ['DO_NOT_CONTACT', 'INVALID', 'INSTALLED'] },
      // Sites already checked wait RECHECK_DAYS, unless a re-check is asked for.
      ...(recheck
        ? {}
        : {
            $and: [
              {
                $or: [
                  { emailLookupAt: { $exists: false } },
                  { emailLookupAt: { $lt: new Date(Date.now() - RECHECK_DAYS * 86400_000) } },
                ],
              },
            ],
          }),
    };
    if (city?.trim()) filter.city = new RegExp(`^${escapeRx(city.trim())}$`, 'i');
    if (area !== undefined && area !== '') filter.area = area === '-' ? { $in: [null, ''] } : new RegExp(`^${escapeRx(area.trim())}$`, 'i');
    return filter;
  }

  async status(city?: string, area?: string) {
    const waiting = await this.leadModel.countDocuments(this.candidateFilter(city, area));
    return { ...this.state, waiting };
  }

  /** Starts a background run over up to `limit` leads. */
  async start(opts: { city?: string; area?: string; limit?: number; recheck?: boolean }) {
    if (this.state.running) return this.status(opts.city, opts.area);
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const leads = await this.leadModel
      .find(this.candidateFilter(opts.city, opts.area, opts.recheck === true))
      .select('_id website businessName')
      .limit(limit)
      .exec();
    this.state = { running: true, checked: 0, found: 0, total: leads.length, startedAt: new Date() };
    setImmediate(() => {
      this.runAll(leads)
        .catch((err) => {
          this.state.lastError = err.message;
          this.logger.error(`Email finder crashed: ${err.message}`);
        })
        .finally(() => {
          this.state.running = false;
          this.state.finishedAt = new Date();
        });
    });
    return this.status(opts.city, opts.area);
  }

  private async runAll(leads: LeadDocument[]) {
    // A few sites at a time: fast enough, and polite to small hosts.
    const queue = [...leads];
    const worker = async () => {
      for (let lead = queue.shift(); lead; lead = queue.shift()) {
        let email: string | null = null;
        try {
          email = await this.findForWebsite(lead.website!);
        } catch {
          email = null;
        }
        if (email) {
          const res = await this.leadModel.updateOne(
            { _id: lead._id, $or: [{ email: { $exists: false } }, { email: { $in: [null, ''] } }] },
            { $set: { email, emailSource: 'website', emailLookupAt: new Date() } },
          );
          if (res.modifiedCount) {
            this.state.found++;
            await this.activityModel.create({
              leadId: lead._id,
              type: 'OTHER',
              message: `Email found on their website: ${email}`,
              performedBy: 'System',
            });
          }
        } else {
          await this.leadModel.updateOne({ _id: lead._id }, { $set: { emailLookupAt: new Date() } });
        }
        this.state.checked++;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.logger.log(`Email finder: ${this.state.found} found in ${this.state.checked} websites.`);
  }

  /** Best email on the site, or null. Exposed for tests. */
  async findForWebsite(raw: string): Promise<string | null> {
    const home = toUrl(raw);
    if (!home || SKIP_HOSTS.some((h) => home.hostname === h || home.hostname.endsWith(`.${h}`))) return null;
    const siteDomain = home.hostname.replace(/^www\./, '');

    const found = new Set<string>();
    const first = await this.fetchPage(home);
    if (!first) return null;
    extractEmails(first.html).forEach((e) => found.add(e));
    let best = pickBest(found, siteDomain);
    if (best && best.endsWith(`@${siteDomain}`)) return best;

    // Contact pages linked from the home page, then the usual paths.
    const links = new Set<string>();
    for (const m of first.html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
      if (/contact|about|reach|enquir/i.test(m[1])) {
        try {
          const u = new URL(m[1], first.url);
          if (u.hostname === first.url.hostname) links.add(u.toString());
        } catch {
          /* ignore bad links */
        }
      }
    }
    for (const p of ['/contact', '/contact-us', '/contactus', '/about', '/about-us']) links.add(new URL(p, first.url).toString());

    for (const link of [...links].slice(0, 4)) {
      const page = await this.fetchPage(new URL(link));
      if (!page) continue;
      extractEmails(page.html).forEach((e) => found.add(e));
      best = pickBest(found, siteDomain);
      if (best && best.endsWith(`@${siteDomain}`)) return best;
    }
    return pickBest(found, siteDomain);
  }

  /** GET with redirects followed by hand, so every hop is checked. */
  private async fetchPage(start: URL): Promise<{ url: URL; html: string } | null> {
    let url = start;
    for (let hop = 0; hop < 4; hop++) {
      const addr = await resolvePublic(url);
      if (!addr) return null;
      const res = await this.httpGet(url, addr);
      if (!res) return null;
      if (res.status >= 300 && res.status < 400) {
        if (!res.location) return null;
        try {
          url = new URL(res.location, url);
        } catch {
          return null;
        }
        continue;
      }
      if (res.status < 200 || res.status >= 300) return null;
      if (res.contentType && !/text\/html|text\/plain/i.test(res.contentType)) return null;
      return { url, html: res.body ?? '' };
    }
    return null;
  }

  /**
   * A plain GET on Node's own http/https, so it behaves the same on the
   * server's Node 16 (where global fetch is only a small shim) and on newer
   * Node. It connects to the address that was checked rather than looking
   * the name up again, so DNS can't swap in a private address in between.
   */
  protected httpGet(url: URL, addr: { address: string; family: number }): Promise<PageResponse | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r: PageResponse | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const secure = url.protocol === 'https:';
      const req = (secure ? https : http).request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AglaKaamBot/1.0; +https://aglakaam.app)',
            Accept: 'text/html',
            'Accept-Encoding': 'gzip, deflate',
          },
          lookup: (_host: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void) =>
            cb(null, addr.address, addr.family),
          ...(secure && !isIP(url.hostname) ? { servername: url.hostname } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            return finish({ status, location: res.headers.location });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            chunks.push(c);
            if (size >= MAX_BYTES) res.destroy();
          });
          const done = () => {
            let raw = Buffer.concat(chunks);
            const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
            try {
              if (enc.includes('gzip')) raw = zlib.gunzipSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
              else if (enc.includes('deflate')) raw = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
            } catch {
              /* a page cut off at the size cap may not fully decompress */
            }
            finish({ status, contentType: String(res.headers['content-type'] ?? ''), body: raw.toString('utf8') });
          };
          res.on('end', done);
          res.on('close', done);
          res.on('error', done);
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        finish(null);
      }, PAGE_TIMEOUT_MS);
      req.on('error', () => finish(null));
      req.end();
    });
  }
}

function toUrl(raw: string): URL | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * The address to connect to, or null if the host is (or resolves to)
 * localhost, a private network or a cloud metadata address.
 */
async function resolvePublic(url: URL): Promise<{ address: string; family: number } | null> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port && !['80', '443', '8080'].includes(url.port)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addrs: { address: string; family: number }[];
  try {
    addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  } catch {
    return null;
  }
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return null;
  return addrs.find((a) => a.family === 4) ?? addrs[0];
}

export function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

export function extractEmails(html: string): string[] {
  const text = html
    .replace(/&#64;|&#x40;|%40/gi, '@')
    .replace(/\s*\[\s*at\s*\]\s*|\s+\(at\)\s+/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*|\s+\(dot\)\s+/gi, '.');
  const out = new Set<string>();
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,10}/gi)) {
    const e = m[0].toLowerCase().replace(/^u00[0-9a-f]{2}/, '');
    const domain = e.split('@')[1];
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e)) continue;
    if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
    if (/^(no-?reply|donotreply|mailer-daemon|postmaster)@/.test(e)) continue;
    out.add(e);
  }
  return [...out];
}

/** Prefer the site's own domain, then a free-mail inbox; a role address over a person's. */
export function pickBest(emails: Iterable<string>, siteDomain: string): string | null {
  const score = (e: string) => {
    const [local, domain] = e.split('@');
    let s = 0;
    if (domain === siteDomain || domain.endsWith(`.${siteDomain}`)) s = 100;
    else if (FREE_MAIL.includes(domain)) s = 50;
    else return 0; // someone else's domain, e.g. the web designer's
    if (GOOD_PREFIX.includes(local)) s += 10;
    return s;
  };
  let best: string | null = null;
  for (const e of emails) if (!best || score(e) > score(best)) best = e;
  return best && score(best) > 0 ? best : null;
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
