import { RemindersService } from './reminders.service';
import { presetsForTrade } from '../common/constants/service-options';

const svc = new RemindersService(
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
);
const biz = { name: 'Vincent Traders' };

describe('service due reminder', () => {
  const service = {
    serviceType: 'AC General Service',
    serviceDate: new Date('2026-09-30T06:00:00Z'),
  };

  it('names the date this visit is due, not the visit after it', () => {
    const msg = svc.buildServiceDueMessage({
      service,
      customerName: 'Priya',
      business: biz,
    });
    expect(msg).toContain('due on 30 Sept 2026');
  });

  it('maps an old {nextServiceDate} template onto the due date', () => {
    const msg = svc.buildServiceDueMessage({
      service,
      customerName: 'Priya',
      business: biz,
      presetTemplate: 'Hi {customerName}, due {nextServiceDate}',
    });
    expect(msg).toBe('Hi Priya, due 30 Sept 2026');
  });

  it('uses the follow-up wording for a second reminder', () => {
    const msg = svc.buildServiceDueMessage({
      service: { ...service, lastRemindedAt: new Date() },
      customerName: 'Priya',
      business: biz,
    });
    expect(msg).toContain('just following up');
  });

  it('prefers the preset message, then the business message', () => {
    const withBusiness = { ...biz, reminderTemplate: 'BIZ {serviceType}' };
    expect(
      svc.buildServiceDueMessage({
        service,
        customerName: 'P',
        business: withBusiness,
      }),
    ).toBe('BIZ AC General Service');
    expect(
      svc.buildServiceDueMessage({
        service,
        customerName: 'P',
        business: withBusiness,
        presetTemplate: 'PRESET',
      }),
    ).toBe('PRESET');
  });

  it('writes Hindi for a Hindi business', () => {
    const msg = svc.buildServiceDueMessage({
      service,
      customerName: 'प्रिया',
      business: { ...biz, language: 'hi' },
    });
    expect(msg).toContain('नमस्ते प्रिया');
  });
});

describe('payment reminder', () => {
  const base = {
    customerName: 'Priya',
    businessName: 'Vincent Traders',
    invoiceNumber: 'INV-1',
    balanceDue: 'Rs. 4,790.80',
  };

  it('says "is due" before the due date and "was due" after it', () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const past = new Date(Date.now() - 5 * 86_400_000);
    expect(
      svc.buildPaymentReminderMessage({ ...base, dueDate: future }),
    ).toContain('is due on');
    expect(
      svc.buildPaymentReminderMessage({ ...base, dueDate: past }),
    ).toContain('was due on');
  });

  it('adds the UPI ID and invoice link only when given', () => {
    const plain = svc.buildPaymentReminderMessage({
      ...base,
      dueDate: new Date(),
    });
    expect(plain).not.toContain('UPI');
    expect(plain).not.toContain('view the invoice');
    const full = svc.buildPaymentReminderMessage({
      ...base,
      dueDate: new Date(),
      upiId: 'vt@upi',
      invoiceUrl: 'https://x/api/public/invoices/abc',
    });
    expect(full).toContain('Pay by UPI: vt@upi');
    expect(full).toContain(
      'Pay online or view the invoice: https://x/api/public/invoices/abc',
    );
  });
});

describe('job dispatch', () => {
  const input = {
    businessName: 'Vincent Traders',
    technicianName: 'Ravi',
    serviceType: 'AC Service',
    dueDate: new Date('2026-09-30'),
    customer: {
      name: 'Priya',
      phone: '+919847012345',
      address: 'MG Road, Kochi',
    },
  };

  it('uses the saved GPS pin for the map when there is one', () => {
    const msg = svc.buildDispatchMessage({
      ...input,
      customer: {
        ...input.customer,
        location: { latitude: 9.97, longitude: 76.28 },
      },
    });
    expect(msg).toContain('maps.google.com/?q=9.97,76.28');
  });

  it('falls back to the address, and drops empty lines', () => {
    const msg = svc.buildDispatchMessage(input);
    expect(msg).toContain('q=MG%20Road%2C%20Kochi');
    expect(msg).not.toContain('Notes');
  });
});

describe('starter packs', () => {
  it('gives every trade its own types, and "Other" no AC ones', () => {
    expect(presetsForTrade('Pest control')[0].name).toBe(
      'General Pest Control',
    );
    expect(presetsForTrade('AC repair • Split & Inverter AC')[0].name).toBe(
      'AC General Service',
    );
    expect(presetsForTrade('Other').some((p) => p.name.startsWith('AC'))).toBe(
      false,
    );
    expect(presetsForTrade('Something unknown')).toBe(presetsForTrade('Other'));
  });
});
