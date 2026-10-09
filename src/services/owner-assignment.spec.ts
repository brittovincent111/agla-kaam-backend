import { Types } from 'mongoose';
import { ServicesService } from './services.service';

// "I'll do it myself": a job the owner takes on is nobody's technician job,
// not the customer's usual technician's, and not "needs a technician".

const BIZ = '507f1f77bcf86cd799439012';
const RAVI = '507f1f77bcf86cd7994390c1';
const OWNER_VIEWER = { businessId: BIZ, role: 'owner' } as any;
const TECH_VIEWER = { businessId: BIZ, role: 'technician', teamMemberId: RAVI } as any;

function build(jobs: any[] = []) {
  const updateMany = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
  const serviceModel: any = {
    updateMany,
    find: jest.fn(() => {
      const q: any = {
        sort: () => q,
        limit: () => q,
        populate: () => q,
        exec: async () => jobs,
      };
      return q;
    }),
    countDocuments: jest.fn(() => ({ exec: async () => 0 })),
  };
  const customers: any = { findAssignedCustomerIds: jest.fn(async () => ['c1']) };
  const team: any = {
    assertActiveMember: jest.fn(),
    findAllForBusiness: jest.fn(async () => [{ _id: new Types.ObjectId(RAVI), name: 'Ravi', active: true }]),
  };
  const amc: any = { syncAmcServices: jest.fn() };
  const service = new ServicesService(serviceModel, customers, team, amc, {} as never, {} as never);
  return { service, updateMany };
}

const ids = [new Types.ObjectId().toString()];

describe('reassigning to the owner', () => {
  it('marks the jobs as the owner\'s, books them, and clears any technician', async () => {
    const { service, updateMany } = build();
    await service.reassignMany(BIZ, OWNER_VIEWER, ids, null, true);
    expect(updateMany.mock.calls[0][1]).toEqual({
      $set: { assignedToOwner: true, booked: true },
      $unset: { assignedTechnicianId: 1 },
    });
  });

  it('giving the job to a technician takes it off the owner', async () => {
    const { service, updateMany } = build();
    await service.reassignMany(BIZ, OWNER_VIEWER, ids, RAVI, false);
    const update = updateMany.mock.calls[0][1];
    expect(String(update.$set.assignedTechnicianId)).toBe(RAVI);
    expect(update.$unset).toEqual({ assignedToOwner: 1 });
  });

  it('back to nobody clears both', async () => {
    const { service, updateMany } = build();
    await service.reassignMany(BIZ, OWNER_VIEWER, ids, null, false);
    expect(updateMany.mock.calls[0][1]).toEqual({ $unset: { assignedTechnicianId: 1, assignedToOwner: 1 } });
  });

  it('a technician cannot do it', async () => {
    const { service } = build();
    await expect(service.reassignMany(BIZ, TECH_VIEWER, ids, null, true)).rejects.toThrow();
  });
});

describe("a technician's jobs", () => {
  it("leave out a regular customer's job the owner took on", async () => {
    const { service } = build();
    const filter: any = await service.technicianServiceFilter(BIZ, TECH_VIEWER);
    const viaCustomer = filter.$or.find((b: any) => 'customerId' in b);
    expect(viaCustomer.assignedToOwner).toEqual({ $ne: true });
  });
});

describe('team day', () => {
  const job = (fields: Record<string, unknown>) => ({
    _id: new Types.ObjectId(),
    serviceType: 'AC Gas Refill',
    serviceDate: new Date('2026-10-10T05:00:00Z'),
    customerId: { _id: new Types.ObjectId(), name: 'tuttu', address: 'Kakkanad' },
    ...fields,
  });

  it("puts the owner's own jobs under the owner, not \"needs a technician\"", async () => {
    const { service } = build([
      job({ assignedToOwner: true }),
      job({}),
      job({ assignedTechnicianId: new Types.ObjectId(RAVI), amcId: new Types.ObjectId() }),
    ]);
    const board: any = await service.dayBoard(
      BIZ,
      OWNER_VIEWER,
      new Date('2026-10-10T00:00:00Z'),
      new Date('2026-10-11T00:00:00Z'),
    );
    expect(board.owner).toHaveLength(1);
    expect(board.unassigned).toHaveLength(1);
    expect(board.members[0].jobs).toHaveLength(1);
    expect(board.members[0].jobs[0].isAmc).toBe(true);
  });
});

describe('telling a technician about jobs moved to them', () => {
  function withPush(arriving: string[]) {
    const updateMany = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 2 }) });
    const serviceModel: any = {
      updateMany,
      find: jest.fn(() => ({ distinct: () => ({ exec: async () => arriving.map((id) => new Types.ObjectId(id)) }) })),
    };
    const team: any = { assertActiveMember: jest.fn() };
    const jobPush: any = { notifyNewJobs: jest.fn() };
    const service = new ServicesService(serviceModel, {} as any, team, {} as any, {} as never, {} as never, jobPush);
    return { service, jobPush };
  }

  it('announces only the jobs that were not already theirs', async () => {
    const fresh = new Types.ObjectId().toString();
    const { service, jobPush } = withPush([fresh]);
    await service.reassignMany(BIZ, OWNER_VIEWER, [fresh, new Types.ObjectId().toString()], RAVI);
    expect(jobPush.notifyNewJobs).toHaveBeenCalledWith(BIZ, RAVI, [fresh], undefined);
  });

  it('says nothing when every job was already theirs', async () => {
    const { service, jobPush } = withPush([]);
    await service.reassignMany(BIZ, OWNER_VIEWER, ids, RAVI);
    expect(jobPush.notifyNewJobs).not.toHaveBeenCalled();
  });

  it('says nothing when jobs go to the owner', async () => {
    const { service, jobPush } = withPush([]);
    await service.reassignMany(BIZ, OWNER_VIEWER, ids, null, true);
    expect(jobPush.notifyNewJobs).not.toHaveBeenCalled();
  });
});
