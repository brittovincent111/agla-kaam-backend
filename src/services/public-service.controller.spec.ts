import { NotFoundException } from '@nestjs/common';
import { PublicServiceController } from './public-service.controller';

const DAY = 86_400_000;

function make(
  opts: {
    service?: Record<string, unknown>;
    biz?: Record<string, unknown> | null;
    customer?: Record<string, unknown> | null;
    history?: Record<string, unknown>[];
    env?: Record<string, string>;
    logo?: Buffer | null;
  } = {},
) {
  const service = {
    _id: 's1',
    customerId: { toString: () => 'c1' },
    serviceType: 'AC service',
    status: 'completed',
    serviceDate: new Date('2026-09-01T05:00:00Z'),
    completedAt: new Date('2026-09-02T06:00:00Z'),
    nextServiceInterval: '6_months',
    nextServiceDate: new Date('2027-03-02T00:00:00Z'),
    warrantyExpiry: new Date(Date.now() + 30 * DAY),
    hasBeforePhoto: true,
    hasAfterPhoto: false,
    ...opts.service,
  };
  const biz =
    opts.biz === null
      ? null
      : {
          name: 'Cool Fix',
          phone: '98470 12345',
          googleReviewUrl: 'https://g.page/r/x',
          hasLogo: true,
          logoKey: 'businesses/b1/logo.png',
          logoContentType: 'image/png',
          ...opts.biz,
        };
  const chain = (result: unknown) => {
    const q: any = {};
    for (const m of ['select', 'sort', 'limit', 'lean']) q[m] = () => q;
    q.exec = async () => result;
    return q;
  };
  const serviceModel: any = { find: jest.fn(() => chain(opts.history ?? [])) };
  const businessModel: any = { findById: jest.fn(() => chain(biz)) };
  const shareService: any = {
    verify: (t: string) =>
      t === 'good' ? { businessId: 'b1', serviceId: 's1' } : null,
  };
  const servicesService: any = { findOne: jest.fn(async () => service) };
  const customersService: any = {
    findOne: jest.fn(async () =>
      opts.customer === undefined ? { name: 'Ravi Kumar' } : opts.customer,
    ),
  };
  const s3: any = {
    download: jest.fn(async () =>
      opts.logo === undefined ? Buffer.from('png') : opts.logo,
    ),
  };
  const config: any = { get: (k: string) => opts.env?.[k] };
  const ctrl = new PublicServiceController(
    shareService,
    servicesService,
    customersService,
    serviceModel,
    businessModel,
    s3,
    config,
  );
  return { ctrl, serviceModel, s3 };
}

const req: any = {
  headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.req.host' },
  protocol: 'http',
  get: () => 'internal:3000',
};

function fakeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    set: jest.fn((h: Record<string, string>) => Object.assign(res.headers, h)),
    send: jest.fn(),
    redirect: jest.fn(),
  };
  return res;
}

describe('public service record JSON', () => {
  it('gives the website everything the record page shows', async () => {
    const { ctrl, serviceModel } = make({
      env: { PUBLIC_API_URL: 'https://api.example.com/' },
      history: [
        {
          serviceType: 'Gas refill',
          serviceDate: new Date('2026-03-01T00:00:00Z'),
          completedAt: new Date('2026-03-02T00:00:00Z'),
        },
        {
          serviceType: 'Install',
          serviceDate: new Date('2025-09-01T00:00:00Z'),
        },
      ],
    });
    const data = await ctrl.data('good', req);
    const api = 'https://api.example.com/api/public/services/good';
    expect(data).toEqual({
      business: {
        name: 'Cool Fix',
        phone: '98470 12345',
        whatsapp: '919847012345',
        googleReviewUrl: 'https://g.page/r/x',
        logoUrl: `${api}/logo`,
      },
      customerName: 'Ravi Kumar',
      service: {
        serviceType: 'AC service',
        status: 'completed',
        date: '2026-09-02T06:00:00.000Z',
        nextServiceDate: '2027-03-02T00:00:00.000Z',
        warrantyExpiry: expect.any(String),
        underWarranty: true,
        isWarrantyCallback: false,
        beforePhotoUrl: `${api}/photo/before`,
        afterPhotoUrl: null,
      },
      history: [
        { serviceType: 'Gas refill', date: '2026-03-02T00:00:00.000Z' },
        { serviceType: 'Install', date: '2025-09-01T00:00:00.000Z' },
      ],
      bookMessage:
        "Hi Cool Fix, I'd like to book my next AC service — Ravi Kumar.",
    });
    // Same history query as the page: this customer's other completed jobs.
    const q = serviceModel.find.mock.calls[0][0];
    expect(q.status).toBe('completed');
    expect(q._id).toEqual({ $ne: 's1' });
  });

  it('a scheduled visit: booked date, no next date, nulls where nothing is set', async () => {
    const { ctrl } = make({
      service: {
        status: 'scheduled',
        completedAt: undefined,
        warrantyExpiry: new Date(Date.now() - DAY),
        hasBeforePhoto: false,
        underWarranty: true,
        callbackOf: 'orig1',
      },
      biz: { phone: undefined, googleReviewUrl: undefined, hasLogo: false },
      customer: null,
    });
    const data = await ctrl.data('good', req);
    expect(data.business).toEqual({
      name: 'Cool Fix',
      phone: null,
      whatsapp: null,
      googleReviewUrl: null,
      logoUrl: null,
    });
    expect(data.customerName).toBeNull();
    expect(data.service).toMatchObject({
      status: 'scheduled',
      date: '2026-09-01T05:00:00.000Z',
      nextServiceDate: null,
      underWarranty: false,
      isWarrantyCallback: true,
      beforePhotoUrl: null,
    });
    expect(data.history).toEqual([]);
    expect(data.bookMessage).toBe(
      "Hi Cool Fix, I'd like to book my next AC service.",
    );
  });

  it('no next date when the job has no repeat interval', async () => {
    const { ctrl } = make({ service: { nextServiceInterval: 'none' } });
    expect((await ctrl.data('good', req)).service.nextServiceDate).toBeNull();
  });

  it('builds absolute URLs from the request address when PUBLIC_API_URL is unset', async () => {
    const { ctrl } = make();
    const data = await ctrl.data('good', req);
    expect(data.service.beforePhotoUrl).toBe(
      'https://api.req.host/api/public/services/good/photo/before',
    );
  });

  it('404s a bad or expired token, a cancelled job and a missing business', async () => {
    await expect(make().ctrl.data('bad', req)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      make({ service: { status: 'cancelled' } }).ctrl.data('good', req),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ biz: null }).ctrl.data('good', req),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('public service record logo', () => {
  it('streams the business logo, and 404s when there is none', async () => {
    const { ctrl, s3 } = make();
    const res = fakeRes();
    await ctrl.logo('good', res);
    expect(s3.download).toHaveBeenCalledWith('businesses/b1/logo.png');
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toMatch(/max-age/);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('png'));

    await expect(
      make({ biz: { logoKey: undefined } }).ctrl.logo('good', fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ logo: null }).ctrl.logo('good', fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(make().ctrl.logo('bad', fakeRes())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('public service record page', () => {
  it('redirects to the website when PUBLIC_WEB_URL is set', async () => {
    const { ctrl } = make({ env: { PUBLIC_WEB_URL: 'https://aglakaam.app/' } });
    const res = fakeRes();
    await ctrl.page('good', res);
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://aglakaam.app/service-record/good',
    );
    expect(res.send).not.toHaveBeenCalled();
  });

  it('renders its own HTML when it is not', async () => {
    const { ctrl } = make();
    const res = fakeRes();
    await ctrl.page('good', res);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    const html: string = res.send.mock.calls[0][0];
    expect(html).toContain('AC service');
    expect(html).toContain(
      `https://wa.me/919847012345?text=${encodeURIComponent("Hi Cool Fix, I'd like to book my next AC service — Ravi Kumar.")}`,
    );
  });
});
