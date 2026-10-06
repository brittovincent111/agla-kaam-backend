import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type FilterQuery<T = any> = Record<string, any>;
import { Lead, LeadDocument } from './schemas/lead.schema';
import {
  LeadSearchJob,
  LeadSearchJobDocument,
} from './schemas/lead-search-job.schema';
import {
  LeadActivity,
  LeadActivityDocument,
} from './schemas/lead-activity.schema';
import { QueryLeadsDto } from './dto/query-leads.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { ProviderUsageService } from './provider-usage.service';

@Injectable()
export class LeadFinderService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadActivity.name)
    private readonly activityModel: Model<LeadActivityDocument>,
    @InjectModel(LeadSearchJob.name)
    private readonly jobModel: Model<LeadSearchJobDocument>,
    private readonly usageService: ProviderUsageService,
  ) {}

  async queryLeads(dto: QueryLeadsDto): Promise<{
    items: LeadDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const filter: FilterQuery<LeadDocument> = {};

    if (dto.status) filter.status = dto.status;
    if (dto.category) filter.category = dto.category;
    if (dto.city) filter.city = new RegExp(`^${dto.city.trim()}$`, 'i');
    if (dto.state) filter.state = new RegExp(`^${dto.state.trim()}$`, 'i');
    if (dto.area !== undefined && dto.area !== '') {
      filter.area =
        dto.area === '-'
          ? { $in: [null, ''] }
          : new RegExp(`^${dto.area.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }
    if (dto.country) filter.country = dto.country;
    if (dto.source) filter.source = dto.source;

    if (dto.hasPhone === 'true') filter.phone = { $exists: true, $ne: '' };
    if (dto.hasPhone === 'false') filter.phone = { $in: [null, ''] };

    if (dto.hasWebsite === 'true') filter.website = { $exists: true, $ne: '' };
    if (dto.hasWebsite === 'false') filter.website = { $in: [null, ''] };

    if (dto.hasEmail === 'true') filter.email = { $exists: true, $ne: '' };
    if (dto.hasEmail === 'false') filter.email = { $in: [null, ''] };

    if (dto.search && dto.search.trim()) {
      const s = dto.search.trim();
      const regex = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { businessName: regex },
        { email: regex },
        { phone: regex },
        { phoneNormalized: regex },
        { city: regex },
        { address: regex },
        { area: regex },
      ];
    }

    const page = Math.max(1, dto.page || 1);
    const limit = Math.min(100, Math.max(1, dto.limit || 25));
    const skip = (page - 1) * limit;

    const sortField = dto.sortBy || 'createdAt';
    const sortDir = dto.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: sortDir };

    const [items, total] = await Promise.all([
      this.leadModel.find(filter).sort(sort).skip(skip).limit(limit).exec(),
      this.leadModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getLeadById(id: string): Promise<{
    lead: LeadDocument;
    activities: LeadActivityDocument[];
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid lead ID');
    }

    const lead = await this.leadModel.findById(id).exec();
    if (!lead) {
      throw new NotFoundException(`Lead "${id}" not found`);
    }

    const activities = await this.activityModel
      .find({ leadId: new Types.ObjectId(id) })
      .sort({ createdAt: -1 })
      .exec();

    return { lead, activities };
  }

  async updateLead(id: string, dto: UpdateLeadDto): Promise<LeadDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid lead ID');
    }

    const lead = await this.leadModel.findById(id).exec();
    if (!lead) {
      throw new NotFoundException(`Lead "${id}" not found`);
    }

    if (dto.status !== undefined) lead.status = dto.status;
    if (dto.tags !== undefined) lead.tags = dto.tags;
    if (dto.notes !== undefined) lead.notes = dto.notes;
    if (dto.phone !== undefined) lead.phone = dto.phone;
    if (dto.email !== undefined) lead.email = dto.email;
    if (dto.website !== undefined) lead.website = dto.website;

    return lead.save();
  }

  async logActivity(
    leadId: string,
    dto: CreateLeadActivityDto,
    performedBy = 'Admin',
  ): Promise<LeadActivityDocument> {
    if (!Types.ObjectId.isValid(leadId)) {
      throw new BadRequestException('Invalid lead ID');
    }

    const lead = await this.leadModel.findById(leadId).exec();
    if (!lead) {
      throw new NotFoundException(`Lead "${leadId}" not found`);
    }

    const activity = new this.activityModel({
      leadId: lead._id,
      type: dto.type,
      message: dto.message || '',
      notes: dto.notes || '',
      performedBy,
    });

    await activity.save();

    // Update lead lastContactedAt and status transition if relevant
    lead.lastContactedAt = new Date();
    if (dto.type === 'CONTACTED' && lead.status === 'NEW') {
      lead.status = 'CONTACTED';
    } else if (dto.type === 'INTERESTED') {
      lead.status = 'INTERESTED';
    } else if (dto.type === 'NOT_INTERESTED') {
      lead.status = 'NOT_INTERESTED';
    } else if (dto.type === 'INSTALL') {
      lead.status = 'INSTALLED';
    }

    await lead.save();

    return activity;
  }

  async exportCsv(dto: QueryLeadsDto): Promise<string> {
    const filter: FilterQuery<LeadDocument> = {};

    if (dto.status) filter.status = dto.status;
    if (dto.category) filter.category = dto.category;
    if (dto.city) filter.city = new RegExp(`^${dto.city.trim()}$`, 'i');

    // CRITICAL PRIVACY & COMPLIANCE GUARD:
    // Never export DO_NOT_CONTACT leads to outreach files
    filter.status = { $ne: 'DO_NOT_CONTACT' };

    const leads = await this.leadModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .exec();

    const headers = [
      'Business Name',
      'Category',
      'City',
      'Area',
      'Address',
      'Phone',
      'Website',
      'Rating',
      'Review Count',
      'Source',
      'Status',
      'Created At',
      'Source URL',
    ];

    const escapeCsv = (val?: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = leads.map((l) => [
      escapeCsv(l.businessName),
      escapeCsv(l.category),
      escapeCsv(l.city),
      escapeCsv(l.area || ''),
      escapeCsv(l.address || ''),
      escapeCsv(l.phone || ''),
      escapeCsv(l.website || ''),
      escapeCsv(l.rating ?? ''),
      escapeCsv(l.reviewCount ?? ''),
      escapeCsv(l.source),
      escapeCsv(l.status),
      escapeCsv(l.createdAt ? new Date(l.createdAt).toISOString() : ''),
      escapeCsv(l.sourceUrl || ''),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  async getAnalytics(): Promise<{
    funnel: {
      total: number;
      newCount: number;
      reviewedCount: number;
      contactedCount: number;
      repliedCount: number;
      interestedCount: number;
      installedCount: number;
      notInterestedCount: number;
      invalidCount: number;
      doNotContactCount: number;
      rates: {
        contactToReply: number;
        replyToInterested: number;
        interestedToInstalled: number;
        overallLeadToInstall: number;
      };
    };
    breakdowns: {
      byCity: { city: string; count: number }[];
      byCategory: { category: string; count: number }[];
      bySource: { source: string; count: number }[];
      recentTrend30d: { date: string; count: number }[];
    };
    costTelemetry: any;
  }> {
    const [statusAgg, cityAgg, catAgg, sourceAgg, trendAgg, costTelemetry] =
      await Promise.all([
        this.leadModel.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.leadModel.aggregate([
          { $group: { _id: '$city', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        this.leadModel.aggregate([
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        this.leadModel.aggregate([
          { $group: { _id: '$source', count: { $sum: 1 } } },
        ]),
        this.leadModel.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        this.usageService.getTelemetrySummary('google_places'),
      ]);

    const counts: Record<string, number> = {};
    let total = 0;
    statusAgg.forEach((item) => {
      counts[item._id] = item.count;
      total += item.count;
    });

    const newCount = counts['NEW'] || 0;
    const reviewedCount = counts['REVIEWED'] || 0;
    const contactedCount = counts['CONTACTED'] || 0;
    const repliedCount = counts['REPLIED'] || 0;
    const interestedCount = counts['INTERESTED'] || 0;
    const installedCount = counts['INSTALLED'] || 0;
    const notInterestedCount = counts['NOT_INTERESTED'] || 0;
    const invalidCount = counts['INVALID'] || 0;
    const doNotContactCount = counts['DO_NOT_CONTACT'] || 0;

    const contactToReply =
      contactedCount > 0 ? (repliedCount / contactedCount) * 100 : 0;
    const replyToInterested =
      repliedCount > 0 ? (interestedCount / repliedCount) * 100 : 0;
    const interestedToInstalled =
      interestedCount > 0 ? (installedCount / interestedCount) * 100 : 0;
    const overallLeadToInstall = total > 0 ? (installedCount / total) * 100 : 0;

    return {
      funnel: {
        total,
        newCount,
        reviewedCount,
        contactedCount,
        repliedCount,
        interestedCount,
        installedCount,
        notInterestedCount,
        invalidCount,
        doNotContactCount,
        rates: {
          contactToReply: Number(contactToReply.toFixed(1)),
          replyToInterested: Number(replyToInterested.toFixed(1)),
          interestedToInstalled: Number(interestedToInstalled.toFixed(1)),
          overallLeadToInstall: Number(overallLeadToInstall.toFixed(2)),
        },
      },
      breakdowns: {
        byCity: cityAgg.map((c) => ({
          city: c._id || 'Unknown',
          count: c.count,
        })),
        byCategory: catAgg.map((c) => ({
          category: c._id || 'Other',
          count: c.count,
        })),
        bySource: sourceAgg.map((s) => ({
          source: s._id || 'other',
          count: s.count,
        })),
        recentTrend30d: trendAgg.map((t) => ({ date: t._id, count: t.count })),
      },
      costTelemetry,
    };
  }

  /** Leads per trade, and how far they have got — to see which trades install. */
  async getTrades(city?: string) {
    const match: Record<string, any> = {};
    if (city?.trim()) match.city = new RegExp(`^${escapeRx(city.trim())}$`, 'i');
    const has = (field: string) => ({ $cond: [{ $gt: [{ $strLenCP: { $ifNull: [field, ''] } }, 0] }, 1, 0] });
    const is = (...statuses: string[]) => ({ $cond: [{ $in: ['$status', statuses] }, 1, 0] });
    const rows = await this.leadModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          total: { $sum: 1 },
          mobile: { $sum: { $cond: [{ $eq: ['$phoneType', 'mobile'] }, 1, 0] } },
          withEmail: { $sum: has('$email') },
          contacted: { $sum: is('CONTACTED', 'REPLIED', 'INTERESTED', 'INSTALLED', 'NOT_INTERESTED') },
          replied: { $sum: is('REPLIED', 'INTERESTED', 'INSTALLED', 'NOT_INTERESTED') },
          interested: { $sum: is('INTERESTED', 'INSTALLED') },
          installed: { $sum: is('INSTALLED') },
        },
      },
      { $sort: { total: -1 } },
    ]);
    return rows.map((r: any) => ({ category: r._id || 'other', ...r, _id: undefined }));
  }

  /**
   * Leads per searched locality: how many were captured, how many can be
   * reached, and how far they have moved — with the searches that ran there.
   */
  async getLocalities(city?: string, category?: string) {
    const match: Record<string, any> = {};
    if (city?.trim()) match.city = new RegExp(`^${escapeRx(city.trim())}$`, 'i');
    if (category) match.category = category;
    const has = (field: string) => ({ $cond: [{ $gt: [{ $strLenCP: { $ifNull: [field, ''] } }, 0] }, 1, 0] });
    const is = (...statuses: string[]) => ({ $cond: [{ $in: ['$status', statuses] }, 1, 0] });

    const [leadRows, jobRows] = await Promise.all([
      this.leadModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: { city: { $toLower: { $ifNull: ['$city', ''] } }, area: { $toLower: { $trim: { input: { $ifNull: ['$area', ''] } } } } },
            city: { $first: '$city' },
            area: { $first: '$area' },
            total: { $sum: 1 },
            mobile: { $sum: { $cond: [{ $eq: ['$phoneType', 'mobile'] }, 1, 0] } },
            withPhone: { $sum: has('$phoneNormalized') },
            withEmail: { $sum: has('$email') },
            fresh: { $sum: is('NEW', 'REVIEWED') },
            contacted: { $sum: is('CONTACTED', 'REPLIED', 'INTERESTED', 'INSTALLED', 'NOT_INTERESTED') },
            replied: { $sum: is('REPLIED', 'INTERESTED', 'INSTALLED', 'NOT_INTERESTED') },
            interested: { $sum: is('INTERESTED', 'INSTALLED') },
            installed: { $sum: is('INSTALLED') },
            lastAddedAt: { $max: '$createdAt' },
          },
        },
      ]),
      this.jobModel.aggregate([
        { $match: { ...match, status: { $in: ['COMPLETED', 'RUNNING', 'FAILED', 'CANCELLED'] } } },
        {
          $group: {
            _id: { city: { $toLower: { $ifNull: ['$city', ''] } }, area: { $toLower: { $trim: { input: { $ifNull: ['$area', ''] } } } } },
            city: { $first: '$city' },
            area: { $first: '$area' },
            searches: { $sum: 1 },
            newLeads: { $sum: '$newLeads' },
            duplicates: { $sum: '$duplicateLeads' },
            costUsd: { $sum: '$estimatedCostUsd' },
            lastSearchedAt: { $max: '$createdAt' },
          },
        },
      ]),
    ]);

    const key = (r: any) => `${r._id.city}|${r._id.area}`;
    const jobs = new Map(jobRows.map((j: any) => [key(j), j]));
    const rows = leadRows.map((r: any) => {
      const j: any = jobs.get(key(r));
      jobs.delete(key(r));
      return { ...this.localityRow(r), ...this.jobPart(j) };
    });
    // Searches that found nothing new still belong on the list.
    for (const j of jobs.values()) {
      rows.push({ ...this.localityRow({ city: j.city, area: j.area }), ...this.jobPart(j) });
    }
    return rows.sort((a, b) => a.city.localeCompare(b.city) || b.total - a.total);
  }

  private localityRow(r: any) {
    return {
      city: r.city || 'Unknown',
      area: (r.area || '').trim(),
      total: r.total ?? 0,
      mobile: r.mobile ?? 0,
      withPhone: r.withPhone ?? 0,
      withEmail: r.withEmail ?? 0,
      fresh: r.fresh ?? 0,
      contacted: r.contacted ?? 0,
      replied: r.replied ?? 0,
      interested: r.interested ?? 0,
      installed: r.installed ?? 0,
      lastAddedAt: r.lastAddedAt ?? null,
    };
  }

  private jobPart(j: any) {
    return {
      searches: j?.searches ?? 0,
      duplicates: j?.duplicates ?? 0,
      costUsd: Number((j?.costUsd ?? 0).toFixed(3)),
      lastSearchedAt: j?.lastSearchedAt ?? null,
    };
  }
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
