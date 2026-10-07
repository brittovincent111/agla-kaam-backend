import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Amc,
  AmcDocument,
  AmcVisitSchedule,
} from './schemas/amc.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { CreateAmcDto } from './dto/create-amc.dto';
import { UpdateAmcDto } from './dto/update-amc.dto';
import { CustomersService } from '../customers/customers.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FREE_TIER_AMC_LIMIT } from '../common/constants/subscription-options';
import {
  Page,
  andFilters,
  buildPage,
  clampLimit,
  decodePageCursor,
  pageCursorFilter,
  pageSort,
} from '../common/pagination/cursor-page';
import {
  SEARCH_CUSTOMER_CAP,
  numberOrCustomerFilter,
} from '../common/pagination/document-search';
import { idFilter, idsFilter } from '../common/utils/id-match';
import {
  DEFAULT_TIMEZONE,
  startOfLocalDay,
} from '../common/utils/timezone';

const DAY_MS = 86_400_000;

// A contract ending within this many days is due a renewal conversation.
export const AMC_EXPIRING_SOON_DAYS = 30;

// Start of today, India time — the day boundary every AMC date rule uses,
// so the list, the instant check and the nightly job agree on "ended".
function amcToday(now: Date): Date {
  return startOfLocalDay(DEFAULT_TIMEZONE, now);
}

// Whether the contract's last day is behind us. The end date itself is
// still inside the contract.
function hasEnded(amc: { endDate?: Date }, now: Date): boolean {
  return (
    !!amc.endDate &&
    new Date(amc.endDate).getTime() < amcToday(now).getTime()
  );
}

// Every visit dealt with (done or skipped) — nothing left to grace for.
// Matches documents with no pending visit, an empty schedule included.
const NO_PENDING_VISIT = { 'visitSchedule.status': { $ne: 'pending' as const } };

// How long a finished visit sync is trusted before a read runs another one.
// Contract changes made through this service invalidate it straight away.
export const AMC_SYNC_MIN_INTERVAL_MS = 60_000;

interface AmcSyncState {
  // Bumped whenever a contract changes; a pass covers the generation it
  // started at.
  generation: number;
  running?: { generation: number; promise: Promise<void> };
  fresh?: { generation: number; at: number };
}

@Injectable()
export class AmcService {
  // Per business, in this process: the visit sync running now, and when the
  // last one finished. See syncAmcServices.
  private readonly syncState = new Map<string, AmcSyncState>();

  constructor(
    @InjectModel(Amc.name)
    private readonly amcModel: Model<AmcDocument>,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private async nextContractNumber(businessId: string): Promise<string> {
    const count = await this.amcModel.countDocuments({ businessId: idFilter(businessId) }).exec();
    return `AMC-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Makes sure every active contract's due visit has its own pending job.
   *
   * Called from most read paths (the services page, the reminder feeds, the
   * team day, the AMC screens) — opening Home alone used to run it six to
   * nine times at once, each pass a find-and-save per contract, and two
   * passes racing each other could both create the same visit's job. So:
   *
   *   - one pass per business at a time: a caller arriving while a pass is
   *     running waits for that pass instead of starting its own;
   *   - at most one pass per AMC_SYNC_MIN_INTERVAL_MS, unless something has
   *     changed a contract since (invalidateSync, or `force`) — the cron in
   *     AmcCron keeps it fresh in between;
   *   - a pass is a handful of round trips, not one per contract; and
   *   - a visit's job is claimed with a conditional write, so even passes in
   *     different server processes cannot both attach a job to one visit.
   */
  async syncAmcServices(
    businessId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const key = String(businessId);
    let state = this.syncState.get(key);
    if (!state) {
      state = { generation: 0 };
      this.syncState.set(key, state);
    }
    if (options.force) state.generation += 1;

    for (;;) {
      const generation = state.generation;
      if (state.running) {
        // A pass that started after the last change already covers us.
        if (state.running.generation === generation) {
          return state.running.promise;
        }
        // It started before a change we need reflected: let it finish, then
        // run again (or join whoever started the next one first).
        await state.running.promise.catch(() => undefined);
        continue;
      }
      if (
        state.fresh &&
        state.fresh.generation === generation &&
        Date.now() - state.fresh.at < AMC_SYNC_MIN_INTERVAL_MS
      ) {
        return;
      }

      const running = state;
      const promise = this.runSync(key).then(() => {
        running.fresh = { generation, at: Date.now() };
      });
      running.running = { generation, promise };
      const clear = () => {
        if (running.running?.promise === promise) running.running = undefined;
      };
      promise.then(clear, clear);
      return promise;
    }
  }

  /**
   * Something changed a contract's schedule: the next read re-syncs rather
   * than trusting a pass from the last minute.
   */
  invalidateSync(businessId: string): void {
    const state = this.syncState.get(String(businessId));
    if (state) state.generation += 1;
  }

  /** Businesses with an active contract still owing a visit — for the cron. */
  async businessesWithPendingVisits(): Promise<string[]> {
    const ids = await this.amcModel
      .distinct('businessId', {
        status: 'active',
        'visitSchedule.status': 'pending',
      })
      .exec();
    return [...new Set(ids.map((id) => String(id)))];
  }

  private async runSync(businessId: string): Promise<void> {
    const activeAmcs = await this.amcModel
      .find({ businessId: idFilter(businessId), status: 'active' })
      .select(
        'customerId contractNumber planName serviceType startDate notes visitSchedule',
      )
      .lean()
      .exec();

    type Visit = AmcVisitSchedule;
    const linked: { visit: Visit; amc: (typeof activeAmcs)[number] }[] = [];
    const unlinked: {
      visit: Visit;
      nextVisit: Visit | null;
      amc: (typeof activeAmcs)[number];
    }[] = [];

    for (const amc of activeAmcs) {
      if (!amc.visitSchedule || amc.visitSchedule.length === 0) continue;

      const allPending = amc.visitSchedule.filter(
        (v) => v.status === 'pending',
      );
      const currentVisit = allPending[0];
      if (!currentVisit) continue;

      // Materialise the visit that is due NOW, not "the first visit ever".
      //
      // The check used to be "does any service exist for this contract?",
      // which is true forever once visit 1 is created — so visits 2..N were
      // never surfaced, no reminder was ever raised for them, and the only
      // way to move a contract along was the manual "+ Log Visit" button.
      // Keying off the visit's own serviceId materialises each visit in turn
      // as the one before it is completed.
      if (currentVisit.serviceId) {
        linked.push({ visit: currentVisit, amc });
      } else {
        unlinked.push({
          visit: currentVisit,
          nextVisit: allPending.length > 1 ? allPending[1] : null,
          amc,
        });
      }
    }

    await Promise.all([
      this.fixVisitDates(linked),
      this.createVisitServices(businessId, unlinked),
    ]);
  }

  // A visit's job follows the contract's schedule: a pending job whose date
  // drifted from its visit's due date is put back on it. One read for every
  // contract's job, one write for all the corrections.
  private async fixVisitDates(
    linked: {
      visit: AmcVisitSchedule;
      amc: { startDate?: Date };
    }[],
  ): Promise<void> {
    if (!linked.length) return;
    const services = await this.serviceModel
      .find({
        _id: {
          $in: linked
            .map((l) => String(l.visit.serviceId))
            .filter((id) => Types.ObjectId.isValid(id)),
        },
      })
      .select('status serviceDate nextServiceDate')
      .lean()
      .exec();
    const byId = new Map(services.map((sv) => [String(sv._id), sv]));

    const fixes: { _id: unknown; date: Date }[] = [];
    for (const { visit, amc } of linked) {
      const existing = byId.get(String(visit.serviceId));
      if (!existing || existing.status !== 'pending') continue;
      const expectedDate = visit.dueDate ?? amc.startDate;
      if (!expectedDate) continue;
      const expected = new Date(expectedDate).getTime();
      const needsDateFix =
        (existing.serviceDate
          ? new Date(existing.serviceDate).getTime()
          : undefined) !== expected ||
        (existing.nextServiceDate
          ? new Date(existing.nextServiceDate).getTime()
          : undefined) !== expected;
      if (needsDateFix) fixes.push({ _id: existing._id, date: expectedDate });
    }
    if (!fixes.length) return;

    await this.serviceModel.bulkWrite(
      fixes.map((f) => ({
        updateOne: {
          filter: { _id: f._id, status: 'pending' },
          // nextServiceDate must be THIS visit's due date so the Services
          // screen shows the correct "Due …" label and overdue bucketing.
          update: { $set: { serviceDate: f.date, nextServiceDate: f.date } },
        },
      })) as never,
    );
  }

  // Raises the job for each due visit that has none: all the jobs in one
  // insert, then each visit claimed for its job only if it is still pending
  // and still has no job. A visit claimed by another pass in the meantime
  // keeps that pass's job, and the one raised here is removed again — so a
  // visit can never end up with two jobs.
  private async createVisitServices(
    businessId: string,
    unlinked: {
      visit: AmcVisitSchedule;
      nextVisit: AmcVisitSchedule | null;
      amc: {
        _id: unknown;
        customerId: unknown;
        contractNumber: string;
        planName?: string;
        serviceType: string;
        startDate?: Date;
        notes?: string;
      };
    }[],
  ): Promise<void> {
    if (!unlinked.length) return;

    // Booked on the schedule unless the owner asked to book AMC visits by hand.
    const amcAutoBook = await this.amcAutoBook(businessId);

    const docs = unlinked.map(({ visit, nextVisit, amc }) => {
      const title = amc.planName
        ? `${amc.planName} (${amc.serviceType})`
        : amc.serviceType;
      const date = visit.dueDate ?? amc.startDate ?? new Date();
      return {
        businessId,
        customerId: amc.customerId,
        serviceType: title,
        status: 'pending',
        // On the technician's day by default; a reminder to book when the
        // business books AMC visits by hand (amcAutoBook: false).
        booked: amcAutoBook,
        // The contract's own schedule decides the date, so reminders follow
        // what the customer actually bought.
        serviceDate: date,
        warrantyPeriod: 'none',
        // nextServiceDate drives the Services screen (sorting, overdue/due-
        // today/upcoming bucketing, and the displayed "Due …" label).  It must
        // be THIS visit's own due date so the service appears at the right
        // time — not the subsequent visit's date, which would hide the first
        // visit from the list entirely and show the wrong due date.
        nextServiceInterval: nextVisit ? 'custom' : 'none',
        nextServiceDate: date,
        amcId: amc._id,
        notes: amc.notes
          ? `AMC ${amc.contractNumber}: ${amc.notes}`
          : `AMC ${amc.contractNumber} - Visit #${visit.visitNumber}`,
      };
    });

    const created = await this.serviceModel.insertMany(docs);

    const claimed = await Promise.all(
      unlinked.map(async ({ visit, amc }, i) => {
        const serviceId = created[i]._id;
        const res = await this.amcModel
          .updateOne(
            {
              _id: amc._id,
              status: 'active',
              visitSchedule: {
                $elemMatch: {
                  visitNumber: visit.visitNumber,
                  status: 'pending',
                  serviceId: null,
                },
              },
            },
            { $set: { 'visitSchedule.$.serviceId': serviceId } },
          )
          .exec();
        return (res.modifiedCount ?? 0) > 0;
      }),
    );

    const losers = created.filter((_, i) => !claimed[i]).map((c) => c._id);
    if (losers.length) {
      await this.serviceModel.deleteMany({ _id: { $in: losers } }).exec();
    }
  }

  // The business's amcAutoBook setting. Read straight off the collection:
  // this module has no Business model, and a missing or unreadable setting
  // means the default (booked).
  private async amcAutoBook(businessId: string): Promise<boolean> {
    if (!this.amcModel.db?.collection) return true;
    const biz = await this.amcModel.db
      .collection('businesses')
      .findOne(
        {
          _id: Types.ObjectId.isValid(businessId)
            ? new Types.ObjectId(businessId)
            : (businessId as never),
        },
        { projection: { amcAutoBook: 1 } },
      )
      .catch(() => null);
    return biz?.amcAutoBook !== false;
  }

  async create(businessId: string, dto: CreateAmcDto): Promise<AmcDocument> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    const hasUnlimitedAmc = tier === 'reminders' || tier === 'combo';
    if (!hasUnlimitedAmc) {
      const currentAmcCount = await this.amcModel
        .countDocuments({ businessId: idFilter(businessId) })
        .exec();
      if (currentAmcCount >= FREE_TIER_AMC_LIMIT) {
        throw new ForbiddenException(
          `Your plan allows ${FREE_TIER_AMC_LIMIT} free AMC contracts to test AMC tracking. Upgrade to Reminders or Combo plan to create unlimited AMC contracts.`,
        );
      }
    }

    await this.customersService.findOne(businessId, dto.customerId);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException('End date must be after start date');
    }

    const totalMs = endDate.getTime() - startDate.getTime();
    const intervalMs = dto.totalVisits > 1 ? totalMs / dto.totalVisits : 0;
    const visitSchedule = [];
    for (let i = 0; i < dto.totalVisits; i++) {
      const dueDate = new Date(startDate.getTime() + intervalMs * i);
      visitSchedule.push({
        visitNumber: i + 1,
        dueDate,
        status: 'pending' as const,
      });
    }

    const contractNumber = await this.nextContractNumber(businessId);
    const createdAmc = await this.amcModel.create({
      businessId,
      customerId: dto.customerId,
      contractNumber,
      planName: dto.planName,
      serviceType: dto.serviceType,
      startDate,
      endDate,
      totalVisits: dto.totalVisits,
      completedVisits: 0,
      contractValue: dto.contractValue ?? 0,
      status: 'active',
      visitSchedule,
      notes: dto.notes,
    });

    await this.syncAmcServices(businessId, { force: true });

    return createdAmc;
  }

  async findOne(businessId: string, amcId: string): Promise<AmcDocument> {
    if (!Types.ObjectId.isValid(amcId)) {
      throw new NotFoundException('AMC contract not found');
    }
    const amc = await this.amcModel.findById(amcId).exec();
    if (!amc || amc.businessId.toString() !== businessId) {
      throw new NotFoundException('AMC contract not found');
    }
    return amc;
  }

  async findOnePopulated(
    businessId: string,
    amcId: string,
  ): Promise<AmcDocument> {
    // Materialise before reading, so the contract screen shows the same
    // state as every other screen. Completing a visit leaves the next one
    // pending with no service yet; the sync ran on the services and list
    // queries but not here, so coming straight back to the contract showed
    // "+ Log Visit" for a visit that was about to get its own service —
    // and only corrected itself once some other screen triggered the sync.
    await this.syncAmcServices(businessId);
    const amc = await this.findOne(businessId, amcId);
    await amc.populate('customerId');
    return amc;
  }

  /**
   * One page of AMC contracts, newest first.
   *
   * Materialising due AMC visits is first-page-only work — it does not
   * change while the user scrolls, and running it per page would make every
   * scroll pay for it.
   */
  async findPageForBusiness(
    businessId: string,
    options: {
      status?: string;
      customerId?: string;
      search?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<Page<AmcDocument>> {
    const limit = clampLimit(options.limit);
    const cursor = decodePageCursor(options.cursor);
    if (!cursor) {
      await this.syncAmcServices(businessId);
    }

    const customerIds = options.search
      ? await this.customersService.findIdsMatching(
          businessId,
          options.search,
          SEARCH_CUSTOMER_CAP,
        )
      : [];

    const filter = andFilters(
      { businessId: idFilter(businessId) },
      options.customerId ? { customerId: idFilter(options.customerId) } : {},
      options.status && options.status !== 'all'
        ? { status: options.status }
        : {},
      numberOrCustomerFilter(
        options.search,
        'contractNumber',
        customerIds,
        idsFilter,
      ),
      pageCursorFilter(cursor, 'createdAt', 'desc'),
    );

    const [rows, total] = await Promise.all([
      this.amcModel
        .find(filter)
        .sort(pageSort('createdAt', 'desc'))
        .limit(limit + 1)
        .populate('customerId', 'name phone')
        .exec(),
      cursor
        ? Promise.resolve(undefined)
        : this.amcModel.countDocuments(filter).exec(),
    ]);

    return buildPage(
      rows,
      limit,
      (row) => ({
        v: (row as unknown as { createdAt: Date }).createdAt.toISOString(),
        id: (row._id as { toString(): string }).toString(),
      }),
      total,
    );
  }

  async findAllForBusiness(
    businessId: string,
    filters: { status?: string; customerId?: string },
  ): Promise<AmcDocument[]> {
    await this.syncAmcServices(businessId);

    const query: Record<string, unknown> = { businessId: idFilter(businessId) };
    if (filters.customerId) {
      query.customerId = idFilter(filters.customerId);
    }
    if (filters.status && filters.status !== 'all') {
      query.status = filters.status;
    }

    return this.amcModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate('customerId')
      .exec();
  }

  /**
   * A contract visit moved to another day (Reschedule or Revisit later on
   * its job). The schedule is the source of truth — syncAmcServices resets a
   * job to its scheduled date — so the schedule has to move with it, or the
   * visit snapped back the next time a list loaded.
   */
  async moveVisit(
    businessId: string,
    amcId: string,
    serviceId: string,
    date: Date,
  ): Promise<void> {
    const amc = await this.findOne(businessId, amcId).catch(() => null);
    const visit = amc?.visitSchedule?.find(
      (v) => v.serviceId?.toString() === serviceId,
    );
    if (!amc || !visit || visit.status !== 'pending') return;
    visit.dueDate = date;
    amc.markModified('visitSchedule');
    await amc.save();
    this.invalidateSync(businessId);
  }

  async logVisit(
    businessId: string,
    amcId: string,
    serviceId?: string,
  ): Promise<AmcDocument> {
    const amc = await this.findOne(businessId, amcId);
    if (amc.status === 'cancelled' || amc.status === 'expired') {
      throw new BadRequestException(
        `Cannot log visit for a ${amc.status} AMC contract`,
      );
    }

    let visitToComplete = amc.visitSchedule?.find(
      (v) => serviceId && v.serviceId?.toString() === serviceId,
    );
    if (!visitToComplete) {
      visitToComplete = amc.visitSchedule?.find((v) => v.status === 'pending');
    }

    if (visitToComplete && visitToComplete.status !== 'completed') {
      visitToComplete.status = 'completed';
      visitToComplete.completedAt = new Date();
      if (serviceId && Types.ObjectId.isValid(serviceId)) {
        visitToComplete.serviceId = new Types.ObjectId(serviceId);
      }
      amc.completedVisits += 1;
    }

    this.settleStatus(amc);
    const saved = await amc.save();
    // The next visit is now due its own job.
    this.invalidateSync(businessId);
    return saved;
  }

  /**
   * Status after a visit is logged or skipped.
   *
   * Every sold visit used up closes the contract as completed, as before.
   * Otherwise the end date alone does not end it: a contract past its end
   * date with a visit still pending (often our side's delay, not the
   * customer's) stays active, so that visit can still be logged or skipped
   * and keeps showing as due. Once nothing is pending, an ended contract
   * expires straight away rather than waiting for the nightly job.
   */
  private settleStatus(amc: AmcDocument, now = new Date()): void {
    if (amc.completedVisits >= amc.totalVisits) {
      amc.status = 'completed';
      return;
    }
    const pending = (amc.visitSchedule || []).some(
      (v) => v.status === 'pending',
    );
    if (amc.status === 'active' && !pending && hasEnded(amc, now)) {
      amc.status = 'expired';
    }
  }

  /**
   * Nightly: active contracts whose end date has passed and that have no
   * visit pending become expired. Contracts still owing a visit are left
   * active (see settleStatus). Safe to run any number of times — each
   * update re-checks the same conditions on its own document, so a visit
   * re-opened or a contract changed in between is left alone.
   */
  async expireEndedContracts(now = new Date()): Promise<number> {
    const today = amcToday(now);
    const eligible = {
      status: 'active' as const,
      endDate: { $lt: today },
      ...NO_PENDING_VISIT,
    };
    const candidates = await this.amcModel
      .find(eligible)
      .select('_id businessId')
      .lean()
      .exec();

    let expired = 0;
    for (const amc of candidates) {
      const result = await this.amcModel
        .updateOne(
          {
            _id: amc._id,
            businessId: idFilter(String(amc.businessId)),
            ...eligible,
          },
          { $set: { status: 'expired' } },
        )
        .exec();
      expired += result.modifiedCount ?? 0;
    }
    return expired;
  }

  /**
   * The AMC list's header numbers, counted on the server so they cover
   * every contract and not just the rows loaded so far.
   *
   *   active            contracts still running (ended-with-pending included)
   *   expiringSoon      active, ending today or within the next 30 days
   *   endedWithPending  active, past the end date, a visit still pending
   */
  async summary(
    businessId: string,
    customerId?: string,
    now = new Date(),
  ): Promise<{ active: number; expiringSoon: number; endedWithPending: number }> {
    const today = amcToday(now);
    const soonUntil = new Date(
      today.getTime() + (AMC_EXPIRING_SOON_DAYS + 1) * DAY_MS,
    );
    const active = {
      businessId: idFilter(businessId),
      ...(customerId ? { customerId: idFilter(customerId) } : {}),
      status: 'active' as const,
    };
    const [activeCount, expiringSoon, endedWithPending] = await Promise.all([
      this.amcModel.countDocuments(active).exec(),
      this.amcModel
        .countDocuments({ ...active, endDate: { $gte: today, $lt: soonUntil } })
        .exec(),
      this.amcModel
        .countDocuments({
          ...active,
          endDate: { $lt: today },
          'visitSchedule.status': 'pending',
        })
        .exec(),
    ]);
    return { active: activeCount, expiringSoon, endedWithPending };
  }

  async skipVisit(businessId: string, amcId: string): Promise<AmcDocument> {
    const amc = await this.findOne(businessId, amcId);
    if (amc.status === 'cancelled' || amc.status === 'expired') {
      throw new BadRequestException(
        `Cannot skip visit for a ${amc.status} AMC contract`,
      );
    }

    const pendingVisit = amc.visitSchedule?.find((v) => v.status === 'pending');
    if (pendingVisit) {
      pendingVisit.status = 'skipped';
    }

    amc.completedVisits += 1;
    this.settleStatus(amc);
    await amc.save();
    await this.syncAmcServices(businessId, { force: true });
    return amc;
  }

  async update(
    businessId: string,
    amcId: string,
    dto: UpdateAmcDto,
  ): Promise<AmcDocument> {
    const amc = await this.findOne(businessId, amcId);

    if (dto.planName !== undefined) amc.planName = dto.planName;
    if (dto.serviceType) amc.serviceType = dto.serviceType;
    if (dto.startDate) amc.startDate = new Date(dto.startDate);
    if (dto.endDate) amc.endDate = new Date(dto.endDate);
    if (dto.totalVisits !== undefined) amc.totalVisits = dto.totalVisits;
    if (dto.contractValue !== undefined) amc.contractValue = dto.contractValue;
    if (dto.status) amc.status = dto.status;
    if (dto.notes !== undefined) amc.notes = dto.notes;

    if (dto.totalVisits !== undefined || dto.endDate || dto.startDate) {
      const completedList = (amc.visitSchedule || []).filter(
        (v) => v.status === 'completed',
      );
      const completedCount = completedList.length;
      amc.completedVisits = completedCount;

      const newTotal = amc.totalVisits;
      const remainingCount = Math.max(0, newTotal - completedCount);

      const newPendingSchedule = [];
      if (completedCount === 0) {
        // All visits are pending: visit 1 is at startDate
        const startMs = amc.startDate.getTime();
        const endMs = amc.endDate.getTime();
        const totalMs = Math.max(0, endMs - startMs);
        const stepMs = remainingCount > 1 ? totalMs / remainingCount : 0;

        for (let i = 0; i < remainingCount; i++) {
          newPendingSchedule.push({
            visitNumber: i + 1,
            dueDate: new Date(startMs + stepMs * i),
            status: 'pending' as const,
          });
        }
      } else {
        // Some visits already completed: remaining visits start after last completed visit date
        const baseDate = new Date(
          completedList[completedList.length - 1].dueDate,
        );
        const startMs = baseDate.getTime();
        const endMs = amc.endDate.getTime();
        const totalMs = Math.max(0, endMs - startMs);
        const stepMs = remainingCount > 0 ? totalMs / (remainingCount + 1) : 0;

        for (let i = 1; i <= remainingCount; i++) {
          newPendingSchedule.push({
            visitNumber: completedCount + i,
            dueDate: new Date(startMs + stepMs * i),
            status: 'pending' as const,
          });
        }
      }

      amc.visitSchedule = [...completedList, ...newPendingSchedule];
    }

    if (amc.completedVisits >= amc.totalVisits) {
      amc.status = 'completed';
    }

    if (amc.status === 'cancelled') {
      await this.serviceModel.updateMany(
        {
          businessId: idFilter(businessId),
          amcId: idFilter(amc._id.toString()),
          status: 'pending',
        },
        { $set: { status: 'cancelled' } },
      );
    }

    const saved = await amc.save();
    this.invalidateSync(businessId);
    return saved;
  }

  async remove(businessId: string, amcId: string): Promise<void> {
    const amc = await this.findOne(businessId, amcId);
    await this.serviceModel.updateMany(
      {
        businessId: idFilter(businessId),
        amcId: idFilter(amc._id.toString()),
        status: 'pending',
      },
      { $set: { status: 'cancelled' } },
    );
    await amc.deleteOne();
    this.invalidateSync(businessId);
  }
}
