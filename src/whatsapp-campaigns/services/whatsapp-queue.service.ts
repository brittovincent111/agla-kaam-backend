import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { WhatsappCampaign, WhatsappCampaignDocument } from '../schemas/whatsapp-campaign.schema';
import { WhatsappRecipient, WhatsappRecipientDocument } from '../schemas/whatsapp-recipient.schema';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import { WhatsappApiError, WhatsappCloudService } from './whatsapp-cloud.service';
import { isWaitingNote, istWhen, sendWindow } from '../../common/utils/send-window';
import { istMonthStart, whatsappBudget } from '../../common/utils/outreach-budget';

// Meta error codes that decide what happens to a recipient.
const ERR_USER_STOPPED_MARKETING = 131050; // they turned off this business's marketing
const ERR_MARKETING_LIMITED = 131049; // Meta held it back (per-person marketing limit)
const ERR_UNDELIVERABLE = 131026; // not on WhatsApp / can't receive
const ERR_RATE = [130429, 131048, 131056, 80007]; // throughput / spam rate / pair rate
const ERR_AUTH = [190, 0]; // token expired or invalid — nothing will send

/**
 * Sends WhatsApp campaigns in the background, a recipient at a time.
 *
 * Two limits keep the number safe:
 *  - pace: WHATSAPP_RATE_PER_SECOND (default 5; the API allows far more, a
 *    new number's quality rating does not);
 *  - daily cap: WHATSAPP_DAILY_LIMIT different people in any 24 hours across
 *    all campaigns (default 250 — the messaging limit of a new number). At
 *    the cap the worker stops and the minute job resumes it as the window
 *    frees up.
 */
@Injectable()
export class WhatsappQueueService {
  private readonly logger = new Logger(WhatsappQueueService.name);
  private readonly active = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @InjectModel(WhatsappCampaign.name) private readonly campaignModel: Model<WhatsappCampaignDocument>,
    @InjectModel(WhatsappRecipient.name) private readonly recipientModel: Model<WhatsappRecipientDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly cloud: WhatsappCloudService,
  ) {}

  get ratePerSecond(): number {
    return Math.max(1, Math.min(20, parseInt(this.config.get<string>('WHATSAPP_RATE_PER_SECOND') || '5', 10) || 5));
  }

  get dailyLimit(): number {
    return Math.max(1, parseInt(this.config.get<string>('WHATSAPP_DAILY_LIMIT') || '250', 10) || 250);
  }

  sendWindow() {
    return sendWindow((k) => this.config.get<string>(k));
  }

  /** The monthly money limit as messages (OUTREACH_MONTHLY_BUDGET_INR). */
  budget() {
    return whatsappBudget((k) => this.config.get<string>(k));
  }

  /** Marketing messages sent this India month, all campaigns (what Meta bills). */
  sentThisMonth(): Promise<number> {
    return this.recipientModel.countDocuments({ sentAt: { $gte: istMonthStart() } });
  }

  /** Different numbers messaged by campaigns in the last 24 hours. */
  async sentLast24h(): Promise<number> {
    const since = new Date(Date.now() - 24 * 3600_000);
    const phones = await this.recipientModel.distinct('phone', { sentAt: { $gte: since } }).exec();
    return phones.length;
  }

  start(campaignId: string): void {
    if (this.active.has(campaignId)) return;
    this.active.add(campaignId);
    setImmediate(() => {
      this.loop(campaignId)
        .catch((err) => this.logger.error(`WhatsApp campaign ${campaignId} worker crashed: ${err.message}`, err.stack))
        .finally(() => this.active.delete(campaignId));
    });
  }

  stop(campaignId: string): void {
    this.active.delete(campaignId);
  }

  private async loop(campaignId: string): Promise<void> {
    const id = new Types.ObjectId(campaignId);
    const gapMs = Math.ceil(1000 / this.ratePerSecond);

    while (this.active.has(campaignId)) {
      const campaign = await this.campaignModel.findById(id).exec();
      if (!campaign || campaign.status === 'PAUSED' || campaign.status === 'CANCELLED') return;
      if (campaign.status === 'QUEUED') {
        campaign.status = 'SENDING';
        campaign.startedAt = campaign.startedAt ?? new Date();
        campaign.statusNote = undefined;
        await campaign.save();
      }

      const room = this.dailyLimit - (await this.sentLast24h());
      const waiting = await this.recipientModel.countDocuments({ campaignId: id, status: 'QUEUED' });
      const win = this.sendWindow();
      // Only wait if something is still waiting to go; the minute job restarts it.
      if (waiting > 0 && !win.open) {
        await this.campaignModel.updateOne(
          { _id: id },
          { $set: { statusNote: `Outside sending hours (${win.label}) — continues ${istWhen(win.nextOpenAt)}.` } },
        );
        await this.syncCounters(id);
        return;
      }
      const budget = this.budget();
      const monthLeft = budget.monthlyCap === null ? Infinity : budget.monthlyCap - (await this.sentThisMonth());
      if (monthLeft <= 0 && waiting > 0) {
        await this.campaignModel.updateOne(
          { _id: id },
          { $set: { statusNote: `Monthly budget reached (${budget.monthlyCap} messages ≈ ₹${budget.usableInr}) — continues on the 1st.` } },
        );
        await this.syncCounters(id);
        return;
      }
      if (room <= 0 && waiting > 0) {
        await this.campaignModel.updateOne(
          { _id: id },
          { $set: { statusNote: `Daily limit of ${this.dailyLimit} reached — continues automatically as the 24-hour window frees up.` } },
        );
        await this.syncCounters(id);
        return;
      }
      if (isWaitingNote(campaign.statusNote)) {
        await this.campaignModel.updateOne({ _id: id }, { $unset: { statusNote: 1 } });
      }

      const batch = await this.lease(id, Math.max(1, Math.min(room, monthLeft, 20)));
      if (!batch.length) {
        const left = await this.recipientModel.countDocuments({ campaignId: id, status: { $in: ['QUEUED', 'SENDING'] } });
        if (!left) {
          await this.campaignModel.updateOne(
            { _id: id },
            { $set: { status: 'COMPLETED', completedAt: new Date(), statusNote: undefined } },
          );
          await this.syncCounters(id);
          this.logger.log(`WhatsApp campaign ${campaignId} completed.`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      for (const recipient of batch) {
        if (!this.active.has(campaignId)) return;
        const started = Date.now();
        const halt = await this.sendOne(campaign, recipient);
        if (halt) {
          await this.campaignModel.updateOne({ _id: id }, { $set: { status: 'PAUSED', statusNote: halt } });
          await this.recipientModel.updateMany(
            { campaignId: id, status: 'SENDING' },
            { $set: { status: 'QUEUED' }, $unset: { lockedAt: 1 } },
          );
          await this.syncCounters(id);
          return;
        }
        const wait = gapMs - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      await this.syncCounters(id);
    }
  }

  private async lease(campaignId: Types.ObjectId, size: number): Promise<WhatsappRecipientDocument[]> {
    const candidates = await this.recipientModel
      .find({ campaignId, status: 'QUEUED' })
      .sort({ _id: 1 })
      .limit(size)
      .select('_id')
      .exec();
    if (!candidates.length) return [];
    const now = new Date();
    const ids = candidates.map((c) => c._id);
    await this.recipientModel.updateMany({ _id: { $in: ids }, status: 'QUEUED' }, { $set: { status: 'SENDING', lockedAt: now } });
    return this.recipientModel.find({ _id: { $in: ids }, status: 'SENDING', lockedAt: now }).exec();
  }

  /** Sends one message. Returns a reason when the whole campaign must stop. */
  private async sendOne(campaign: WhatsappCampaignDocument, recipient: WhatsappRecipientDocument): Promise<string | null> {
    const lead = await this.leadModel.findById(recipient.leadId).exec();
    if (lead && (lead.isWhatsappOptedOut || lead.status === 'DO_NOT_CONTACT')) {
      recipient.status = 'OPTED_OUT';
      recipient.failureReason = 'Opted out before this send';
      await recipient.save();
      return null;
    }
    if (lead?.status === 'INSTALLED') {
      recipient.status = 'SKIPPED';
      recipient.failureReason = 'Already uses Agla Kaam';
      await recipient.save();
      return null;
    }
    try {
      const wamid = await this.cloud.sendTemplate({
        to: recipient.phone,
        templateName: campaign.templateName,
        languageCode: campaign.languageCode,
        bodyParams: recipient.params,
        headerImageUrl: campaign.headerImageUrl,
      });
      recipient.status = 'SENT';
      recipient.waMessageId = wamid;
      recipient.sentAt = new Date();
      recipient.failureReason = undefined;
      recipient.errorCode = undefined;
      await recipient.save();
      if (lead) {
        lead.lastWhatsappAt = new Date();
        lead.lastContactedAt = new Date();
        if (lead.status === 'NEW' || lead.status === 'REVIEWED') lead.status = 'CONTACTED';
        await lead.save();
      }
      return null;
    } catch (err) {
      const e = err as WhatsappApiError;
      const code = e.code;
      recipient.errorCode = code;
      recipient.failureReason = e.message;

      if (e.status === 401 || (code !== undefined && ERR_AUTH.includes(code) && code !== 0)) {
        recipient.status = 'QUEUED';
        recipient.lockedAt = undefined;
        await recipient.save();
        return 'WhatsApp token expired or invalid. Update WHATSAPP_ACCESS_TOKEN, then resume.';
      }
      if (code !== undefined && ERR_RATE.includes(code) && recipient.retryCount < 3) {
        recipient.retryCount += 1;
        recipient.status = 'QUEUED';
        recipient.lockedAt = undefined;
        await recipient.save();
        await new Promise((r) => setTimeout(r, 5000 * recipient.retryCount));
        return null;
      }
      if (code === ERR_USER_STOPPED_MARKETING) {
        recipient.status = 'OPTED_OUT';
        await recipient.save();
        if (lead) {
          lead.isWhatsappOptedOut = true;
          lead.whatsappOptedOutAt = new Date();
          await lead.save();
        }
        return null;
      }
      recipient.status = 'FAILED';
      recipient.failedAt = new Date();
      if (code === ERR_MARKETING_LIMITED) recipient.failureReason = 'Meta held it back: this person gets few marketing messages.';
      if (code === ERR_UNDELIVERABLE) recipient.failureReason = 'Not deliverable: the number may not be on WhatsApp.';
      await recipient.save();
      this.logger.warn(`WhatsApp send to ${recipient.phone.slice(0, 4)}… failed (${code}): ${e.message}`);
      return null;
    }
  }

  async syncCounters(campaignId: Types.ObjectId): Promise<void> {
    const counts = await this.recipientModel
      .aggregate<{ _id: string; n: number }>([{ $match: { campaignId } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
      .exec();
    const by = Object.fromEntries(counts.map((c) => [c._id, c.n])) as Record<string, number>;
    // Reached counts come from the timestamps, so someone who got the message
    // and then opted out (or whose delivery later failed) still counts as sent.
    const [reached] = await this.recipientModel
      .aggregate<{ sent: number; delivered: number; read: number; replied: number }>([
        { $match: { campaignId } },
        {
          $group: {
            _id: null,
            sent: { $sum: { $cond: [{ $ifNull: ['$sentAt', false] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $ifNull: ['$deliveredAt', false] }, 1, 0] } },
            read: { $sum: { $cond: [{ $ifNull: ['$readAt', false] }, 1, 0] } },
            replied: { $sum: { $cond: [{ $ifNull: ['$repliedAt', false] }, 1, 0] } },
          },
        },
      ])
      .exec();
    await this.campaignModel.updateOne(
      { _id: campaignId },
      {
        $set: {
          queuedCount: (by.QUEUED ?? 0) + (by.SENDING ?? 0),
          sentCount: reached?.sent ?? 0,
          deliveredCount: reached?.delivered ?? 0,
          readCount: reached?.read ?? 0,
          failedCount: by.FAILED ?? 0,
          skippedCount: by.SKIPPED ?? 0,
          optedOutCount: by.OPTED_OUT ?? 0,
          repliedCount: reached?.replied ?? 0,
        },
      },
    );
  }

  /** Crash recovery, and restarting campaigns held back by the daily cap. */
  @Cron(CronExpression.EVERY_MINUTE)
  async recover(): Promise<void> {
    const stale = new Date(Date.now() - 5 * 60_000);
    await this.recipientModel.updateMany(
      { status: 'SENDING', lockedAt: { $lt: stale } },
      { $set: { status: 'QUEUED' }, $unset: { lockedAt: 1 } },
    );
    if (!this.cloud.isConfigured()) return;
    const sending = await this.campaignModel.find({ status: { $in: ['QUEUED', 'SENDING'] } }).select('_id').exec();
    for (const c of sending) {
      const id = c._id.toString();
      if (!this.active.has(id)) this.start(id);
    }
  }
}
