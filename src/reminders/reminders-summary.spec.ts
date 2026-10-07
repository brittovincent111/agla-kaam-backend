import { RemindersService } from './reminders.service';
import { ServicesService } from '../services/services.service';
import { startOfLocalDay } from '../common/utils/timezone';

const DAY = 86_400_000;

// GET /reminders/summary — Home's four feeds in one request.
describe('RemindersService.summary', () => {
  function setup() {
    const order: string[] = [];
    const services = {
      prepareReminderReads: jest.fn(async () => {
        order.push('prepare');
      }),
      findOverdue: jest.fn(async () => []),
      findDueBetween: jest.fn(async () => []),
      findWarrantyFeed: jest.fn(async () => []),
      countReminders: jest.fn(async () => 0),
    };
    const businessModel = {
      findById: jest.fn(() => {
        order.push('timezone');
        const q: any = {
          select: () => q,
          lean: () => q,
          exec: async () => {
            await new Promise((r) => setImmediate(r));
            order.push('timezone-done');
            return { timezone: 'Asia/Kolkata' };
          },
        };
        return q;
      }),
    };
    const reminders = new RemindersService(
      services as never,
      businessModel as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { reminders, services, order };
  }

  it('bounds the warranty feed: next 14 days ahead, last 30 days behind', async () => {
    const { reminders, services } = setup();

    const result = await reminders.summary('b1', undefined, { limit: 5 });

    const today = startOfLocalDay('Asia/Kolkata', new Date());
    const [, window, , limit, fields] = services.findWarrantyFeed.mock
      .calls[0] as unknown as [string, any, unknown, number, string];
    expect(window.today).toEqual(today);
    expect(window.expiringBefore.getTime()).toBe(today.getTime() + 14 * DAY);
    expect(window.expiredSince.getTime()).toBe(today.getTime() - 30 * DAY);
    expect(limit).toBe(5);
    expect(fields).toBe('name phone');

    // The total counts the same window as the rows.
    const warrantyCount = services.countReminders.mock.calls[3] as unknown as [
      string,
      any,
    ];
    expect(warrantyCount[1]).toEqual({
      warrantyExpiry: {
        $gte: window.expiredSince,
        $lt: window.expiringBefore,
      },
    });

    // Same shape as ever.
    expect(Object.keys(result)).toEqual([
      'days',
      'limit',
      'overdue',
      'dueToday',
      'dueSoon',
      'warrantyAlerts',
    ]);
    expect(result.warrantyAlerts).toEqual({ items: [], total: 0 });
  });

  it('asks only for the customer fields Home shows', async () => {
    const { reminders, services } = setup();
    await reminders.summary('b1');
    for (const call of [
      ...services.findOverdue.mock.calls,
      ...services.findDueBetween.mock.calls,
    ] as unknown as unknown[][]) {
      expect(call[call.length - 1]).toBe('name phone');
    }
  });

  it('looks up the timezone alongside the shared preparation, not before it', async () => {
    const { reminders, order } = setup();
    await reminders.summary('b1');
    // The preparation starts before the timezone lookup has come back.
    expect(order.indexOf('prepare')).toBeLessThan(
      order.indexOf('timezone-done'),
    );
  });
});

describe('ServicesService warranty feed and technician scope', () => {
  const BUSINESS_ID = '507f1f77bcf86cd799439012';

  function setup(rowsFor: (filter: any, dir: number) => unknown[]) {
    const calls: { filter: any; sort: any; limit?: number }[] = [];
    const serviceModel = {
      find: jest.fn((filter: any) => {
        const call: { filter: any; sort: any; limit?: number } = {
          filter,
          sort: undefined,
        };
        calls.push(call);
        const q: any = {
          sort: (s: any) => ((call.sort = s), q),
          populate: () => q,
          limit: (n: number) => ((call.limit = n), q),
          exec: async () =>
            rowsFor(filter, Object.values(call.sort as object)[0] as number),
        };
        return q;
      }),
      countDocuments: jest.fn(() => ({ exec: async () => 0 })),
    };
    const customers = {
      findAssignedCustomerIds: jest.fn(async () => ['c1', 'c2']),
    };
    const service = new ServicesService(
      serviceModel as never,
      customers as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, calls, customers };
  }

  it('lists expiring warranties soonest first, then the recently expired newest first', async () => {
    const today = new Date('2026-10-07T00:00:00Z');
    const { service, calls } = setup((_filter, dir) =>
      dir === 1 ? ['exp-in-2d', 'exp-in-9d'] : ['expired-1d-ago', 'expired-20d-ago'],
    );

    const rows = await service.findWarrantyFeed(
      BUSINESS_ID,
      {
        today,
        expiringBefore: new Date(today.getTime() + 14 * DAY),
        expiredSince: new Date(today.getTime() - 30 * DAY),
      },
      undefined,
      3,
    );

    expect(rows).toEqual(['exp-in-2d', 'exp-in-9d', 'expired-1d-ago']);
    expect(calls[0].sort).toEqual({ warrantyExpiry: 1 });
    expect(calls[1].sort).toEqual({ warrantyExpiry: -1 });
    expect(calls[0].limit).toBe(3);
    // Nothing older than the window behind is asked for.
    const expiredWindow = calls[1].filter.$and.find((f: any) => f.warrantyExpiry);
    expect(expiredWindow.warrantyExpiry.$gte).toEqual(
      new Date(today.getTime() - 30 * DAY),
    );
  });

  it("works out a technician's scope once per request, not once per feed", async () => {
    const { service, customers } = setup(() => []);
    const viewer = {
      businessId: BUSINESS_ID,
      role: 'technician',
      teamMemberId: '507f1f77bcf86cd799439099',
    } as never;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        service.countReminders(BUSINESS_ID, {}, viewer),
      ),
    );
    expect(customers.findAssignedCustomerIds).toHaveBeenCalledTimes(1);

    // The next request (a new viewer object) looks again.
    await service.countReminders(BUSINESS_ID, {}, {
      businessId: BUSINESS_ID,
      role: 'technician',
      teamMemberId: '507f1f77bcf86cd799439099',
    } as never);
    expect(customers.findAssignedCustomerIds).toHaveBeenCalledTimes(2);
  });
});
