import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  LeadProviderUsage,
  LeadProviderUsageDocument,
} from './schemas/lead-provider-usage.schema';

@Injectable()
export class ProviderUsageService {
  private readonly logger = new Logger(ProviderUsageService.name);

  // Default safety caps: 250 requests/day, 3000 requests/month unless overridden
  private readonly dailyMaxRequests: number;
  private readonly monthlyMaxRequests: number;

  constructor(
    @InjectModel(LeadProviderUsage.name)
    private readonly usageModel: Model<LeadProviderUsageDocument>,
    private readonly configService: ConfigService,
  ) {
    this.dailyMaxRequests = parseInt(
      this.configService.get<string>('LEAD_FINDER_DAILY_LIMIT') || '250',
      10,
    );
    this.monthlyMaxRequests = parseInt(
      this.configService.get<string>('LEAD_FINDER_MONTHLY_LIMIT') || '3000',
      10,
    );
  }

  private getDateKeys(): { dateKey: string; monthKey: string } {
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const monthKey = dateKey.slice(0, 7); // YYYY-MM
    return { dateKey, monthKey };
  }

  async checkQuotaAvailable(provider = 'google_places'): Promise<{ allowed: boolean; reason?: string }> {
    const { dateKey, monthKey } = this.getDateKeys();

    const dailyRecord = await this.usageModel.findOne({ provider, dateKey });
    if (dailyRecord && dailyRecord.requestCount >= this.dailyMaxRequests) {
      return {
        allowed: false,
        reason: `Daily quota limit reached for ${provider} (${dailyRecord.requestCount}/${this.dailyMaxRequests} requests).`,
      };
    }

    const monthlyAggregate = await this.usageModel.aggregate([
      { $match: { provider, monthKey } },
      { $group: { _id: null, totalRequests: { $sum: '$requestCount' } } },
    ]);

    const monthTotal = monthlyAggregate[0]?.totalRequests || 0;
    if (monthTotal >= this.monthlyMaxRequests) {
      return {
        allowed: false,
        reason: `Monthly quota limit reached for ${provider} (${monthTotal}/${this.monthlyMaxRequests} requests).`,
      };
    }

    return { allowed: true };
  }

  async recordUsage(
    provider: string,
    requestsCount: number,
    leadsCount: number,
    costUsd: number,
  ): Promise<void> {
    const { dateKey, monthKey } = this.getDateKeys();

    await this.usageModel.updateOne(
      { provider, dateKey },
      {
        $setOnInsert: { provider, dateKey, monthKey },
        $inc: {
          requestCount: requestsCount,
          leadsDiscovered: leadsCount,
          estimatedCostUsd: costUsd,
        },
      },
      { upsert: true },
    );
  }

  async getTelemetrySummary(provider = 'google_places'): Promise<{
    todayRequests: number;
    todayLeads: number;
    todayEstimatedCostUsd: number;
    monthRequests: number;
    monthEstimatedCostUsd: number;
    dailyLimit: number;
    monthlyLimit: number;
    /** Month-to-date spend. The admin page shows this against monthlyLimit. */
    totalCostUsd: number;
    totalCostInr: number;
    /** Requests left in today's budget, never negative. */
    remainingToday: number;
  }> {
    const { dateKey, monthKey } = this.getDateKeys();

    const todayDoc = await this.usageModel.findOne({ provider, dateKey });

    const monthAgg = await this.usageModel.aggregate([
      { $match: { provider, monthKey } },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: '$requestCount' },
          totalCost: { $sum: '$estimatedCostUsd' },
        },
      },
    ]);

    const todayRequests = todayDoc?.requestCount || 0;
    const monthCostUsd = Number((monthAgg[0]?.totalCost || 0).toFixed(2));

    // Derived here rather than in the admin page. These three were read by
    // the analytics screen but never sent, so costTelemetry arrived as a
    // truthy object missing them — its `|| defaults` fallback could not fire
    // and totalCostUsd.toFixed() threw on undefined.
    return {
      todayRequests,
      todayLeads: todayDoc?.leadsDiscovered || 0,
      todayEstimatedCostUsd: Number((todayDoc?.estimatedCostUsd || 0).toFixed(3)),
      monthRequests: monthAgg[0]?.totalRequests || 0,
      monthEstimatedCostUsd: monthCostUsd,
      dailyLimit: this.dailyMaxRequests,
      monthlyLimit: this.monthlyMaxRequests,
      totalCostUsd: monthCostUsd,
      // Indicative only — a display conversion for a spend figure, not money
      // that moves. Set USD_TO_INR_RATE to keep it current.
      totalCostInr: Number(
        (monthCostUsd * Number(process.env.USD_TO_INR_RATE ?? 88)).toFixed(2),
      ),
      remainingToday: Math.max(0, this.dailyMaxRequests - todayRequests),
    };
  }
}
