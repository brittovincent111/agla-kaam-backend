import { NotFoundException } from '@nestjs/common';
import { PublicInvoiceController } from './public-invoice.controller';

function make(
  opts: {
    invoice?: Record<string, unknown> | null;
    biz?: Record<string, unknown>;
    env?: Record<string, string>;
    logo?: { data: Buffer; contentType: string } | null;
  } = {},
) {
  const invoice =
    opts.invoice === null
      ? null
      : {
          invoiceNumber: 'INV-0042',
          invoiceDate: new Date('2026-09-01T00:00:00Z'),
          dueDate: new Date('2026-09-15T00:00:00Z'),
          currency: 'INR',
          total: 1500,
          amountPaid: 500,
          balanceDue: 1000,
          status: 'partially_paid',
          customerId: { name: 'Ravi Kumar' },
          ...opts.invoice,
        };
  const biz = {
    name: 'Cool Fix',
    phone: '9847012345',
    currency: 'INR',
    paymentUpiId: 'coolfix@okaxis',
    hasLogo: true,
    ...opts.biz,
  };
  const shareService: any = {
    verify: (t: string) =>
      t === 'good' ? { businessId: 'b1', invoiceId: 'i1' } : null,
  };
  const invoicingService: any = {
    findOneWithDisplayStatus: jest.fn(async () => invoice),
  };
  const businessesService: any = {
    findById: jest.fn(async () => biz),
    getLogo: jest.fn(async () =>
      opts.logo === undefined
        ? { data: Buffer.from('jpg'), contentType: 'image/jpeg' }
        : opts.logo,
    ),
  };
  const config: any = { get: (k: string) => opts.env?.[k] };
  const ctrl = new PublicInvoiceController(
    shareService,
    invoicingService,
    {} as any,
    businessesService,
    {} as any,
    config,
  );
  return { ctrl, businessesService };
}

const req: any = { headers: {}, protocol: 'https', get: () => 'api.req.host' };

function fakeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    set: jest.fn((h: Record<string, string>) => Object.assign(res.headers, h)),
    send: jest.fn(),
    redirect: jest.fn(),
  };
  return res;
}

describe('public invoice JSON', () => {
  it('gives the website what is owed and how to pay it', async () => {
    const { ctrl } = make({
      env: { PUBLIC_API_URL: 'https://api.example.com' },
    });
    const data = await ctrl.data('good', req);
    const api = 'https://api.example.com/api/public/invoices/good';
    expect(data).toEqual({
      business: {
        name: 'Cool Fix',
        phone: '9847012345',
        whatsapp: '919847012345',
        logoUrl: `${api}/logo`,
      },
      customerName: 'Ravi Kumar',
      invoice: {
        number: 'INV-0042',
        invoiceDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-15T00:00:00.000Z',
        currency: 'INR',
        total: 1500,
        amountPaid: 500,
        balanceDue: 1000,
        status: 'partially_paid',
      },
      payment: {
        upiLink: expect.stringMatching(
          /^upi:\/\/pay\?pa=coolfix%40okaxis.*am=1000\.00/,
        ),
        upiIsAppLink: true,
        qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        upiId: 'coolfix@okaxis',
      },
      pdfUrl: `${api}/pdf`,
      paidMessage: expect.stringMatching(
        /^Hi Cool Fix, I've paid invoice INV-0042 \(.*1,000.*\)\.$/,
      ),
    });
  });

  it.each([
    ['overdue', 1000, 'overdue'],
    ['partially_paid', 1000, 'partially_paid'],
    ['sent', 1000, 'due'],
    ['overdue', 0, 'paid'],
    ['paid', 0, 'paid'],
  ])(
    'status %s with %d owed reads as %s',
    async (status, balanceDue, expected) => {
      const { ctrl } = make({ invoice: { status, balanceDue } });
      expect((await ctrl.data('good', req)).invoice.status).toBe(expected);
    },
  );

  it('a settled invoice has no payment details', async () => {
    const { ctrl } = make({
      invoice: { status: 'paid', balanceDue: 0, amountPaid: 1500 },
    });
    const data = await ctrl.data('good', req);
    expect(data.payment).toEqual({
      upiLink: null,
      upiIsAppLink: false,
      qrDataUrl: null,
      upiId: null,
    });
    expect(data.invoice.balanceDue).toBe(0);
  });

  it('no payment details when the business turned them off; nulls where nothing is set', async () => {
    const { ctrl } = make({
      biz: {
        showPaymentDetailsOnInvoice: false,
        hasLogo: false,
        phone: undefined,
      },
      invoice: { dueDate: undefined, customerId: undefined },
    });
    const data = await ctrl.data('good', req);
    expect(data.payment.upiLink).toBeNull();
    expect(data.payment.upiId).toBeNull();
    expect(data.business).toEqual({
      name: 'Cool Fix',
      phone: null,
      whatsapp: null,
      logoUrl: null,
    });
    expect(data.invoice.dueDate).toBeNull();
    expect(data.customerName).toBeNull();
    // Request address when PUBLIC_API_URL is unset.
    expect(data.pdfUrl).toBe(
      'https://api.req.host/api/public/invoices/good/pdf',
    );
  });

  it('404s a bad token, and drafts or cancelled invoices', async () => {
    await expect(make().ctrl.data('bad', req)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      make({ invoice: { status: 'draft' } }).ctrl.data('good', req),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ invoice: { status: 'cancelled' } }).ctrl.data('good', req),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      make({ invoice: null }).ctrl.data('good', req),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('public invoice logo', () => {
  it('streams the business logo, and 404s when there is none', async () => {
    const { ctrl, businessesService } = make();
    const res = fakeRes();
    await ctrl.logo('good', res);
    expect(businessesService.getLogo).toHaveBeenCalledWith('b1');
    expect(res.headers['Content-Type']).toBe('image/jpeg');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('jpg'));
    await expect(
      make({ logo: null }).ctrl.logo('good', fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(make().ctrl.logo('bad', fakeRes())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('public invoice page', () => {
  it('redirects to the website when PUBLIC_WEB_URL is set', async () => {
    const { ctrl } = make({ env: { PUBLIC_WEB_URL: 'https://aglakaam.app' } });
    const res = fakeRes();
    await ctrl.page('good', res);
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://aglakaam.app/invoice/good',
    );
    expect(res.send).not.toHaveBeenCalled();
  });

  it('renders its own HTML when it is not', async () => {
    const { ctrl } = make();
    const res = fakeRes();
    await ctrl.page('good', res);
    expect(res.redirect).not.toHaveBeenCalled();
    const html: string = res.send.mock.calls[0][0];
    expect(html).toContain('INV-0042');
    expect(html).toContain('Part paid');
    expect(html).toContain('Paid? Tell Cool Fix on WhatsApp');
  });
});
