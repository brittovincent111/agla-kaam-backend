import { Types } from 'mongoose';
import { AmcService } from './amc.service';

/**
 * A contract's end date with a visit still owed.
 *
 * The owner's rule: the date running out (often through our own delay) must
 * not close a contract that still owes the customer a visit. It stays
 * active — the visit can be logged or skipped and keeps showing as due — and
 * expires only once nothing is pending. Finishing every sold visit still
 * closes it as completed, as before.
 */
describe('AMC end date with pending visits', () => {
  const BUSINESS_ID = '507f1f77bcf86cd799439012';
  // 10:00 India time on 7 Oct 2026.
  const NOW = new Date('2026-10-07T04:30:00Z');
  const ENDED = new Date('2026-09-30T00:00:00Z');
  const RUNNING = new Date('2026-12-31T00:00:00Z');

  // A contract of `total` visits; `statuses` gives each scheduled visit.
  function makeAmc(
    statuses: ('pending' | 'completed' | 'skipped')[],
    opts: { total?: number; endDate?: Date; status?: string } = {},
  ) {
    const doc: any = {
      _id: new Types.ObjectId(),
      businessId: BUSINESS_ID,
      status: opts.status ?? 'active',
      endDate: opts.endDate ?? ENDED,
      totalVisits: opts.total ?? statuses.length,
      completedVisits: statuses.filter((s) => s !== 'pending').length,
      visitSchedule: statuses.map((status, i) => ({
        visitNumber: i + 1,
        dueDate: new Date(2026, i, 1),
        status,
      })),
      save: jest.fn(async function (this: any) {
        return this;
      }),
    };
    return doc;
  }

  function make(doc?: any) {
    const amcModel: any = {
      find: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
    };
    const service: any = Object.create(AmcService.prototype);
    service.amcModel = amcModel;
    service.findOne = jest.fn(async () => doc);
    service.syncAmcServices = jest.fn(async () => undefined);
    service.invalidateSync = jest.fn();
    return { service: service as AmcService, amcModel };
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  describe('grace', () => {
    it('stays active past its end date while a visit is still pending', async () => {
      const doc = makeAmc(['pending', 'pending']);
      const { service } = make(doc);

      await service.logVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.visitSchedule[1].status).toBe('pending');
      expect(doc.status).toBe('active');
    });

    it('still lets a pending visit be skipped after the end date', async () => {
      const doc = makeAmc(['completed', 'pending', 'pending']);
      const { service } = make(doc);

      await service.skipVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.visitSchedule[1].status).toBe('skipped');
      expect(doc.status).toBe('active');
    });
  });

  describe('last pending visit dealt with after the end date', () => {
    it('closes as completed when every sold visit is used (unchanged)', async () => {
      const doc = makeAmc(['completed', 'pending']);
      const { service } = make(doc);

      await service.logVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.status).toBe('completed');
    });

    it('expires when logged and nothing is pending but visits remain unsold-for', async () => {
      // Four sold, only two ever scheduled (an edited or older contract).
      const doc = makeAmc(['completed', 'pending'], { total: 4 });
      const { service } = make(doc);

      await service.logVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.visitSchedule[1].status).toBe('completed');
      expect(doc.status).toBe('expired');
    });

    it('expires when skipped and nothing is left pending', async () => {
      const doc = makeAmc(['completed', 'pending'], { total: 4 });
      const { service } = make(doc);

      await service.skipVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.status).toBe('expired');
    });

    it('does not expire a contract whose end date has not passed', async () => {
      const doc = makeAmc(['completed', 'pending'], {
        total: 4,
        endDate: RUNNING,
      });
      const { service } = make(doc);

      await service.logVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.status).toBe('active');
    });

    it('treats the end date itself as still inside the contract', async () => {
      // 7 Oct, India midnight — today.
      const doc = makeAmc(['completed', 'pending'], {
        total: 4,
        endDate: new Date('2026-10-06T18:30:00Z'),
      });
      const { service } = make(doc);

      await service.logVisit(BUSINESS_ID, doc._id.toString());

      expect(doc.status).toBe('active');
    });
  });

  describe('nightly expiry', () => {
    it('expires only active, ended contracts with nothing pending — one document at a time', async () => {
      const { service, amcModel } = make();
      const eligible = [
        { _id: new Types.ObjectId(), businessId: BUSINESS_ID },
        { _id: new Types.ObjectId(), businessId: new Types.ObjectId(BUSINESS_ID) },
      ];
      amcModel.find.mockReturnValue({
        select: () => ({ lean: () => ({ exec: async () => eligible }) }),
      });
      amcModel.updateOne
        .mockReturnValueOnce({ exec: async () => ({ modifiedCount: 1 }) })
        // Changed in between (a visit re-opened): the re-check skips it.
        .mockReturnValueOnce({ exec: async () => ({ modifiedCount: 0 }) });

      const expired = await service.expireEndedContracts(NOW);

      expect(expired).toBe(1);
      const query = amcModel.find.mock.calls[0][0];
      expect(query.status).toBe('active');
      expect(query['visitSchedule.status']).toEqual({ $ne: 'pending' });
      // Start of today, India time.
      expect(query.endDate.$lt).toEqual(new Date('2026-10-06T18:30:00Z'));

      expect(amcModel.updateOne).toHaveBeenCalledTimes(2);
      for (const [i, [filter, update]] of amcModel.updateOne.mock.calls.entries()) {
        expect(filter._id).toBe(eligible[i]._id);
        // Matched whichever way businessId happens to be stored.
        expect(filter.businessId.$in).toHaveLength(2);
        expect(filter.status).toBe('active');
        expect(filter['visitSchedule.status']).toEqual({ $ne: 'pending' });
        expect(filter.endDate).toEqual(query.endDate);
        expect(update).toEqual({ $set: { status: 'expired' } });
      }
    });

    it('does nothing when no contract is eligible (safe to re-run)', async () => {
      const { service, amcModel } = make();
      amcModel.find.mockReturnValue({
        select: () => ({ lean: () => ({ exec: async () => [] }) }),
      });

      await expect(service.expireEndedContracts(NOW)).resolves.toBe(0);
      expect(amcModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('summary counts', () => {
    it('counts active, expiring within 30 days and ended-with-pending on the server', async () => {
      const { service, amcModel } = make();
      amcModel.countDocuments
        .mockReturnValueOnce({ exec: async () => 12 })
        .mockReturnValueOnce({ exec: async () => 3 })
        .mockReturnValueOnce({ exec: async () => 2 });

      const result = await service.summary(BUSINESS_ID, undefined, NOW);

      expect(result).toEqual({ active: 12, expiringSoon: 3, endedWithPending: 2 });
      const [active, soon, ended] = amcModel.countDocuments.mock.calls.map(
        (c: any[]) => c[0],
      );
      const today = new Date('2026-10-06T18:30:00Z');
      // "Active" is status active only — never expired or completed.
      expect(active.status).toBe('active');
      expect(active.businessId.$in).toContain(BUSINESS_ID);
      expect(active.customerId).toBeUndefined();
      expect(soon.status).toBe('active');
      expect(soon.endDate.$gte).toEqual(today);
      // Today plus 30 whole days, the 30th included.
      expect(soon.endDate.$lt).toEqual(new Date(today.getTime() + 31 * 86_400_000));
      expect(ended.status).toBe('active');
      expect(ended.endDate).toEqual({ $lt: today });
      expect(ended['visitSchedule.status']).toBe('pending');
    });

    it('narrows to one customer when asked, matching either id shape', async () => {
      const { service, amcModel } = make();
      amcModel.countDocuments.mockReturnValue({ exec: async () => 0 });
      const customerId = '507f1f77bcf86cd799439013';

      await service.summary(BUSINESS_ID, customerId, NOW);

      for (const [filter] of amcModel.countDocuments.mock.calls) {
        expect(filter.customerId.$in).toHaveLength(2);
      }
    });
  });
});
