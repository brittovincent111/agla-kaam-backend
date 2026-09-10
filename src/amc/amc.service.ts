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
import { Amc, AmcDocument } from './schemas/amc.schema';
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

@Injectable()
export class AmcService {
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
    const count = await this.amcModel.countDocuments({ businessId }).exec();
    return `AMC-${String(count + 1).padStart(4, '0')}`;
  }

  async syncAmcServices(businessId: string): Promise<void> {
    const activeAmcs = await this.amcModel
      .find({ businessId, status: 'active' })
      .exec();

    for (const amc of activeAmcs) {
      if (!amc.visitSchedule || amc.visitSchedule.length === 0) continue;

      const allPending = amc.visitSchedule.filter((v) => v.status === 'pending');
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
      const nextVisit = allPending.length > 1 ? allPending[1] : null;
      const title = amc.planName
        ? `${amc.planName} (${amc.serviceType})`
        : amc.serviceType;

      if (currentVisit.serviceId) {
        const existingService = await this.serviceModel.findById(currentVisit.serviceId).exec();
        if (existingService && existingService.status === 'pending') {
          const expectedDate = currentVisit.dueDate ?? amc.startDate;
          if (expectedDate && existingService.serviceDate?.getTime() !== expectedDate.getTime()) {
            existingService.serviceDate = expectedDate;
            if (nextVisit) {
              existingService.nextServiceDate = nextVisit.dueDate;
            }
            await existingService.save();
          }
        }
        continue;
      }

      const createdService = await this.serviceModel.create({
        businessId,
        customerId: amc.customerId,
        serviceType: title,
        status: 'pending',
        // The contract's own schedule decides the date, so reminders follow
        // what the customer actually bought.
        serviceDate: currentVisit.dueDate ?? amc.startDate ?? new Date(),
        warrantyPeriod: 'none',
        nextServiceInterval: nextVisit ? 'custom' : 'none',
        nextServiceDate: nextVisit
          ? nextVisit.dueDate
          : (currentVisit.dueDate ?? amc.startDate),
        amcId: amc._id,
        notes: amc.notes
          ? `AMC ${amc.contractNumber}: ${amc.notes}`
          : `AMC ${amc.contractNumber} - Visit #${currentVisit.visitNumber}`,
      });

      currentVisit.serviceId = createdService._id;
      await amc.save();
    }
  }

  async create(businessId: string, dto: CreateAmcDto): Promise<AmcDocument> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    const hasUnlimitedAmc = tier === 'reminders' || tier === 'combo';
    if (!hasUnlimitedAmc) {
      const currentAmcCount = await this.amcModel.countDocuments({ businessId }).exec();
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

    await this.syncAmcServices(businessId);

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

  async findOnePopulated(businessId: string, amcId: string): Promise<AmcDocument> {
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
      { businessId },
      options.customerId ? { customerId: idFilter(options.customerId) } : {},
      options.status && options.status !== 'all' ? { status: options.status } : {},
      numberOrCustomerFilter(options.search, 'contractNumber', customerIds, idsFilter),
      pageCursorFilter(cursor, 'createdAt', 'desc'),
    );

    const [rows, total] = await Promise.all([
      this.amcModel
        .find(filter)
        .sort(pageSort('createdAt', 'desc'))
        .limit(limit + 1)
        .populate('customerId', 'name phone')
        .exec(),
      cursor ? Promise.resolve(undefined) : this.amcModel.countDocuments(filter).exec(),
    ]);

    return buildPage(rows, limit, (row) => ({
      v: (row as unknown as { createdAt: Date }).createdAt.toISOString(),
      id: (row._id as { toString(): string }).toString(),
    }), total);
  }

  async findAllForBusiness(
    businessId: string,
    filters: { status?: string; customerId?: string },
  ): Promise<AmcDocument[]> {
    await this.syncAmcServices(businessId);

    const query: Record<string, unknown> = { businessId };
    if (filters.customerId) {
      query.customerId = filters.customerId;
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

  async logVisit(
    businessId: string,
    amcId: string,
    serviceId?: string,
  ): Promise<AmcDocument> {
    const amc = await this.findOne(businessId, amcId);
    if (amc.status === 'cancelled' || amc.status === 'expired') {
      throw new BadRequestException(`Cannot log visit for a ${amc.status} AMC contract`);
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

    if (amc.completedVisits >= amc.totalVisits) {
      amc.status = 'completed';
    }
    return amc.save();
  }

  async skipVisit(
    businessId: string,
    amcId: string,
  ): Promise<AmcDocument> {
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
    if (amc.completedVisits >= amc.totalVisits) {
      amc.status = 'completed';
    }
    await amc.save();
    await this.syncAmcServices(businessId);
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
        const baseDate = new Date(completedList[completedList.length - 1].dueDate);
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
        { businessId, amcId: amc._id, status: 'pending' },
        { $set: { status: 'cancelled' } },
      );
    }

    return amc.save();
  }

  async remove(businessId: string, amcId: string): Promise<void> {
    const amc = await this.findOne(businessId, amcId);
    await this.serviceModel.updateMany(
      { businessId, amcId: amc._id, status: 'pending' },
      { $set: { status: 'cancelled' } },
    );
    await amc.deleteOne();
  }
}
