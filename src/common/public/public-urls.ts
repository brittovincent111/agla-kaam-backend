import type { Request } from 'express';
import type { ConfigService } from '@nestjs/config';

// Where the links a customer opens point. Two addresses:
//
//  - the API (PUBLIC_API_URL, else the host the request came in on): the
//    signed share links, photos, PDFs and logos are served from here;
//  - the website (PUBLIC_WEB_URL, e.g. https://aglakaam.app), optional: when
//    set, the customer lands on the website's pages for the service record
//    and the invoice, which fetch their data from the API as JSON. When it is
//    not set, the API's own HTML pages are used, as before.

// The address this request came in on. Honours the proxy's headers.
export function requestBase(req: Request): string {
  const proto =
    (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  return host ? `${proto}://${host}` : '';
}

export function publicApiBase(config: ConfigService, req?: Request): string {
  return (
    config.get<string>('PUBLIC_API_URL')?.replace(/\/+$/, '') ||
    (req ? requestBase(req).replace(/\/+$/, '') : '')
  );
}

// Empty when the website pages are not in use.
export function publicWebBase(config: ConfigService): string {
  return config.get<string>('PUBLIC_WEB_URL')?.trim().replace(/\/+$/, '') || '';
}
