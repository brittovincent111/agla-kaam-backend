import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AmcService } from './amc.service';
import { Amc } from './schemas/amc.schema';
import { Service } from '../services/schemas/service.schema';
import { CustomersService } from '../customers/customers.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * Visit accounting for AMC contracts.
 *
 * A contract sells a fixed number of visits, so "how many are used up" is the
 * number the customer is paying against. It was being overcounted: one real
 * service consumed two visits, and a four-visit contract closed itself after
 * two. These pin down the two halves of that — what marks a visit used, and
 * what puts the next one in front of the technician.
 */
describe('AMC visit accounting', () => {
  let service: AmcService;
  let amcModel: any;
  let serviceModel: any;

  const BUSINESS_ID = '507f1f77bcf86cd799439012';
  const AMC_ID = new Types.ObjectId('507f1f77bcf86cd799439099');

  // A contract of `totalVisits`, with the first `completed` visits already
  // done. Mirrors the real document closely enough for the logic under test:
  // a visitSchedule array and a save() that records what was written.
  function makeAmc(totalVisits: number, completed = 0) {
    const visitSchedule = Array.from({ length: totalVisits }, (_, i) => ({
      visitNumber: i + 1,
      dueDate: new Date(2026, i, 1),
      status: i < completed ? ('completed' as const) : ('pending' as const),
      serviceId: undefined as Types.ObjectId | undefined,
      completedAt: undefined as Date | undefined,
    }));
    return {
      _id: AMC_ID,
      businessId: BUSINESS_ID,
      customerId: new Types.ObjectId('507f1f77bcf86cd799439013'),
      contractNumber: 'AMC-001',
      serviceType: 'AC General Service',
      planName: 'Gold',
      startDate: new Date(2026, 0, 1),
      status: 'active',
      totalVisits,
      completedVisits: completed,
      visitSchedule,
      notes: undefined,
      save: jest.fn().mockImplementation(function (this: any) {
        return Promise.resolve(this);
      }),
    };
  }

  async function build(amc: any) {
    amcModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([amc]) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(amc) }),
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(amc) }),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    };
    serviceModel = {
      create: jest.fn().mockImplementation((doc: any) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
      ),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AmcService,
        { provide: getModelToken(Amc.name), useValue: amcModel },
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: CustomersService, useValue: { findOne: jest.fn() } },
        { provide: SubscriptionsService, useValue: { getActiveTier: jest.fn() } },
      ],
    }).compile();

    service = module.get<AmcService>(AmcService);
    return amc;
  }

  describe('logVisit', () => {
    it('uses up exactly one visit when a scheduled service is completed', async () => {
      const amc = await build(makeAmc(4));
      const serviceId = new Types.ObjectId();
      amc.visitSchedule[0].serviceId = serviceId;

      await service.logVisit(BUSINESS_ID, AMC_ID.toString(), serviceId.toString());

      expect(amc.completedVisits).toBe(1);
      expect(amc.visitSchedule[0].status).toBe('completed');
      // The visit after it must still be waiting — this is the one that was
      // being stamped off before anybody had done the work.
      expect(amc.visitSchedule[1].status).toBe('pending');
    });

    it('does not charge the contract twice for the same service', async () => {
      const amc = await build(makeAmc(4));
      const serviceId = new Types.ObjectId();
      amc.visitSchedule[0].serviceId = serviceId;

      await service.logVisit(BUSINESS_ID, AMC_ID.toString(), serviceId.toString());
      await service.logVisit(BUSINESS_ID, AMC_ID.toString(), serviceId.toString());

      expect(amc.completedVisits).toBe(1);
    });

    // A visit done offline and recorded afterwards has no scheduled service to
    // match, so it falls back to the next outstanding visit. That fallback is
    // wanted here — it was only wrong when a *pending* service triggered it.
    it('falls back to the next outstanding visit when no service matches', async () => {
      const amc = await build(makeAmc(4));

      await service.logVisit(BUSINESS_ID, AMC_ID.toString());

      expect(amc.completedVisits).toBe(1);
      expect(amc.visitSchedule[0].status).toBe('completed');
    });

    it('closes the contract only once every visit is used', async () => {
      const amc = await build(makeAmc(2, 1));

      await service.logVisit(BUSINESS_ID, AMC_ID.toString());

      expect(amc.completedVisits).toBe(2);
      expect(amc.status).toBe('completed');
    });
  });

  describe('syncAmcServices', () => {
    it('raises a service for the visit that is due now', async () => {
      const amc = await build(makeAmc(4));

      await service.syncAmcServices(BUSINESS_ID);

      expect(serviceModel.create).toHaveBeenCalledTimes(1);
      const created = serviceModel.create.mock.calls[0][0];
      expect(created.amcId).toBe(AMC_ID);
      expect(created.status).toBe('pending');
      // Dated from the contract, so reminders follow what was actually sold.
      expect(created.serviceDate).toEqual(amc.visitSchedule[0].dueDate);
      expect(amc.visitSchedule[0].serviceId).toBeDefined();
    });

    it('does not raise a second service for a visit that already has one', async () => {
      const amc = await build(makeAmc(4));
      amc.visitSchedule[0].serviceId = new Types.ObjectId();

      await service.syncAmcServices(BUSINESS_ID);

      expect(serviceModel.create).not.toHaveBeenCalled();
    });

    // The bug this replaces: the old guard asked "does this contract have any
    // service at all?", which stayed true forever after visit 1, so visits
    // 2..N were never surfaced and never reminded about.
    it('carries on to the next visit once the previous one is done', async () => {
      const amc = await build(makeAmc(4, 1));
      amc.visitSchedule[0].serviceId = new Types.ObjectId();

      await service.syncAmcServices(BUSINESS_ID);

      expect(serviceModel.create).toHaveBeenCalledTimes(1);
      const created = serviceModel.create.mock.calls[0][0];
      expect(created.serviceDate).toEqual(amc.visitSchedule[1].dueDate);
      expect(created.notes).toContain('Visit #2');
    });

    it('raises nothing once every visit is accounted for', async () => {
      const amc = await build(makeAmc(2, 2));

      await service.syncAmcServices(BUSINESS_ID);

      expect(serviceModel.create).not.toHaveBeenCalled();
    });
  });
});
