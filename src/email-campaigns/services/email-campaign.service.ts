import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EmailCampaign,
  EmailCampaignDocument,
} from '../schemas/email-campaign.schema';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientDocument,
} from '../schemas/email-campaign-recipient.schema';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { UpdateCampaignDto } from '../dto/update-campaign.dto';
import {
  QueryCampaignRecipientsDto,
  QueryCampaignsDto,
} from '../dto/query-campaigns.dto';
import { SendTestEmailDto } from '../dto/send-test-email.dto';
import { EmailCampaignQueueService } from './email-campaign-queue.service';
import { SesService } from './ses.service';
import { TemplateEngineService } from './template-engine.service';
import { UnsubscribeService } from './unsubscribe.service';

@Injectable()
export class EmailCampaignService {
  private readonly logger = new Logger(EmailCampaignService.name);

  constructor(
    @InjectModel(EmailCampaign.name)
    private readonly campaignModel: Model<EmailCampaignDocument>,
    @InjectModel(EmailCampaignRecipient.name)
    private readonly recipientModel: Model<EmailCampaignRecipientDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    private readonly queueService: EmailCampaignQueueService,
    private readonly sesService: SesService,
    private readonly templateEngine: TemplateEngineService,
    private readonly unsubscribeService: UnsubscribeService,
  ) {}

  /**
   * Creates a new draft campaign.
   */
  async createCampaign(
    dto: CreateCampaignDto,
    createdBy = 'Admin',
  ): Promise<EmailCampaignDocument> {
    const selectedLeads = dto.selectedLeadIds
      ? dto.selectedLeadIds
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id))
      : [];

    const campaign = new this.campaignModel({
      name: dto.name,
      subject: dto.subject,
      htmlContent: dto.htmlContent,
      emailContent: dto.emailContent,
      plainTextOnly: dto.plainTextOnly ?? false,
      senderName: dto.senderName || 'Agla Kaam',
      senderEmail: dto.senderEmail || this.sesService.getDefaultSender(),
      replyTo: dto.replyTo,
      leadFilters: dto.leadFilters,
      selectedLeads,
      skipAlreadyEmailed: dto.skipAlreadyEmailed ?? true,
      followUps: dto.followUps ?? [],
      status: 'DRAFT',
      createdBy,
    });

    return campaign.save();
  }

  /**
   * Updates an existing campaign (only allowed when in DRAFT status).
   */
  async updateCampaign(
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<EmailCampaignDocument> {
    const campaign = await this.getCampaignById(id);

    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot edit campaign in "${campaign.status}" state. Only DRAFT campaigns can be modified.`,
      );
    }

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.subject !== undefined) campaign.subject = dto.subject;
    if (dto.htmlContent !== undefined) campaign.htmlContent = dto.htmlContent;
    if (dto.emailContent !== undefined)
      campaign.emailContent = dto.emailContent;
    if (dto.plainTextOnly !== undefined) campaign.plainTextOnly = dto.plainTextOnly;
    if (dto.senderName !== undefined) campaign.senderName = dto.senderName;
    if (dto.senderEmail !== undefined) campaign.senderEmail = dto.senderEmail;
    if (dto.replyTo !== undefined) campaign.replyTo = dto.replyTo;
    if (dto.leadFilters !== undefined)
      campaign.leadFilters = dto.leadFilters as any;
    if (dto.skipAlreadyEmailed !== undefined)
      campaign.skipAlreadyEmailed = dto.skipAlreadyEmailed;
    if (dto.followUps !== undefined) campaign.followUps = dto.followUps as any;
    if (dto.selectedLeadIds !== undefined) {
      campaign.selectedLeads = dto.selectedLeadIds
        .filter((i) => Types.ObjectId.isValid(i))
        .map((i) => new Types.ObjectId(i));
    }

    return campaign.save();
  }

  /**
   * Deletes a campaign (only allowed when in DRAFT status).
   */
  async deleteCampaign(
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    const campaign = await this.getCampaignById(id);

    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot delete campaign in "${campaign.status}" state. Only DRAFT campaigns can be deleted.`,
      );
    }

    await this.recipientModel.deleteMany({ campaignId: campaign._id });
    await this.campaignModel.findByIdAndDelete(campaign._id);

    return {
      success: true,
      message: `Campaign "${campaign.name}" deleted successfully`,
    };
  }

  /**
   * Retrieves single campaign by ID.
   */
  async getCampaignById(id: string): Promise<EmailCampaignDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid campaign ID');
    }
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) {
      throw new NotFoundException(`Campaign "${id}" not found`);
    }
    return campaign;
  }

  /**
   * Lists campaigns with pagination and filtering.
   */
  async listCampaigns(query: QueryCampaignsDto): Promise<{
    items: EmailCampaignDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const filter: Record<string, any> = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const regex = new RegExp(
        query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [{ name: regex }, { subject: regex }];
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.campaignModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.campaignModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Queries and deduplicates eligible leads based on campaign filters.
   */
  async getEligibleLeads(campaign: EmailCampaignDocument): Promise<
    {
      leadId: Types.ObjectId;
      email: string;
      businessName?: string;
      displayName?: string;
      city?: string;
      category?: string;
    }[]
  > {
    const filter: Record<string, any> = {
      // Must have valid email
      email: { $exists: true, $ne: '', $regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      // Must NOT be unsubscribed or bounced
      isEmailUnsubscribed: { $ne: true },
      emailBounceStatus: { $in: [null, 'NONE'] },
      // Must NOT be do-not-contact, invalid, already said no, or already a user
      status: { $nin: ['DO_NOT_CONTACT', 'INVALID', 'NOT_INTERESTED', 'INSTALLED'] },
    };

    // Specific leads selected by admin
    if (campaign.selectedLeads && campaign.selectedLeads.length > 0) {
      filter._id = { $in: campaign.selectedLeads };
    }

    // Dynamic segment filters
    const filters = campaign.leadFilters;
    if (filters) {
      if (filters.status && !['DO_NOT_CONTACT', 'INVALID', 'NOT_INTERESTED', 'INSTALLED'].includes(filters.status))
        filter.status = filters.status;
      if (filters.category) filter.category = filters.category;
      if (filters.city)
        filter.city = new RegExp(`^${filters.city.trim()}$`, 'i');
      if (filters.state)
        filter.state = new RegExp(`^${filters.state.trim()}$`, 'i');
      if (filters.country) filter.country = filters.country;
      if (filters.source) filter.source = filters.source;
      if (filters.tags && filters.tags.length > 0) {
        filter.tags = { $in: filters.tags };
      }
    }

    // Use aggregation to group and deduplicate by normalized lowercase email
    const pipeline: any[] = [
      { $match: filter },
      {
        $group: {
          _id: { $toLower: '$email' },
          leadId: { $first: '$_id' },
          email: { $first: '$email' },
          businessName: { $first: '$businessName' },
          displayName: { $first: '$displayName' },
          city: { $first: '$city' },
          category: { $first: '$category' },
        },
      },
      {
        $project: {
          _id: 0,
          leadId: 1,
          email: 1,
          businessName: 1,
          displayName: 1,
          city: 1,
          category: 1,
        },
      },
    ];

    const leads = await this.leadModel.aggregate(pipeline).exec();
    if (campaign.skipAlreadyEmailed !== true) return leads;

    // One cold email per business: skip addresses another campaign has
    // sent to, or still has waiting in its queue.
    const already: string[] = await this.recipientModel
      .distinct('email', {
        campaignId: { $ne: campaign._id },
        status: { $in: ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED'] },
      })
      .exec();
    if (!already.length) return leads;
    const skip = new Set(already.map((e) => e.toLowerCase()));
    return leads.filter((l: { email: string }) => !skip.has(l.email.toLowerCase()));
  }

  /** Who email goes out as, and how much of today's limit is used. */
  async setup() {
    const override = this.sesService.getOverrideTo();
    return {
      defaultSender: this.sesService.getDefaultSender(),
      overrideTo: override ? override.replace(/^(.{3}).*@/, '$1***@') : null,
      dailyLimit: this.queueService.dailyLimit,
      sentLast24h: await this.queueService.sentLast24h(),
      sendHours: this.queueService.sendWindow(),
    };
  }

  /** Where each recipient's follow-ups stand. */
  async followUpStats(id: string) {
    const campaign = await this.getCampaignById(id);
    const [rows, stopped, next] = await Promise.all([
      this.recipientModel
        .aggregate<{ _id: number; n: number }>([
          { $match: { campaignId: campaign._id, followUpStep: { $gt: 0 } } },
          { $group: { _id: '$followUpStep', n: { $sum: 1 } } },
        ])
        .exec(),
      this.recipientModel
        .aggregate<{ _id: string; n: number }>([
          { $match: { campaignId: campaign._id, followUpStopReason: { $exists: true } } },
          { $group: { _id: '$followUpStopReason', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ])
        .exec(),
      this.recipientModel
        .find({ campaignId: campaign._id, nextFollowUpAt: { $exists: true } })
        .sort({ nextFollowUpAt: 1 })
        .select('nextFollowUpAt')
        .limit(1)
        .exec(),
    ]);
    const steps = campaign.followUps?.length ?? 0;
    const reachedStep = (k: number) => rows.filter((r) => r._id >= k).reduce((s, r) => s + r.n, 0);
    return {
      steps,
      sent: Array.from({ length: steps }, (_, i) => reachedStep(i + 1)),
      scheduled: await this.recipientModel.countDocuments({ campaignId: campaign._id, nextFollowUpAt: { $exists: true } }),
      nextDueAt: next[0]?.nextFollowUpAt ?? null,
      stopped: stopped.map((s) => ({ reason: s._id, count: s.n })),
    };
  }

  /** No more follow-ups for anyone in this campaign. */
  async stopFollowUps(id: string) {
    const campaign = await this.getCampaignById(id);
    const res = await this.recipientModel.updateMany(
      { campaignId: campaign._id, nextFollowUpAt: { $exists: true } },
      { $unset: { nextFollowUpAt: 1, followUpLockedAt: 1 }, $set: { followUpStopReason: 'Stopped by admin' } },
    );
    return { stopped: res.modifiedCount };
  }

  /**
   * Pre-calculates the eligible recipient count for a campaign.
   */
  async calculateRecipientCount(
    id: string,
  ): Promise<{ eligibleCount: number; sampleRecipients: any[]; dailyLimit: number; sentLast24h: number }> {
    const campaign = await this.getCampaignById(id);
    const eligible = await this.getEligibleLeads(campaign);

    return {
      eligibleCount: eligible.length,
      sampleRecipients: eligible.slice(0, 5),
      dailyLimit: this.queueService.dailyLimit,
      sentLast24h: await this.queueService.sentLast24h(),
    };
  }

  /**
   * Queues and launches the campaign sending asynchronously.
   */
  async startCampaign(
    id: string,
  ): Promise<{ message: string; totalRecipients: number; status: string }> {
    const campaign = await this.getCampaignById(id);

    if (campaign.status === 'SENDING') {
      throw new BadRequestException('Campaign is already in progress.');
    }
    if (campaign.status === 'COMPLETED') {
      throw new BadRequestException('Campaign has already finished.');
    }

    // 1. Gather eligible deduplicated leads
    const eligibleLeads = await this.getEligibleLeads(campaign);
    if (eligibleLeads.length === 0) {
      throw new BadRequestException(
        'No eligible leads found matching the campaign criteria. Ensure leads have valid emails and are not unsubscribed.',
      );
    }

    // 2. Prepare recipient rows for bulk insertion
    const recipientDocs = eligibleLeads.map((item) => ({
      campaignId: campaign._id,
      leadId: item.leadId,
      email: item.email.toLowerCase().trim(),
      businessName: item.businessName,
      displayName: item.displayName,
      city: item.city,
      category: item.category,
      status: 'QUEUED',
      retryCount: 0,
      maxRetries: 3,
    }));

    // Clear any previous queued recipients from older attempts
    await this.recipientModel.deleteMany({
      campaignId: campaign._id,
      status: { $in: ['PENDING', 'QUEUED'] },
    });

    // Bulk insert with duplicate suppression (ordered: false ignores any unique constraint duplicates)
    try {
      await this.recipientModel.insertMany(recipientDocs, { ordered: false });
    } catch (err: any) {
      // Ignore duplicate key errors if partial batches already existed
      this.logger.warn(`Bulk insert info: ${err.message}`);
    }

    const totalInserted = await this.recipientModel.countDocuments({
      campaignId: campaign._id,
    });

    // 3. Mark campaign QUEUED
    campaign.status = 'QUEUED';
    campaign.totalRecipients = totalInserted;
    campaign.queuedCount = totalInserted;
    campaign.startedAt = new Date();
    await campaign.save();

    // 4. Detach worker and start asynchronous processing
    this.queueService.startProcessingCampaign(campaign._id.toString());

    this.logger.log(
      `Campaign ${campaign._id} queued with ${totalInserted} recipients. Worker started.`,
    );

    return {
      message: 'Campaign queued and background delivery started successfully',
      totalRecipients: totalInserted,
      status: 'QUEUED',
    };
  }

  /**
   * Pauses an in-progress campaign.
   */
  async pauseCampaign(id: string): Promise<EmailCampaignDocument> {
    const campaign = await this.getCampaignById(id);

    if (campaign.status !== 'SENDING' && campaign.status !== 'QUEUED') {
      throw new BadRequestException(
        `Cannot pause campaign in "${campaign.status}" state. Only active campaigns can be paused.`,
      );
    }

    campaign.status = 'PAUSED';
    campaign.pausedAt = new Date();
    campaign.statusNote = 'Paused by admin';
    await campaign.save();

    return campaign;
  }

  /**
   * Resumes a paused campaign.
   */
  async resumeCampaign(id: string): Promise<EmailCampaignDocument> {
    const campaign = await this.getCampaignById(id);

    if (campaign.status !== 'PAUSED') {
      throw new BadRequestException(
        `Cannot resume campaign in "${campaign.status}" state. Only PAUSED campaigns can be resumed.`,
      );
    }

    campaign.status = 'SENDING';
    campaign.statusNote = undefined;
    await campaign.save();

    this.queueService.startProcessingCampaign(campaign._id.toString());

    return campaign;
  }

  /**
   * Sends a test email to a specified address without altering campaign counters.
   */
  async sendTestEmail(
    id: string,
    dto: SendTestEmailDto,
  ): Promise<{ success: boolean; messageId: string }> {
    const campaign = await this.getCampaignById(id);

    let sampleLead: any = null;
    if (dto.previewLeadId && Types.ObjectId.isValid(dto.previewLeadId)) {
      sampleLead = await this.leadModel.findById(dto.previewLeadId);
    } else {
      sampleLead = await this.leadModel.findOne({
        email: { $exists: true, $ne: '' },
      });
    }

    const testUnsubscribeUrl = this.unsubscribeService.buildUnsubscribeUrl(
      dto.email,
      sampleLead?._id?.toString() || new Types.ObjectId().toString(),
      campaign._id.toString(),
    );

    const context = {
      businessName: sampleLead?.businessName || 'Test Business',
      displayName: sampleLead?.displayName || 'Business Owner',
      city: sampleLead?.city || 'Mumbai',
      category: sampleLead?.category || 'Air Conditioning',
      area: sampleLead?.area || 'Andheri',
      state: sampleLead?.state || 'Maharashtra',
      email: dto.email,
      phone: sampleLead?.phone || '+919876543210',
    };

    const renderedSubject = `[TEST] ${this.templateEngine.render(campaign.subject, context)}`;
    const compiledHtml = this.templateEngine.compileHtml(
      campaign.htmlContent,
      context,
      testUnsubscribeUrl,
    );
    const compiledText = this.templateEngine.compileText(
      campaign.emailContent,
      campaign.htmlContent,
      context,
      testUnsubscribeUrl,
    );

    const result = await this.sesService.sendEmail({
      to: dto.email,
      fromName: campaign.senderName,
      fromEmail: campaign.senderEmail,
      replyTo: campaign.replyTo,
      subject: renderedSubject,
      html: compiledHtml,
      text: compiledText,
      unsubscribeUrl: testUnsubscribeUrl,
      textOnly: campaign.plainTextOnly === true,
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  }

  /**
   * Lists individual recipients for an email campaign.
   */
  async getCampaignRecipients(
    campaignId: string,
    query: QueryCampaignRecipientsDto,
  ): Promise<{
    items: EmailCampaignRecipientDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    if (!Types.ObjectId.isValid(campaignId)) {
      throw new BadRequestException('Invalid campaign ID');
    }

    const filter: Record<string, any> = {
      campaignId: new Types.ObjectId(campaignId),
    };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const regex = new RegExp(
        query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [{ email: regex }, { businessName: regex }];
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.recipientModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.recipientModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
