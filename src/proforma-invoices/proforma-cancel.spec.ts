import { BadRequestException } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';

// cancel only: which proformas can be cancelled, and that a cancelled one
// cannot then be converted.
function make(status: string) {
  const doc: any = { status, items: [{}], save: jest.fn(async function (this: any) { return this; }) };
  const service: any = Object.create(ProformaInvoicesService.prototype);
  service.findOne = jest.fn(async () => doc);
  return { service, doc };
}

describe('cancelling a proforma', () => {
  it.each(['draft', 'sent'])('cancels a %s proforma', async (status) => {
    const { service, doc } = make(status);
    await service.cancel('b1', 'p1');
    expect(doc.status).toBe('cancelled');
    expect(doc.save).toHaveBeenCalled();
  });

  it('refuses one already converted to a tax invoice, or already cancelled', async () => {
    await expect(make('converted').service.cancel('b1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(make('cancelled').service.cancel('b1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not convert a cancelled proforma', async () => {
    await expect(make('cancelled').service.convertToTaxInvoice('b1', 'p1')).rejects.toThrow(/cancelled/);
  });
});
