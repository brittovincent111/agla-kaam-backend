import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';

// A manager sees the whole business like the owner; a technician only theirs.
function make(customer: Record<string, unknown>) {
  const service: any = Object.create(CustomersService.prototype);
  service.findOne = jest.fn(async () => customer);
  service.servicesService = {
    findAssignedServiceCustomerIds: jest.fn(async () => []),
  };
  return service;
}
const unassigned = { _id: 'c1', name: 'A', assignedTechnicianId: undefined };
const manager: any = { businessId: 'b1', role: 'manager', teamMemberId: 'tm-m' };
const technician: any = { businessId: 'b1', role: 'technician', teamMemberId: 'tm-t' };

describe('customers — manager scope', () => {
  it('puts no technician filter on a manager', async () => {
    const service = make(unassigned);
    await expect(service.viewerScope('b1', manager)).resolves.toEqual({});
    expect(service.servicesService.findAssignedServiceCustomerIds).not.toHaveBeenCalled();
  });

  it('still narrows a technician to their own customers', async () => {
    const service = make(unassigned);
    const scope = await service.viewerScope('b1', technician);
    expect(scope).toHaveProperty('$or');
  });

  it('opens an unassigned customer to a manager, not a technician', async () => {
    await expect(make(unassigned).findOneForViewer('b1', 'c1', manager)).resolves.toBe(unassigned);
    await expect(make(unassigned).findOneForViewer('b1', 'c1', technician)).rejects.toBeInstanceOf(NotFoundException);
  });
});
