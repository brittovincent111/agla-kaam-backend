import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ServicesService } from './services.service';

// Assigning and dispatching is the owner's and the manager's, not a technician's.
function make() {
  const service: any = Object.create(ServicesService.prototype);
  service.teamMembersService = { assertActiveMember: jest.fn(async () => ({})) };
  service.serviceModel = {
    updateMany: jest.fn(() => ({ exec: async () => ({ modifiedCount: 1 }) })),
  };
  return service;
}
const tech = new Types.ObjectId().toString();
const job = new Types.ObjectId().toString();
const manager: any = { businessId: 'b1', role: 'manager', teamMemberId: 'tm-m' };

describe('assigning jobs — manager', () => {
  it('lets a manager reassign jobs', async () => {
    const service = make();
    await expect(service.reassignMany('b1', manager, [job], tech)).resolves.toEqual({ moved: 1 });
    expect(service.serviceModel.updateMany).toHaveBeenCalled();
  });

  it('still refuses a technician', async () => {
    const service = make();
    await expect(
      service.reassignMany('b1', { ...manager, role: 'technician' }, [job], tech),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives a manager the whole business, booked or not', async () => {
    const service = make();
    await expect(service.technicianServiceFilter('b1', manager)).resolves.toEqual({});
    expect(service.technicianBookedOnly(manager)).toEqual({});
    expect(service.technicianBookedOnly({ ...manager, role: 'technician' })).toEqual({ booked: true });
  });
});
