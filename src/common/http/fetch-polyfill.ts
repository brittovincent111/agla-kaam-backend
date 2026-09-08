import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// `fetch` only became a global in Node 18. The deployed EC2 box runs Node 16,
// where every `await fetch(...)` throws "fetch is not defined" at runtime —
// which silently broke the admin broadcast, the reminder push dispatch, and
// (most expensively) Apple in-app-purchase verification, so a paying iOS
// customer's subscription could never activate.
//
// Installing a minimal shim is deliberate rather than rewriting each call
// site: the code stays written against the standard API, so it keeps working
// unchanged once the server is upgraded, and nothing has to be re-tested a
// second time when it is.
//
// This covers only what this codebase uses — a JSON/text body, request
// headers, and the ok/status/json()/text() response surface. It is not a
// general-purpose fetch.

interface ShimResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function shimFetch(
  input: string | URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<ShimResponse> {
  return new Promise((resolve, reject) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    const transport = url.protocol === 'http:' ? http : https;

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        headers: {
          ...(init.body ? { 'Content-Length': Buffer.byteLength(init.body) } : {}),
          ...(init.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            text: async () => raw,
            json: async () => JSON.parse(raw),
          });
        });
      },
    );

    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

// Called once from main.ts, before anything can issue a request. A no-op on
// Node 18+, where the real implementation is already there and is preferred.
export function installFetchPolyfill(): void {
  if (typeof (globalThis as { fetch?: unknown }).fetch === 'function') return;
  (globalThis as { fetch?: unknown }).fetch = shimFetch;
}

// Exported for its own test — the shim is only reachable through the global
// on old Node, which a test cannot rely on either way.
export const __shimFetchForTests = shimFetch;
