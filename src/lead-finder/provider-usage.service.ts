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

  // Google bills our searches as Text Search Enterprise (they ask for phone,
  // website and rating). Free each month: 7,000 on the India price list
  // (billing account in India), 1,000 on the global list — set
  // LEAD_FINDER_FREE_MONTHLY to match the billing account; 1,000 if unset.
  // The monthly cap never goes above the free amount unless
  // LEAD_FINDER_ALLOW_PAID=true, whatever LEAD_FINDER_MONTHLY_LIMIT says.
  static readonly GOOGLE_FREE_MONTHLY = 1000;
  readonly freeMonthly: number;
  private readonly dailyMaxRequests: number;
  private readonly monthlyMaxRequests: number;
  readonly allowPaid: boolean;

  constructor(
    @InjectModel(LeadProviderUsage.name)
    private readonly usageModel: Model<LeadProviderUsageDocument>,
    private readonly configService: ConfigService,
  ) {
    this.allowPaid = this.configService.get<string>('LEAD_FINDER_ALLOW_PAID') === 'true';
    this.freeMonthly =
      parseInt(this.configService.get<string>('LEAD_FINDER_FREE_MONTHLY') || '', 10) ||
      ProviderUsageService.GOOGLE_FREE_MONTHLY;
    // Stay well clear of the free amount (default 20% gap): Google counts the
    // month in Pacific time, retries and other projects on the same billing
    // account count too, so running right up to it risks a charge.
    const gapPct = Math.max(
      0,
      Math.min(90, parseInt(this.configService.get<string>('LEAD_FINDER_SAFETY_GAP_PERCENT') || '', 10) || 20),
    );
    const safeFree = Math.floor((this.freeMonthly * (100 - gapPct)) / 100);
    const monthly = parseInt(this.configService.get<string>('LEAD_FINDER_MONTHLY_LIMIT') || '', 10) || safeFree;
    this.monthlyMaxRequests = this.allowPaid ? monthly : Math.min(monthly, safeFree);
    this.dailyMaxRequests = Math.min(
      parseInt(this.configService.get<string>('LEAD_FINDER_DAILY_LIMIT') || '', 10) || Math.ceil(safeFree / 30),
      this.monthlyMaxRequests,
    );
    if (!this.allowPaid && monthly > safeFree) {
      this.logger.warn(
        `LEAD_FINDER_MONTHLY_LIMIT=${monthly} is above ${safeFree} (Google's free ${this.freeMonthly} minus a ${gapPct}% gap); capped. Set LEAD_FINDER_ALLOW_PAID=true to allow paid searches.`,
      );
    }
  }

  private getDateKeys(): { dateKey: string; monthKey: string } {
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const monthKey = dateKey.slice(0, 7); // YYYY-MM
    return { dateKey, monthKey };
  }

  async checkQuotaAvailable(
    provider = 'google_places',
  ): Promise<{ allowed: boolean; reason?: string }> {
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

  get monthlyLimit(): number {
    return this.monthlyMaxRequests;
  }

  /** Provider calls so far this calendar month (UTC month, as recorded). */
  async monthRequests(provider = 'google_places'): Promise<number> {
    const { monthKey } = this.getDateKeys();
    const agg = await this.usageModel.aggregate([
      { $match: { provider, monthKey } },
      { $group: { _id: null, total: { $sum: '$requestCount' } } },
    ]);
    return agg[0]?.total || 0;
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
      todayEstimatedCostUsd: Number(
        (todayDoc?.estimatedCostUsd || 0).toFixed(3),
      ),
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
