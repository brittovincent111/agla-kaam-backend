import { NotFoundException } from '@nestjs/common';
import { parseShareTarget, ShortLinksService } from './short-links.service';
import {
  PublicLinksController,
  ShortLinksController,
} from './short-links.controller';

function make(opts: { base?: string; web?: string; failWith?: number[] } = {}) {
  const saved: any[] = [];
  const failures = [...(opts.failWith ?? [])];
  const model: any = {
    create: jest.fn(async (doc: any) => {
      const code = failures.shift();
      if (code !== undefined) throw Object.assign(new Error('x'), { code });
      saved.push(doc);
      return doc;
    }),
    findOne: jest.fn((q: any) => ({
      lean: () => ({
        exec: async () =>
          saved.find(
            (d) => d.code === q.code && d.expiresAt > q.expiresAt.$gt,
          ) ?? null,
      }),
    })),
  };
  const config: any = {
    get: (k: string) =>
      k === 'PUBLIC_API_URL'
        ? opts.base
        : k === 'PUBLIC_WEB_URL'
          ? opts.web
          : undefined,
  };
  return { svc: new ShortLinksService(model, config), saved, config };
}

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdmMiOiJzMSJ9.' + 'x'.repeat(43);
const LONG = 'https://api.example.com/api/public/services/' + TOKEN;
const INVOICE = 'https://api.example.com/api/public/invoices/' + TOKEN;

function fakeRes() {
  const res: any = { redirect: jest.fn() };
  return res;
}

describe('short share links', () => {
  it('gives a short link that opens the long one', async () => {
    const { svc } = make({ base: 'https://api.example.com/' });
    const short = await svc.shorten(LONG, 365);
    expect(short).toMatch(
      /^https:\/\/api\.example\.com\/api\/s\/[A-Za-z0-9]{8}$/,
    );
    expect(await svc.resolve(short.split('/').pop()!)).toBe(LONG);
  });

  it('tries another code on a clash, and falls back to the long link on any other error', async () => {
    expect(
      await make({ base: 'https://a.b', failWith: [11000] }).svc.shorten(
        LONG,
        1,
      ),
    ).toMatch(/\/api\/s\//);
    expect(
      await make({ base: 'https://a.b', failWith: [1] }).svc.shorten(LONG, 1),
    ).toBe(LONG);
  });

  it('uses the request address when no public URL is set, and the long link when there is neither', async () => {
    expect(await make().svc.shorten(LONG, 1, 'https://req.host')).toMatch(
      /^https:\/\/req\.host\/api\/s\//,
    );
    expect(await make().svc.shorten(LONG, 1)).toBe(LONG);
  });

  it('points at the website when PUBLIC_WEB_URL is set', async () => {
    const { svc } = make({
      base: 'https://api.example.com',
      web: 'https://aglakaam.app/',
    });
    const short = await svc.shorten(LONG, 365);
    expect(short).toMatch(/^https:\/\/aglakaam\.app\/r\/[A-Za-z0-9]{8}$/);
    expect(await svc.resolve(short.split('/').pop()!)).toBe(LONG);
    // No API address needed for a website link.
    expect(
      await make({ web: 'https://aglakaam.app' }).svc.shorten(LONG, 1),
    ).toMatch(/^https:\/\/aglakaam\.app\/r\//);
  });

  it('does not open an unknown, malformed or expired code', async () => {
    const { svc, saved } = make({ base: 'https://a.b' });
    expect(await svc.resolve('nope1234')).toBeNull();
    expect(await svc.resolve('../../etc')).toBeNull();
    saved.push({
      code: 'old12345',
      target: LONG,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await svc.resolve('old12345')).toBeNull();
  });
});

describe('what a short link opens', () => {
  it('reads the kind and token from the stored long link', () => {
    expect(parseShareTarget(LONG)).toEqual({ kind: 'service', token: TOKEN });
    expect(parseShareTarget(INVOICE)).toEqual({
      kind: 'invoice',
      token: TOKEN,
    });
    expect(parseShareTarget(`/api/public/invoices/${TOKEN}`)).toEqual({
      kind: 'invoice',
      token: TOKEN,
    });
  });

  it('refuses anything that is not one of our share links', () => {
    expect(parseShareTarget('https://evil.example/phish')).toBeNull();
    expect(
      parseShareTarget(`https://a.b/api/public/services/${TOKEN}/pdf`),
    ).toBeNull();
    expect(
      parseShareTarget('https://a.b/api/public/services/not-a-jwt'),
    ).toBeNull();
    expect(
      parseShareTarget(`https://a.b/api/public/quotes/${TOKEN}`),
    ).toBeNull();
    expect(parseShareTarget('not a url at all ::')).toBeNull();
  });

  it('GET /public/links/:code answers for links stored before the website existed', async () => {
    const { svc, saved } = make({ base: 'https://a.b' });
    // A legacy doc: only code, target, expiresAt.
    saved.push({
      code: 'Legacy12',
      target: INVOICE,
      expiresAt: new Date(Date.now() + 60_000),
    });
    saved.push({
      code: 'Expired1',
      target: LONG,
      expiresAt: new Date(Date.now() - 1000),
    });
    saved.push({
      code: 'Weird123',
      target: 'https://a.b/other',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const ctrl = new PublicLinksController(svc);
    await expect(ctrl.resolve('Legacy12')).resolves.toEqual({
      kind: 'invoice',
      token: TOKEN,
    });
    await expect(ctrl.resolve('Expired1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctrl.resolve('Weird123')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctrl.resolve('nope1234')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctrl.resolve('../../x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('GET /s/:code', () => {
  it('opens the long link when the website is not in use', async () => {
    const { svc, saved, config } = make({ base: 'https://a.b' });
    saved.push({
      code: 'Abcd2345',
      target: LONG,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = fakeRes();
    await new ShortLinksController(svc, config).open('Abcd2345', res);
    expect(res.redirect).toHaveBeenCalledWith(302, LONG);
    await expect(
      new ShortLinksController(svc, config).open('Zzzz2345', fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("sends links already shared to the website's page when it is in use", async () => {
    const { svc, config } = make({
      base: 'https://a.b',
      web: 'https://aglakaam.app',
    });
    const res = fakeRes();
    await new ShortLinksController(svc, config).open('Abcd2345', res);
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://aglakaam.app/r/Abcd2345',
    );
    await expect(
      new ShortLinksController(svc, config).open('../../etc', fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
