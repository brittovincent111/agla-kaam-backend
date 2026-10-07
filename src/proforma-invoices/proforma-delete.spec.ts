import { BadRequestException } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';

// delete: drafts only, as with invoices and quotations. A converted proforma
// is the record behind a real tax invoice and must never be deleted.
function make(status: string, deletedCount = 1) {
  const doc: any = { status };
  const service: any = Object.create(ProformaInvoicesService.prototype);
  service.findOne = jest.fn(async () => doc);
  service.proformaModel = {
    deleteOne: jest.fn(async () => ({ deletedCount })),
  };
  return { service, doc };
}

describe('deleting a proforma', () => {
  it('deletes a draft, and only while it is still a draft', async () => {
    const { service } = make('draft');
    await service.delete('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439099');
    const filter = service.proformaModel.deleteOne.mock.calls[0][0];
    expect(filter.status).toBe('draft');
    expect(filter.businessId.$in).toHaveLength(2);
  });

  it('refuses a converted proforma with a clear message', async () => {
    const { service } = make('converted');
    await expect(service.delete('b1', '507f1f77bcf86cd799439099')).rejects.toThrow(
      /converted to a tax invoice/,
    );
    expect(service.proformaModel.deleteOne).not.toHaveBeenCalled();
  });

  it.each(['sent', 'cancelled'])('refuses a %s proforma', async (status) => {
    const { service } = make(status);
    await expect(
      service.delete('b1', '507f1f77bcf86cd799439099'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.proformaModel.deleteOne).not.toHaveBeenCalled();
  });

  it('refuses when it stopped being a draft mid-delete', async () => {
    const { service } = make('draft', 0);
    await expect(
      service.delete('b1', '507f1f77bcf86cd799439099'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
