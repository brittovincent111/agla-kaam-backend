import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LeadSchedule,
  LeadScheduleDocument,
} from './schemas/lead-schedule.schema';
import { CreateLeadScheduleDto } from './dto/create-lead-schedule.dto';
import { LeadSearchJobService } from './lead-search-job.service';
import { LeadProviderRegistry } from './providers/provider-registry.service';
import { ProviderUsageService } from './provider-usage.service';

@Injectable()
export class LeadScheduleService {
  private readonly logger = new Logger(LeadScheduleService.name);

  constructor(
    @InjectModel(LeadSchedule.name)
    private readonly scheduleModel: Model<LeadScheduleDocument>,
    private readonly searchJobService: LeadSearchJobService,
    private readonly providerRegistry: LeadProviderRegistry,
    private readonly usageService: ProviderUsageService,
  ) {}

  async createSchedule(dto: CreateLeadScheduleDto): Promise<LeadScheduleDocument> {
    const schedule = new this.scheduleModel({
      name: dto.name,
      provider: dto.provider || 'google_places',
      country: dto.country || 'India',
      state: dto.state,
      city: dto.city,
      category: dto.category,
      keyword: dto.keyword,
      limit: dto.limit || 50,
      cronExpression: dto.cronExpression || '0 2 * * *',
      status: 'ACTIVE',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Default next day
    });

    return schedule.save();
  }

  async listSchedules(): Promise<LeadScheduleDocument[]> {
    return this.scheduleModel.find().sort({ createdAt: -1 }).exec();
  }

  async getSchedule(id: string): Promise<LeadScheduleDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ID');
    const schedule = await this.scheduleModel.findById(id);
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  async updateSchedule(
    id: string,
    updates: Partial<LeadSchedule>,
  ): Promise<LeadScheduleDocument> {
    const schedule = await this.getSchedule(id);
    Object.assign(schedule, updates);
    return schedule.save();
  }

  async deleteSchedule(id: string): Promise<{ deleted: boolean }> {
    const res = await this.scheduleModel.findByIdAndDelete(id);
    return { deleted: Boolean(res) };
  }

  async triggerScheduleRun(id: string): Promise<{ jobId: string }> {
    const schedule = await this.getSchedule(id);

    // Verify provider quota availability
    const quota = await this.usageService.checkQuotaAvailable(schedule.provider);
    if (!quota.allowed) {
      throw new BadRequestException(quota.reason);
    }

    const job = await this.searchJobService.createAndStartJob(
      {
        country: schedule.country,
        state: schedule.state,
        city: schedule.city,
        category: schedule.category,
        keyword: schedule.keyword,
        limit: schedule.limit,
        provider: schedule.provider,
      },
      `schedule:${schedule.name}`,
    );

    schedule.lastRunAt = new Date();
    await schedule.save();

    return { jobId: job._id.toString() };
  }

  /**
   * Manually triggers active scheduled jobs whose time has arrived or was requested.
   */
  async triggerDueSchedules(): Promise<{ triggeredCount: number; jobIds: string[] }> {
    const now = new Date();
    const dueSchedules = await this.scheduleModel.find({
      status: 'ACTIVE',
      $or: [{ nextRunAt: { $lte: now } }, { nextRunAt: { $exists: false } }],
    });

    if (dueSchedules.length === 0) return { triggeredCount: 0, jobIds: [] };

    this.logger.log(`Triggering ${dueSchedules.length} due lead generation schedules...`);
    const jobIds: string[] = [];

    for (const schedule of dueSchedules) {
      try {
        const quota = await this.usageService.checkQuotaAvailable(schedule.provider);
        if (!quota.allowed) {
          this.logger.warn(`Skipping schedule "${schedule.name}": ${quota.reason}`);
          continue;
        }

        const job = await this.searchJobService.createAndStartJob(
          {
            country: schedule.country,
            state: schedule.state,
            city: schedule.city,
            category: schedule.category,
            keyword: schedule.keyword,
            limit: schedule.limit,
            provider: schedule.provider,
          },
          `schedule:${schedule.name}`,
        );

        jobIds.push(job._id.toString());
        schedule.lastRunAt = now;
        schedule.nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await schedule.save();
      } catch (err: any) {
        this.logger.error(`Error running schedule "${schedule.name}":`, err);
      }
    }

    return { triggeredCount: jobIds.length, jobIds };
  }
}
