import { BadRequestException } from '@nestjs/common';
import { BusinessesService } from './businesses.service';

const BIZ = '507f1f77bcf86cd799439012';

// Stands in for the aggregation: applies the pipeline's own regex to a list
// of stored numbers, so the test also checks the pattern the service builds.
function modelWithNumbers(field: string, numbers: string[]) {
  return {
    aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
      const pattern = new RegExp(pipeline[0].$match[field].$regex);
      const serials = numbers
        .map((n) => pattern.exec(n))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => Number(m[1]));
      return {
        exec: jest
          .fn()
          .mockResolvedValue(
            serials.length ? [{ highest: Math.max(...serials) }] : [],
          ),
      };
    }),
  };
}

function build(stored: Record<string, unknown> = {}) {
  const service = Object.create(BusinessesService.prototype) as any;
  service.businessModel = {
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ get: (k: string) => stored[k] }),
    }),
  };
  service.invoiceModel = modelWithNumbers('invoiceNumber', [
    'INV-2025-040',
    'INV-2026-041',
    'INV-2026-042',
    'OLD-2024-900',
  ]);
  service.quotationModel = modelWithNumbers('quotationNumber', ['QT-2026-005']);
  service.purchaseModel = modelWithNumbers('purchaseNumber', []);
  service.proformaModel = modelWithNumbers('proformaNumber', ['PI-2026-003']);
  return service as BusinessesService;
}

describe('BusinessesService.assertNextSerialsAhead', () => {
  // The settings screen sent back a stale counter on every save, moving it
  // behind numbers already issued — the next invoice then hit the unique
  // index and failed to save.
  it('rejects an invoice serial at or below the highest one used', async () => {
    const service = build({ invoicePrefix: 'INV-' });
    await expect(
      service.assertNextSerialsAhead(BIZ, { invoiceNextSerial: 42 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.assertNextSerialsAhead(BIZ, { invoiceNextSerial: 10 }),
    ).rejects.toThrow(/up to 42 are already used.*43 or higher/);
  });

  it('accepts a serial past the highest one used', async () => {
    const service = build({ invoicePrefix: 'INV-' });
    await expect(
      service.assertNextSerialsAhead(BIZ, { invoiceNextSerial: 43 }),
    ).resolves.toBeUndefined();
  });

  it('falls back to the default prefix when none is stored', async () => {
    const service = build({});
    await expect(
      service.assertNextSerialsAhead(BIZ, { invoiceNextSerial: 5 }),
    ).rejects.toThrow(/INV- invoice numbers up to 42/);
  });

  it('lets a new prefix start again from 1', async () => {
    const service = build({ invoicePrefix: 'INV-' });
    await expect(
      service.assertNextSerialsAhead(BIZ, {
        invoicePrefix: 'TAX/',
        invoiceNextSerial: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('checks quotations, purchase orders and proformas the same way', async () => {
    const service = build({});
    await expect(
      service.assertNextSerialsAhead(BIZ, { quotationNextSerial: 5 }),
    ).rejects.toThrow(/quotation numbers up to 5/);
    await expect(
      service.assertNextSerialsAhead(BIZ, { proformaNextSerial: 2 }),
    ).rejects.toThrow(/proforma invoice numbers up to 3/);
    await expect(
      service.assertNextSerialsAhead(BIZ, { purchaseNextSerial: 1 }),
    ).resolves.toBeUndefined();
  });

  it('does nothing when no serial is being set', async () => {
    const service = build({}) as any;
    await service.assertNextSerialsAhead(BIZ, { invoiceShowTax: false });
    expect(service.businessModel.findById).not.toHaveBeenCalled();
  });

  it('escapes a prefix so it is matched literally', async () => {
    const service = build({}) as any;
    service.invoiceModel = modelWithNumbers('invoiceNumber', [
      'A.B-2026-050',
      'AXB-2026-099',
    ]);
    await expect(
      service.assertNextSerialsAhead(BIZ, {
        invoicePrefix: 'A.B-',
        invoiceNextSerial: 51,
      }),
    ).resolves.toBeUndefined();
  });
});
