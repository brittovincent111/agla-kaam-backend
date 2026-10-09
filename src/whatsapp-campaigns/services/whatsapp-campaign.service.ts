import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WHATSAPP_PARAM_FIELDS,
  WhatsappCampaign,
  WhatsappCampaignDocument,
  WhatsappParamField,
} from '../schemas/whatsapp-campaign.schema';
import { WhatsappRecipient, WhatsappRecipientDocument } from '../schemas/whatsapp-recipient.schema';
import { WhatsappMessage, WhatsappMessageDocument } from '../schemas/whatsapp-message.schema';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappQueueService } from './whatsapp-queue.service';
import { CreateWhatsappCampaignDto, UpdateWhatsappCampaignDto } from '../dto/whatsapp-campaign.dto';

interface EligibleLead {
  leadId: Types.ObjectId;
  phone: string;
  businessName?: string;
  displayName?: string;
  city?: string;
  category?: string;
}

@Injectable()
export class WhatsappCampaignService {
  private readonly logger = new Logger(WhatsappCampaignService.name);

  constructor(
    @InjectModel(WhatsappCampaign.name) private readonly campaignModel: Model<WhatsappCampaignDocument>,
    @InjectModel(WhatsappRecipient.name) private readonly recipientModel: Model<WhatsappRecipientDocument>,
    @InjectModel(WhatsappMessage.name) private readonly messageModel: Model<WhatsappMessageDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly cloud: WhatsappCloudService,
    private readonly queue: WhatsappQueueService,
  ) {}

  // ---- Setup ------------------------------------------------------------

  async status() {
    return {
      configured: this.cloud.isConfigured(),
      phoneNumberId: this.cloud.phoneNumberId ?? null,
      overrideTo: this.cloud.overrideTo ? `${this.cloud.overrideTo.slice(0, 4)}••••${this.cloud.overrideTo.slice(-2)}` : null,
      dailyLimit: this.queue.dailyLimit,
      sentLast24h: await this.queue.sentLast24h(),
      ratePerSecond: this.queue.ratePerSecond,
      sendHours: this.queue.sendWindow(),
      month: { ...this.queue.budget(), sent: await this.queue.sentThisMonth() },
    };
  }

  templates() {
    return this.cloud.listTemplates();
  }

  // ---- Campaigns --------------------------------------------------------

  private cleanParams(params?: string[]): WhatsappParamField[] {
    const list = (params ?? ['businessName']).filter((p): p is WhatsappParamField =>
      (WHATSAPP_PARAM_FIELDS as readonly string[]).includes(p),
    );
    return list;
  }

  async create(dto: CreateWhatsappCampaignDto, createdBy?: string) {
    return this.campaignModel.create({
      name: dto.name.trim(),
      templateName: dto.templateName.trim(),
      languageCode: (dto.languageCode || 'en').trim(),
      headerImageUrl: dto.headerImageUrl?.trim() || undefined,
      bodyParams: this.cleanParams(dto.bodyParams),
      leadFilters: dto.leadFilters ?? {},
      selectedLeads: (dto.selectedLeadIds ?? []).filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)),
      skipAlreadyMessaged: dto.skipAlreadyMessaged !== false,
      status: 'DRAFT',
      createdBy,
    });
  }

  async get(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Campaign not found');
    const c = await this.campaignModel.findById(id).exec();
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  async update(id: string, dto: UpdateWhatsappCampaignDto) {
    const c = await this.get(id);
    if (c.status !== 'DRAFT' && c.status !== 'PAUSED') {
      throw new BadRequestException('Only a draft or paused campaign can be edited.');
    }
    if (dto.name !== undefined) c.name = dto.name.trim();
    if (dto.templateName !== undefined) c.templateName = dto.templateName.trim();
    if (dto.languageCode !== undefined) c.languageCode = dto.languageCode.trim();
    if (dto.headerImageUrl !== undefined) c.headerImageUrl = dto.headerImageUrl.trim() || undefined;
    if (dto.bodyParams !== undefined) c.bodyParams = this.cleanParams(dto.bodyParams);
    if (dto.leadFilters !== undefined) c.leadFilters = dto.leadFilters;
    if (dto.skipAlreadyMessaged !== undefined) c.skipAlreadyMessaged = dto.skipAlreadyMessaged;
    if (dto.selectedLeadIds !== undefined) {
      c.selectedLeads = dto.selectedLeadIds.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    }
    return c.save();
  }

  async remove(id: string) {
    const c = await this.get(id);
    if (c.status === 'SENDING' || c.status === 'QUEUED') {
      throw new BadRequestException('Pause the campaign before deleting it.');
    }
    if (c.sentCount > 0) {
      throw new BadRequestException('This campaign has sent messages — keep it for its history.');
    }
    await this.recipientModel.deleteMany({ campaignId: c._id });
    await c.deleteOne();
    return { deleted: true };
  }

  list() {
    return this.campaignModel.find().sort({ createdAt: -1 }).limit(200).exec();
  }

  /**
   * Leads this campaign may message: a mobile number (landlines cannot get
   * WhatsApp), not opted out, not marked do-not-contact / invalid / not
   * interested, one per number, and — unless switched off — not already sent
   * this template by an earlier campaign.
   */
  async eligibleLeads(c: WhatsappCampaignDocument): Promise<EligibleLead[]> {
    const match: Record<string, unknown> = {
      phoneNormalized: { $exists: true, $ne: '' },
      phoneType: { $ne: 'landline' },
      isWhatsappOptedOut: { $ne: true },
      // Installed: already an Agla Kaam user, nothing to sell them.
      status: { $nin: ['DO_NOT_CONTACT', 'INVALID', 'NOT_INTERESTED', 'INSTALLED'] },
    };
    if (c.selectedLeads?.length) match._id = { $in: c.selectedLeads };
    const f = c.leadFilters ?? {};
    if (f.status && !['DO_NOT_CONTACT', 'INVALID', 'NOT_INTERESTED', 'INSTALLED'].includes(f.status)) match.status = f.status;
    if (f.category) match.category = f.category;
    if (f.city) match.city = new RegExp(`^${escapeRegex(f.city.trim())}$`, 'i');
    if (f.state) match.state = new RegExp(`^${escapeRegex(f.state.trim())}$`, 'i');
    if (f.source) match.source = f.source;
    if (f.tags?.length) match.tags = { $in: f.tags };

    if (c.skipAlreadyMessaged) {
      const sameTemplate = await this.campaignModel
        .find({ templateName: c.templateName, _id: { $ne: c._id } })
        .select('_id')
        .exec();
      if (sameTemplate.length) {
        const reached = await this.recipientModel
          .distinct('phone', {
            campaignId: { $in: sameTemplate.map((x) => x._id) },
            $or: [
              // Waiting in another campaign's queue counts too, or they'd get it twice.
              { status: { $in: ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'OPTED_OUT'] } },
              // Not on WhatsApp: no point trying again. Other failures may retry.
              { status: 'FAILED', errorCode: 131026 },
            ],
          })
          .exec();
        if (reached.length) match.phoneNormalized = { $exists: true, $ne: '', $nin: reached.map((p) => `+${p}`) };
      }
    }

    const rows = await this.leadModel
      .aggregate<EligibleLead & { _id: string }>([
        { $match: match },
        {
          $group: {
            _id: '$phoneNormalized',
            leadId: { $first: '$_id' },
            businessName: { $first: '$businessName' },
            displayName: { $first: '$displayName' },
            city: { $first: '$city' },
            category: { $first: '$category' },
          },
        },
      ])
      .exec();
    return rows
      .map((r) => ({ ...r, phone: String(r._id).replace(/\D/g, '') }))
      .filter((r) => r.phone.length >= 10 && r.phone.length <= 15);
  }

  private paramsFor(c: WhatsappCampaignDocument, lead: Partial<EligibleLead>): string[] | null {
    const values = c.bodyParams.map((field) => (lead[field] ?? '').toString().trim());
    // WhatsApp refuses an empty variable, and "Hi ," reads badly anyway.
    return values.some((v) => !v) ? null : values.map((v) => v.slice(0, 60));
  }

  async preview(id: string) {
    const c = await this.get(id);
    const leads = await this.eligibleLeads(c);
    const usable = leads.filter((l) => this.paramsFor(c, l));
    return {
      eligible: usable.length,
      missingVariables: leads.length - usable.length,
      sample: usable.slice(0, 5).map((l) => ({
        businessName: l.businessName,
        city: l.city,
        phone: `+${l.phone.slice(0, 4)}••••${l.phone.slice(-2)}`,
        params: this.paramsFor(c, l),
      })),
      dailyLimit: this.queue.dailyLimit,
      sentLast24h: await this.queue.sentLast24h(),
    };
  }

  async start(id: string) {
    if (!this.cloud.isConfigured()) {
      throw new BadRequestException('WhatsApp is not set up: add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
    }
    const c = await this.get(id);
    if (c.status !== 'DRAFT') throw new BadRequestException(`This campaign is ${c.status.toLowerCase()}.`);
    const leads = await this.eligibleLeads(c);
    const docs = leads
      .map((l) => ({ l, params: this.paramsFor(c, l) }))
      .filter((x) => x.params)
      .map(({ l, params }) => ({
        campaignId: c._id,
        leadId: l.leadId,
        phone: l.phone,
        businessName: l.businessName,
        params: params!,
        status: 'QUEUED' as const,
      }));
    if (!docs.length) throw new BadRequestException('No leads to send to with these filters.');
    try {
      await this.recipientModel.insertMany(docs, { ordered: false });
    } catch (err) {
      this.logger.warn(`Some recipients already existed: ${(err as Error).message.slice(0, 120)}`);
    }
    const total = await this.recipientModel.countDocuments({ campaignId: c._id });
    c.status = 'QUEUED';
    c.totalRecipients = total;
    c.queuedCount = total;
    c.statusNote = undefined;
    await c.save();
    this.queue.start(c._id.toString());
    return { status: 'QUEUED', totalRecipients: total };
  }

  async pause(id: string) {
    const c = await this.get(id);
    if (c.status !== 'SENDING' && c.status !== 'QUEUED') throw new BadRequestException('Campaign is not sending.');
    c.status = 'PAUSED';
    c.statusNote = 'Paused by admin';
    await c.save();
    this.queue.stop(c._id.toString());
    await this.recipientModel.updateMany(
      { campaignId: c._id, status: 'SENDING' },
      { $set: { status: 'QUEUED' }, $unset: { lockedAt: 1 } },
    );
    await this.queue.syncCounters(c._id);
    return c;
  }

  async resume(id: string) {
    if (!this.cloud.isConfigured()) throw new BadRequestException('WhatsApp is not set up.');
    const c = await this.get(id);
    if (c.status !== 'PAUSED') throw new BadRequestException('Campaign is not paused.');
    c.status = 'SENDING';
    c.statusNote = undefined;
    await c.save();
    this.queue.start(c._id.toString());
    return c;
  }

  /** One message to any number, with a sample lead's values. */
  async testSend(id: string, phone: string) {
    const c = await this.get(id);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) throw new BadRequestException('Enter the number with country code, e.g. 919876543210.');
    const sample = { businessName: 'Sharma AC Services', displayName: 'Sharma AC Services', city: 'Kochi', category: 'AC repair' };
    const params = this.paramsFor(c, sample) ?? [];
    const wamid = await this.cloud.sendTemplate({
      to: digits,
      templateName: c.templateName,
      languageCode: c.languageCode,
      bodyParams: params,
      headerImageUrl: c.headerImageUrl,
    });
    this.logger.log(
      `[WA out] test template=${c.templateName}/${c.languageCode} to=${this.cloud.overrideTo ? 'override' : digits} id=${wamid}`,
    );
    return { sent: true, waMessageId: wamid, to: this.cloud.overrideTo ? 'override number' : digits };
  }

  async recipients(id: string, status?: string, page = 1) {
    const c = await this.get(id);
    const filter: Record<string, unknown> = { campaignId: c._id };
    if (status === 'REPLIED') filter.repliedAt = { $exists: true };
    else if (status) filter.status = status;
    const limit = 50;
    const [items, total] = await Promise.all([
      this.recipientModel
        .find(filter)
        .sort({ repliedAt: -1, sentAt: -1, _id: 1 })
        .skip((Math.max(1, page) - 1) * limit)
        .limit(limit)
        .exec(),
      this.recipientModel.countDocuments(filter),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  // ---- Inbox ------------------------------------------------------------

  /** Latest conversation per number, newest first. */
  async inbox(limit = 100) {
    const rows = await this.messageModel
      .aggregate([
        { $sort: { at: -1 } },
        {
          $group: {
            _id: '$phone',
            last: { $first: '$$ROOT' },
            unread: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'in'] }, { $eq: ['$handled', false] }] }, 1, 0] } },
            lastInAt: { $max: { $cond: [{ $eq: ['$direction', 'in'] }, '$at', null] } },
          },
        },
        { $sort: { 'last.at': -1 } },
        { $limit: limit },
      ])
      .exec();
    const leadIds = rows.map((r) => r.last.leadId).filter(Boolean);
    const phonesWithoutLead = rows
      .filter((r) => !r.last.leadId)
      .map((r) => `+${r._id}`);

    const leads = await this.leadModel
      .find({
        $or: [
          ...(leadIds.length ? [{ _id: { $in: leadIds } }] : []),
          ...(phonesWithoutLead.length ? [{ phoneNormalized: { $in: phonesWithoutLead } }] : []),
        ],
      })
      .select('businessName city category phone notes rating reviewCount installedAt installedBusinessId phoneNormalized status isWhatsappOptedOut')
      .exec();
    const byId = new Map(leads.map((l) => [l._id.toString(), l]));
    const byPhone = new Map(
      leads.filter((l) => l.phoneNormalized).map((l) => [l.phoneNormalized!.replace(/\D/g, ''), l]),
    );

    return rows.map((r) => {
      const lead = (r.last.leadId ? byId.get(r.last.leadId.toString()) : undefined) ?? byPhone.get(r._id);
      const windowOpen = !!r.lastInAt && Date.now() - new Date(r.lastInAt).getTime() < 24 * 3600_000;
      return {
        phone: r._id,
        contactName: r.last.contactName,
        lastText: r.last.text,
        lastDirection: r.last.direction,
        lastAt: r.last.at,
        unread: r.unread,
        // Free replies are only allowed within 24 hours of their last message.
        canReply: windowOpen,
        lead: lead
          ? {
              _id: lead._id,
              businessName: lead.businessName,
              category: lead.category,
              city: lead.city,
              phone: lead.phone,
              notes: lead.notes,
              rating: lead.rating,
              reviewCount: lead.reviewCount,
              installedAt: lead.installedAt,
              installedBusinessId: lead.installedBusinessId,
              status: lead.status,
              optedOut: lead.isWhatsappOptedOut,
            }
          : null,
      };
    });
  }

  async thread(phone: string) {
    const digits = phone.replace(/\D/g, '');
    const messages = await this.messageModel.find({ phone: digits }).sort({ at: 1 }).limit(200).exec();
    await this.messageModel.updateMany({ phone: digits, direction: 'in', handled: false }, { $set: { handled: true } });
    return messages;
  }

  async reply(phone: string, text: string, sentBy?: string) {
    const digits = phone.replace(/\D/g, '');
    const lastIn = await this.messageModel.findOne({ phone: digits, direction: 'in' }).sort({ at: -1 }).exec();
    if (!lastIn || Date.now() - lastIn.at.getTime() > 24 * 3600_000) {
      throw new BadRequestException(
        'They have not messaged in the last 24 hours, so WhatsApp only allows an approved template now.',
      );
    }
    const wamid = await this.cloud.sendText(digits, text);
    // A person is answering now: the assistant stays out of this chat.
    if (lastIn.leadId) {
      await this.leadModel
        .updateOne({ _id: lastIn.leadId, whatsappBotPausedAt: { $exists: false } }, { $set: { whatsappBotPausedAt: new Date() } })
        .exec();
    }
    return this.messageModel.create({
      direction: 'out',
      phone: digits,
      leadId: lastIn.leadId,
      campaignId: lastIn.campaignId,
      type: 'text',
      text,
      waMessageId: wamid,
      at: new Date(),
      handled: true,
      sentBy,
    });
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
