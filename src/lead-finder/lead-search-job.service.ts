import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LeadSearchJob,
  LeadSearchJobDocument,
} from './schemas/lead-search-job.schema';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { StartLeadSearchDto } from './dto/start-lead-search.dto';
import { LeadProviderRegistry } from './providers/provider-registry.service';
import { DeduplicationService } from './deduplication.service';
import { ProviderUsageService } from './provider-usage.service';

@Injectable()
export class LeadSearchJobService {
  private readonly logger = new Logger(LeadSearchJobService.name);
  private readonly cancelledJobs = new Set<string>();

  constructor(
    @InjectModel(LeadSearchJob.name)
    private readonly jobModel: Model<LeadSearchJobDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    private readonly providerRegistry: LeadProviderRegistry,
    private readonly deduplicationService: DeduplicationService,
    private readonly usageService: ProviderUsageService,
  ) {}

  async createAndStartJob(
    dto: StartLeadSearchDto,
    createdBy = 'admin',
  ): Promise<LeadSearchJobDocument> {
    const provider = this.providerRegistry.getProvider(dto.provider);

    // Create job record in QUEUED status
    const job = new this.jobModel({
      status: 'QUEUED',
      provider: provider.providerId,
      country: dto.country || 'India',
      state: dto.state,
      city: dto.city,
      area: dto.area,
      category: dto.category,
      keyword: dto.keyword || dto.query || '',
      requestedLimit: dto.limit || 50,
      processedCount: 0,
      newLeads: 0,
      duplicateLeads: 0,
      failedCount: 0,
      apiRequestsCount: 0,
      estimatedCostUsd: 0,
      createdBy,
    });

    await job.save();

    // Trigger asynchronous background processing (detached from HTTP response)
    setImmediate(() => {
      this.executeJob(job._id.toString()).catch((err) => {
        this.logger.error(`Error in background search job ${job._id}:`, err);
      });
    });

    return job;
  }

  async getJob(id: string): Promise<LeadSearchJobDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid job ID');
    }
    const job = await this.jobModel.findById(id);
    if (!job) {
      throw new NotFoundException(`Search job "${id}" not found`);
    }
    return job;
  }

  async listJobs(limit = 20): Promise<LeadSearchJobDocument[]> {
    return this.jobModel.find().sort({ createdAt: -1 }).limit(limit).exec();
  }

  async cancelJob(id: string): Promise<LeadSearchJobDocument> {
    const job = await this.getJob(id);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return job;
    }

    this.cancelledJobs.add(id);
    job.status = 'CANCELLED';
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  /**
   * Safe asynchronous job executor with rate limiting and retry logic.
   */
  private async executeJob(jobId: string): Promise<void> {
    const job = await this.jobModel.findById(jobId);
    if (!job || job.status === 'CANCELLED') return;

    job.status = 'RUNNING';
    job.startedAt = new Date();
    await job.save();

    try {
      // 1. Quota check
      const quota = await this.usageService.checkQuotaAvailable(job.provider);
      if (!quota.allowed) {
        throw new Error(quota.reason || 'Daily or monthly provider quota exceeded.');
      }

      const provider = this.providerRegistry.getProvider(job.provider);

      let cursor: string | undefined = undefined;
      let hasMore = true;
      let collectedTotal = 0;
      let totalApiCost = 0;
      let totalRequests = 0;

      const targetLimit = job.requestedLimit;
      let newLeadsCount = 0;
      let scannedTotal = 0;
      const maxScanLimit = Math.max(targetLimit * 3, 60);

      while (hasMore && newLeadsCount < targetLimit && scannedTotal < maxScanLimit) {
        if (this.cancelledJobs.has(jobId)) {
          this.cancelledJobs.delete(jobId);
          job.status = 'CANCELLED';
          job.completedAt = new Date();
          await job.save();
          return;
        }

        const pageSize = 20;

        // Retry loop with exponential backoff
        let result = null;
        let retries = 0;
        const maxRetries = 3;

        while (retries <= maxRetries) {
          try {
            result = await provider.searchBusinesses({
              category: job.category,
              keyword: job.keyword,
              country: job.country,
              state: job.state,
              city: job.city,
              area: job.area,
              limit: pageSize,
              pageCursor: cursor,
            });
            break;
          } catch (err: any) {
            retries++;
            this.logger.warn(
              `Provider search attempt ${retries} failed for job ${jobId}: ${err.message}`,
            );

            // If 401 or 403 or hard quota error, do not retry
            if (
              err.message.includes('401') ||
              err.message.includes('403') ||
              err.message.includes('quota')
            ) {
              throw err;
            }

            if (retries > maxRetries) {
              throw err;
            }

            // Exponential backoff with jitter
            const backoffMs = Math.pow(2, retries) * 1000 + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }

        if (!result) break;

        totalRequests += result.rawRequestsCount;
        totalApiCost += result.estimatedCostUsd;
        cursor = result.nextPageCursor;
        hasMore = result.hasMore && Boolean(cursor);

        // Process leads batch
        for (const candidate of result.items) {
          scannedTotal++;

          try {
            const dedupResult = await this.deduplicationService.findDuplicateAndEnrich(
              candidate,
              jobId,
            );

            if (dedupResult.isDuplicate) {
              job.duplicateLeads += 1;
            } else {
              // Create new lead record
              const phoneNorm = this.deduplicationService.normalizePhoneNumber(
                candidate.phone,
                candidate.country,
              );
              const nameNorm = this.deduplicationService.normalizeBusinessName(
                candidate.businessName,
              );
              const cityNorm = this.deduplicationService.normalizeCity(
                candidate.city,
              );

              const newLead = new this.leadModel({
                ...candidate,
                businessNameNormalized: nameNorm,
                cityNormalized: cityNorm,
                phoneNormalized: phoneNorm,
                status: 'NEW',
                lastCollectedAt: new Date(),
                searchJobId: job._id,
              });

              await newLead.save();
              job.newLeads += 1;
              newLeadsCount += 1;
              if (newLeadsCount >= targetLimit) break;
            }
          } catch (itemErr: any) {
            this.logger.error(`Error processing lead item:`, itemErr);
            job.failedCount += 1;
          }

          job.processedCount += 1;
        }

        job.apiRequestsCount = totalRequests;
        job.estimatedCostUsd = Number(totalApiCost.toFixed(4));
        await job.save();

        // Rate limit throttle between pages (1000ms delay) to avoid 429
        if (hasMore && newLeadsCount < targetLimit && scannedTotal < maxScanLimit) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Record telemetry in usage service
      await this.usageService.recordUsage(
        job.provider,
        totalRequests,
        job.newLeads,
        totalApiCost,
      );

      job.status = 'COMPLETED';
      job.completedAt = new Date();
      await job.save();
      this.logger.log(
        `Lead search job ${jobId} COMPLETED: ${job.newLeads} new leads, ${job.duplicateLeads} duplicates.`,
      );
    } catch (jobErr: any) {
      this.logger.error(`Lead search job ${jobId} FAILED:`, jobErr);
      job.status = 'FAILED';
      job.error = jobErr.message || 'Search execution failed';
      job.completedAt = new Date();
      await job.save();
    }
  }
}
