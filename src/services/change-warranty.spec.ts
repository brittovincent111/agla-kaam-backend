import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';

// changeWarranty only: who may change it, and what the expiry counts from.
function make(job: Record<string, unknown>) {
  const service: any = Object.create(ServicesService.prototype);
  const doc: any = { ...job, save: jest.fn(async function (this: any) { return this; }) };
  service.findOne = jest.fn(async () => doc);
  return { service, doc };
}
const owner: any = { businessId: 'b1', role: 'owner' };

describe('changing a job warranty', () => {
  it('counts a new period from the day the job was completed', async () => {
    const { service, doc } = make({
      status: 'completed',
      serviceDate: new Date(2026, 0, 10),
      completedAt: new Date(2026, 0, 31),
      warrantyPeriod: 'none',
    });
    await service.changeWarranty('b1', 's1', owner, '1y');
    expect(doc.warrantyPeriod).toBe('1y');
    expect(doc.warrantyExpiry).toEqual(new Date(2027, 0, 31));
    expect(doc.save).toHaveBeenCalled();
  });

  it('counts from the booked day while the job is still pending', async () => {
    const { service, doc } = make({ status: 'pending', serviceDate: new Date(2026, 0, 31) });
    await service.changeWarranty('b1', 's1', owner, '6m');
    expect(doc.warrantyExpiry).toEqual(new Date(2026, 6, 31));
  });

  it('takes a chosen date as it is, and clears the expiry for no warranty', async () => {
    const { service, doc } = make({ status: 'completed', serviceDate: new Date(2026, 0, 1), completedAt: new Date(2026, 0, 1) });
    await service.changeWarranty('b1', 's1', owner, 'custom', new Date(2026, 11, 25));
    expect(doc.warrantyExpiry).toEqual(new Date(2026, 11, 25));
    await service.changeWarranty('b1', 's1', owner, 'none');
    expect(doc.warrantyExpiry).toBeNull();
  });

  it('is refused to a technician and on a cancelled job', async () => {
    const { service } = make({ status: 'completed', serviceDate: new Date() });
    await expect(service.changeWarranty('b1', 's1', { ...owner, role: 'technician' }, '1y')).rejects.toBeInstanceOf(ForbiddenException);
    const cancelled = make({ status: 'cancelled', serviceDate: new Date() });
    await expect(cancelled.service.changeWarranty('b1', 's1', owner, '1y')).rejects.toBeInstanceOf(BadRequestException);
  });
});
