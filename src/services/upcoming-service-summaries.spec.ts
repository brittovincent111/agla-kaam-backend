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
// This is the one place where moving the customers-plus-services join from
// the app to the server could quietly change what the user sees: the app
// chose the *soonest-due* service (latestRelevantService), and an earlier
// version of this method chose the *most recently logged* one. For a customer
// with an overdue AC service and a comfortable RO service those are different
// rows, and picking the wrong one drops the customer out of the overdue
// reading of the list.
describe('ServicesService.upcomingServiceSummaries', () => {
  const businessId = 'b1';
  let service: ServicesService;
  let sort: jest.Mock;
  let rows: any[];

  const row = (
    customerId: string,
    id: string,
    serviceType: string,
    serviceDate: string,
    nextServiceDate: string,
  ) => ({
    _id: { toString: () => id },
    customerId: { toString: () => customerId },
    serviceType,
    serviceDate: new Date(serviceDate),
    nextServiceDate: new Date(nextServiceDate),
    warrantyExpiry: null,
  });

  beforeEach(async () => {
    rows = [];
    sort = jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockImplementation(async () => {
        // Mimic Mongo: return the rows in the order the requested sort implies.
        const [[key, dir]] = Object.entries(sort.mock.calls.at(-1)![0] as Record<string, number>);
        return [...rows].sort(
          (a, b) =>
            (new Date(a[key]).getTime() - new Date(b[key]).getTime()) * (dir as number),
        );
      }),
    }));
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ sort }),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: getModelToken(Service.name), useValue: { find } },
        { provide: CustomersService, useValue: {} },
        { provide: TeamMembersService, useValue: {} },
        { provide: AmcService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ServicesService);
  });

  it('picks the soonest-due service, not the most recently logged one', async () => {
    // Logged today, but not due for a year.
    rows.push(row('c1', 's-recent', 'RO Filter Change', '2026-09-09', '2027-09-09'));
    // Logged months ago and already overdue — this is the one the customer
    // row must show, because it is the one that needs attention.
    rows.push(row('c1', 's-overdue', 'AC General Service', '2026-03-01', '2026-08-10'));

    const summaries = await service.upcomingServiceSummaries(businessId, ['c1']);

    expect(summaries.get('c1')?._id).toBe('s-overdue');
    expect(summaries.get('c1')?.serviceType).toBe('AC General Service');
  });

  // A pending service is work due on its own serviceDate — that is what the
  // lists, the due chips and the reminder feeds all bucket on now, so the
  // per-customer summary has to agree or Home would disagree with itself.
  it('sorts by serviceDate ascending, so the first row per customer wins', async () => {
    await service.upcomingServiceSummaries(businessId, ['c1']);
    expect(sort).toHaveBeenCalledWith({ serviceDate: 1 });
  });

  it('keeps one entry per customer', async () => {
    rows.push(row('c1', 's1', 'AC', '2026-01-01', '2026-06-01'));
    rows.push(row('c1', 's2', 'AC', '2026-02-01', '2026-07-01'));
    rows.push(row('c2', 's3', 'RO', '2026-01-01', '2026-05-01'));

    const summaries = await service.upcomingServiceSummaries(businessId, ['c1', 'c2']);

    expect(summaries.size).toBe(2);
    expect(summaries.get('c1')?._id).toBe('s1');
    expect(summaries.get('c2')?._id).toBe('s3');
  });

  it('does not query at all for an empty page of customers', async () => {
    const summaries = await service.upcomingServiceSummaries(businessId, []);
    expect(summaries.size).toBe(0);
    expect(sort).not.toHaveBeenCalled();
  });
});
