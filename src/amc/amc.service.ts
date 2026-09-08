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

      const pendingVisit = amc.visitSchedule.find((v) => v.status === 'pending');
      if (!pendingVisit) continue;

      // Check if there is already a Service created for this AMC
      const existingService = await this.serviceModel
        .findOne({ businessId, amcId: amc._id })
        .exec();

      if (!existingService) {
        const title = amc.planName
          ? `${amc.planName} (${amc.serviceType})`
          : amc.serviceType;

        const allPending = amc.visitSchedule.filter((v) => v.status === 'pending');
        const currentVisit = allPending[0];
        const nextVisit = allPending.length > 1 ? allPending[1] : null;

        const createdService = await this.serviceModel.create({
          businessId,
          customerId: amc.customerId,
          serviceType: title,
          status: 'pending',
          serviceDate: currentVisit ? currentVisit.dueDate : (amc.startDate || new Date()),
          warrantyPeriod: 'none',
          nextServiceInterval: nextVisit ? 'custom' : 'none',
          nextServiceDate: nextVisit ? nextVisit.dueDate : (currentVisit ? currentVisit.dueDate : amc.startDate),
          amcId: amc._id,
          notes: amc.notes
            ? `AMC ${amc.contractNumber}: ${amc.notes}`
            : `AMC ${amc.contractNumber} - Visit #${pendingVisit.visitNumber}`,
        });

        pendingVisit.serviceId = createdService._id;
        await amc.save();
      }
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

      const baseDate =
        completedList.length > 0
          ? new Date(completedList[completedList.length - 1].dueDate)
          : amc.startDate;
      const endMs = amc.endDate.getTime();
      const startMs = baseDate.getTime();
      const totalMs = Math.max(0, endMs - startMs);
      const stepMs = remainingCount > 0 ? totalMs / (remainingCount + 1) : 0;

      const newPendingSchedule = [];
      for (let i = 1; i <= remainingCount; i++) {
        newPendingSchedule.push({
          visitNumber: completedCount + i,
          dueDate: new Date(startMs + stepMs * i),
          status: 'pending' as const,
        });
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
