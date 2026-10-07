import { Types } from 'mongoose';
import { TeamMembersService } from './team-members.service';

// GET /team-members/:id/tasks. The lists are capped (newest 20 finished, 100
// open, 100 customers) — a long-serving technician's screen used to download
// every job they had ever done — while every number on the screen stays the
// true total. Field names installed apps read are unchanged; `counts` is new.
describe('TeamMembersService.getMemberTasks', () => {
  const BUSINESS_ID = '507f1f77bcf86cd799439012';
  const MEMBER_ID = new Types.ObjectId().toString();

  // A chainable query that records what was asked of it.
  function query(result: unknown) {
    const q: Record<string, jest.Mock> = {};
    for (const m of ['select', 'populate', 'sort', 'limit', 'lean']) {
      q[m] = jest.fn(() => q);
    }
    q.exec = jest.fn(async () => result);
    return q;
  }

  function setup(opts: {
    customerIds: string[];
    pending: number;
    completed: number;
  }) {
    const customerQueries: Record<string, jest.Mock>[] = [];
    const serviceQueries: Record<string, jest.Mock>[] = [];
    const ids = opts.customerIds.map((id) => ({ _id: { toString: () => id } }));
    const customerModel = {
      find: jest.fn(() => {
        // First call: every id (for scoping); second: the capped list.
        const q = query(
          customerQueries.length === 0
            ? ids
            : opts.customerIds.slice(0, 100).map((id) => ({ _id: id, name: id })),
        );
        customerQueries.push(q);
        return q;
      }),
    };
    const serviceModel = {
      find: jest.fn((filter: { status: string }) => {
        const n = filter.status === 'pending' ? opts.pending : opts.completed;
        const q = query(
          Array.from({ length: n }, (_, i) => ({ _id: `${filter.status}-${i}` })),
        );
        serviceQueries.push(q);
        return q;
      }),
      countDocuments: jest.fn((filter: { status: string }) => ({
        exec: jest.fn(async () =>
          filter.status === 'pending' ? 340 : 1250,
        ),
      })),
    };
    const teamMemberModel = {
      findById: jest.fn(() =>
        query({ _id: MEMBER_ID, businessId: BUSINESS_ID, name: 'Ravi' }),
      ),
    };
    const service = new TeamMembersService(
      teamMemberModel as never,
      serviceModel as never,
      customerModel as never,
      {} as never,
      {} as never,
    );
    return { service, serviceModel, customerQueries, serviceQueries };
  }

  it('caps the lists and reports the true totals', async () => {
    const customerIds = Array.from({ length: 150 }, (_, i) => `c${i}`);
    const { service, customerQueries, serviceQueries } = setup({
      customerIds,
      pending: 100,
      completed: 20,
    });

    const result = await service.getMemberTasks(BUSINESS_ID, MEMBER_ID);

    // Newest 20 finished, soonest 100 open, first 100 customers by name.
    const [pendingQ, completedQ] = serviceQueries;
    expect(pendingQ.limit).toHaveBeenCalledWith(100);
    expect(completedQ.limit).toHaveBeenCalledWith(20);
    expect(completedQ.sort).toHaveBeenCalledWith({
      completedAt: -1,
      serviceDate: -1,
    });
    expect(customerQueries[1].limit).toHaveBeenCalledWith(100);
    expect(pendingQ.select).toHaveBeenCalledWith(
      TeamMembersService.TASK_FIELDS,
    );

    expect(result.counts).toEqual({
      pending: 340,
      completed: 1250,
      assignedCustomers: 150,
    });
    // The existing fields keep meaning the totals, not the page lengths.
    expect(result.stats).toEqual({
      completedCount: 1250,
      pendingCount: 340,
      customerCount: 150,
    });
    expect(result.member.serviceCount).toBe(1250);
    expect(result.pendingTasks).toHaveLength(100);
    expect(result.completedTasks).toHaveLength(20);
    expect(result.assignedCustomers).toHaveLength(100);
  });

  it("scopes jobs by every assigned customer, not just the first page's", async () => {
    const customerIds = Array.from({ length: 150 }, (_, i) =>
      new Types.ObjectId().toString(),
    );
    const { service, serviceModel } = setup({
      customerIds,
      pending: 0,
      completed: 0,
    });

    await service.getMemberTasks(BUSINESS_ID, MEMBER_ID);

    const [filter] = serviceModel.find.mock.calls[0] as unknown as [
      { $or: { customerId?: { $in: unknown[] } }[] },
    ];
    // Both stored forms of each of the 150 ids.
    expect(filter.$or[1].customerId!.$in).toHaveLength(300);
  });
});
