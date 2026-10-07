import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ServicesService } from './services.service';
import { Service } from './schemas/service.schema';
import { CustomersService } from '../customers/customers.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { AmcService } from '../amc/amc.service';
import { S3Service } from '../common/s3/s3.service';

// The compact summary the paged customer list attaches to every row.
//
// It must be the customer's NEXT job: their earliest pending service. It used
// to sort every service the customer ever had oldest-first and keep the first
// — a job finished years ago, shown on the row as hundreds of days overdue.
describe('ServicesService.upcomingServiceSummaries', () => {
  const businessId = 'b1';
  let service: ServicesService;
  let aggregate: jest.Mock;
  let rows: any[];

  const row = (
    customerId: string,
    id: string,
    serviceType: string,
    status: 'pending' | 'completed' | 'cancelled',
    serviceDate: string,
    extra: Record<string, unknown> = {},
  ) => ({
    _id: id,
    customerId,
    serviceType,
    status,
    serviceDate: new Date(serviceDate),
    nextServiceDate: new Date(serviceDate),
    warrantyExpiry: null,
    ...extra,
  });

  // Just enough of Mongo's $match (status) / $sort / $group-$first to run the
  // pipelines the method builds against the rows above.
  function runPipeline(pipeline: any[]) {
    let docs = [...rows];
    for (const stage of pipeline) {
      if (stage.$match) {
        docs = docs.filter((d) => d.status === stage.$match.status);
      } else if (stage.$sort) {
        const keys = Object.entries(stage.$sort as Record<string, number>);
        const value = (d: any, k: string) => {
          const v = d[k];
          if (v === undefined || v === null) return -Infinity;
          return v instanceof Date ? v.getTime() : v;
        };
        docs.sort((a, b) => {
          for (const [k, dir] of keys) {
            const x = value(a, k);
            const y = value(b, k);
            if (x < y) return -dir;
            if (x > y) return dir;
          }
          return 0;
        });
      } else if (stage.$group) {
        const groups = new Map<string, any>();
        for (const d of docs) {
          const key = String(d.customerId);
          if (groups.has(key)) continue;
          const out: any = { _id: key };
          for (const [field, acc] of Object.entries(stage.$group)) {
            if (field === '_id') continue;
            out[field] = d[String((acc as any).$first).slice(1)];
          }
          groups.set(key, out);
        }
        docs = [...groups.values()];
      }
    }
    return docs;
  }

  beforeEach(async () => {
    rows = [];
    aggregate = jest.fn().mockImplementation((pipeline: any[]) => ({
      exec: jest.fn().mockResolvedValue(runPipeline(pipeline)),
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: getModelToken(Service.name), useValue: { aggregate } },
        { provide: CustomersService, useValue: {} },
        { provide: TeamMembersService, useValue: {} },
        { provide: AmcService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ServicesService);
  });

  it('shows the earliest pending service, not the oldest service ever logged', async () => {
    // Done long ago — the row the old query picked.
    rows.push(
      row('c1', 's-old', 'AC Install', 'completed', '2023-01-10', {
        completedAt: new Date('2023-01-10'),
      }),
    );
    // Not due for a year.
    rows.push(row('c1', 's-later', 'RO Filter Change', 'pending', '2027-09-09'));
    // Due soonest — the customer's next job.
    rows.push(row('c1', 's-next', 'AC General Service', 'pending', '2026-08-10'));

    const summaries = await service.upcomingServiceSummaries(businessId, ['c1']);

    expect(summaries.get('c1')?._id).toBe('s-next');
    expect(summaries.get('c1')?.serviceType).toBe('AC General Service');
    expect(summaries.get('c1')?.status).toBe('pending');
  });

  it('falls back to the most recently completed job, marked completed', async () => {
    rows.push(
      row('c1', 's-first', 'AC Install', 'completed', '2024-01-10', {
        completedAt: new Date('2024-01-10'),
      }),
    );
    rows.push(
      row('c1', 's-latest', 'AC Service', 'completed', '2026-05-01', {
        completedAt: new Date('2026-05-02'),
      }),
    );
    rows.push(row('c1', 's-cancel', 'AC Service', 'cancelled', '2026-09-01'));

    const summaries = await service.upcomingServiceSummaries(businessId, ['c1']);

    expect(summaries.get('c1')?._id).toBe('s-latest');
    expect(summaries.get('c1')?.status).toBe('completed');
    expect(summaries.get('c1')?.completedAt).toEqual(new Date('2026-05-02'));
  });

  it('never summarises a customer by a cancelled job', async () => {
    rows.push(row('c1', 's-cancel', 'AC Service', 'cancelled', '2026-09-01'));
    const summaries = await service.upcomingServiceSummaries(businessId, ['c1']);
    expect(summaries.has('c1')).toBe(false);
  });

  it('keeps one entry per customer, with the fields the list has always read', async () => {
    rows.push(row('c1', 's1', 'AC', 'pending', '2026-01-01', { booked: true, visitSlot: 'morning' }));
    rows.push(row('c1', 's2', 'AC', 'pending', '2026-02-01'));
    rows.push(row('c2', 's3', 'RO', 'pending', '2026-01-01'));

    const summaries = await service.upcomingServiceSummaries(businessId, ['c1', 'c2']);

    expect(summaries.size).toBe(2);
    expect(summaries.get('c1')).toEqual({
      _id: 's1',
      serviceType: 'AC',
      serviceDate: new Date('2026-01-01'),
      nextServiceDate: new Date('2026-01-01'),
      warrantyExpiry: null,
      status: 'pending',
      booked: true,
      visitSlot: 'morning',
    });
    expect(summaries.get('c2')?._id).toBe('s3');
  });

  it('matches the page of customers and groups ids stored either way', async () => {
    await service.upcomingServiceSummaries(businessId, ['507f1f77bcf86cd799439011']);
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0].$match.status).toBe('pending');
    expect(pipeline[0].$match.customerId.$in).toHaveLength(2);
    expect(pipeline[1].$sort).toEqual({ serviceDate: 1, _id: 1 });
    expect(pipeline[2].$group._id).toEqual({ $toString: '$customerId' });
  });

  it('does not query at all for an empty page of customers', async () => {
    const summaries = await service.upcomingServiceSummaries(businessId, []);
    expect(summaries.size).toBe(0);
    expect(aggregate).not.toHaveBeenCalled();
  });
});
