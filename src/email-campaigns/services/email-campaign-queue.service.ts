import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EmailCampaign,
  EmailCampaignDocument,
} from '../schemas/email-campaign.schema';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientDocument,
} from '../schemas/email-campaign-recipient.schema';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import { SesService } from './ses.service';
import { TemplateEngineService } from './template-engine.service';
import { UnsubscribeService } from './unsubscribe.service';
import { isWaitingNote, istWhen, sendWindow } from '../../common/utils/send-window';

// A lead in any of these has answered or is done; follow-ups stop.
const FOLLOW_UP_STOP_STATUSES = ['REPLIED', 'INTERESTED', 'INSTALLED', 'NOT_INTERESTED', 'DO_NOT_CONTACT', 'INVALID'];

@Injectable()
export class EmailCampaignQueueService {
  private readonly logger = new Logger(EmailCampaignQueueService.name);
  private readonly activeCampaignWorkers = new Set<string>();

  private readonly rateLimitPerSec: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(EmailCampaign.name)
    private readonly campaignModel: Model<EmailCampaignDocument>,
    @InjectModel(EmailCampaignRecipient.name)
    private readonly recipientModel: Model<EmailCampaignRecipientDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    private readonly sesService: SesService,
    private readonly templateEngine: TemplateEngineService,
    private readonly unsubscribeService: UnsubscribeService,
  ) {
    this.rateLimitPerSec = Math.max(
      1,
      parseInt(
        this.configService.get<string>('SES_RATE_LIMIT_PER_SECOND') || '10',
        10,
      ),
    );

    this.batchSize = Math.max(
      5,
      parseInt(this.configService.get<string>('SES_BATCH_SIZE') || '25', 10),
    );

    this.maxRetries = parseInt(
      this.configService.get<string>('SES_MAX_RETRIES') || '3',
      10,
    );

    this.retryDelayMs = parseInt(
      this.configService.get<string>('SES_RETRY_DELAY_MS') || '2000',
      10,
    );

    this.logger.log(
      `Email campaign queue initialized: Rate=${this.rateLimitPerSec}/sec, Batch=${this.batchSize}, Retries=${this.maxRetries}`,
    );
  }

  /**
   * Different addresses emailed in any 24 hours, across all campaigns
   * (EMAIL_DAILY_LIMIT, default 200). A new sending domain that jumps to
   * thousands a day lands in spam; this keeps the ramp gentle.
   */
  get dailyLimit(): number {
    return Math.max(1, parseInt(this.configService.get<string>('EMAIL_DAILY_LIMIT') || '200', 10) || 200);
  }

  // Follow-ups count towards it too (lastSentAt moves with each one).
  async sentLast24h(): Promise<number> {
    const since = new Date(Date.now() - 24 * 3600_000);
    return this.recipientModel.countDocuments({
      $or: [{ sentAt: { $gte: since } }, { lastSentAt: { $gte: since } }],
    });
  }

  sendWindow() {
    return sendWindow((k) => this.configService.get<string>(k));
  }

  /**
   * Starts processing a campaign in the background. Detached from HTTP request.
   */
  startProcessingCampaign(campaignId: string): void {
    if (this.activeCampaignWorkers.has(campaignId)) {
      this.logger.warn(`Campaign worker ${campaignId} is already running.`);
      return;
    }

    this.activeCampaignWorkers.add(campaignId);
    setImmediate(() => {
      this.processCampaignLoop(campaignId)
        .catch((err) => {
          this.logger.error(
            `Unhandled error in worker for campaign ${campaignId}: ${err.message}`,
            err.stack,
          );
        })
        .finally(() => {
          this.activeCampaignWorkers.delete(campaignId);
        });
    });
  }

  /**
   * Main campaign execution loop.
   */
  private async processCampaignLoop(campaignId: string): Promise<void> {
    this.logger.log(`Worker started for campaign: ${campaignId}`);

    const campaignObjectId = new Types.ObjectId(campaignId);

    // Calculate minimum sleep between emails to conform to rate limit
    const minDelayBetweenSendsMs = Math.ceil(1000 / this.rateLimitPerSec);

    while (true) {
      // 1. Fetch current campaign status
      const campaign = await this.campaignModel.findById(campaignObjectId);
      if (!campaign) {
        this.logger.warn(
          `Campaign ${campaignId} not found, terminating worker.`,
        );
        return;
      }

      // Check if paused or cancelled
      if (campaign.status === 'PAUSED' || campaign.status === 'CANCELLED') {
        this.logger.log(
          `Campaign ${campaignId} is ${campaign.status}, pausing worker execution.`,
        );
        return;
      }

      // Ensure campaign is marked SENDING
      if (campaign.status === 'QUEUED') {
        campaign.status = 'SENDING';
        if (!campaign.startedAt) campaign.startedAt = new Date();
        await campaign.save();
      }

      // 2. Stop at the daily limit; the minute job picks it up again.
      const room = this.dailyLimit - (await this.sentLast24h());
      const waiting = await this.recipientModel.countDocuments({
        campaignId: campaignObjectId,
        status: 'QUEUED',
      });
      const win = this.sendWindow();
      // Only wait if something is still waiting to go; the minute job restarts it.
      if (waiting > 0 && !win.open) {
        await this.campaignModel.updateOne(
          { _id: campaignObjectId },
          { $set: { statusNote: `Outside sending hours (${win.label}) — continues ${istWhen(win.nextOpenAt)}.` } },
        );
        await this.syncCampaignCounters(campaignObjectId);
        return;
      }
      if (room <= 0 && waiting > 0) {
        await this.campaignModel.updateOne(
          { _id: campaignObjectId },
          { $set: { statusNote: `Daily limit of ${this.dailyLimit} emails reached — continues automatically as the 24-hour window frees up.` } },
        );
        await this.syncCampaignCounters(campaignObjectId);
        return;
      }
      if (isWaitingNote(campaign.statusNote)) {
        await this.campaignModel.updateOne({ _id: campaignObjectId }, { $unset: { statusNote: 1 } });
      }

      // 3. Atomically lease next batch of recipients
      const recipients = await this.leaseBatch(campaignObjectId, Math.max(1, room));

      if (recipients.length === 0) {
        // Check if there are any remaining queued or sending recipients
        const remainingQueued = await this.recipientModel.countDocuments({
          campaignId: campaignObjectId,
          status: { $in: ['QUEUED', 'SENDING'] },
        });

        if (remainingQueued === 0) {
          // Campaign completed!
          campaign.status = 'COMPLETED';
          campaign.completedAt = new Date();
          campaign.statusNote = undefined;
          await campaign.save();

          await this.syncCampaignCounters(campaignObjectId);
          this.logger.log(
            `Campaign ${campaignId} completed successfully! Sent=${campaign.sentCount}, Failed=${campaign.failedCount}`,
          );
          return;
        }

        // Otherwise, workers might be clearing retries or other batches; wait briefly
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // 3. Process each leased recipient in sequence respecting SES rate limits
      for (const recipient of recipients) {
        // Pre-check for campaign cancellation mid-batch
        if (!this.activeCampaignWorkers.has(campaignId)) {
          return;
        }

        const startTimestamp = Date.now();
        await this.sendToRecipient(campaign, recipient);

        // Rate-pacing delay
        const elapsed = Date.now() - startTimestamp;
        const sleepNeeded = Math.max(0, minDelayBetweenSendsMs - elapsed);
        if (sleepNeeded > 0) {
          await new Promise((r) => setTimeout(r, sleepNeeded));
        }
      }

      // 4. Update aggregate statistics for campaign
      await this.syncCampaignCounters(campaignObjectId);
    }
  }

  /**
   * Atomically leases a batch of queued recipients to avoid race conditions.
   */
  private async leaseBatch(
    campaignId: Types.ObjectId,
    max = this.batchSize,
  ): Promise<EmailCampaignRecipientDocument[]> {
    const candidates = await this.recipientModel
      .find({
        campaignId,
        status: 'QUEUED',
      })
      .limit(Math.min(this.batchSize, max))
      .exec();

    if (candidates.length === 0) return [];

    const candidateIds = candidates.map((c) => c._id);
    const now = new Date();

    // Atomic lease update
    await this.recipientModel.updateMany(
      {
        _id: { $in: candidateIds },
        status: 'QUEUED',
      },
      {
        $set: {
          status: 'SENDING',
          lockedAt: now,
        },
      },
    );

    // Return the updated documents
    return this.recipientModel.find({
      _id: { $in: candidateIds },
      status: 'SENDING',
      lockedAt: now,
    });
  }

  /**
   * Sends an email to a single recipient with error handling and retry logic.
   */
  private async sendToRecipient(
    campaign: EmailCampaignDocument,
    recipient: EmailCampaignRecipientDocument,
  ): Promise<void> {
    try {
      // 1. Verify lead is not suppressed or unsubscribed
      const lead = await this.leadModel.findById(recipient.leadId);
      if (
        lead &&
        (lead.isEmailUnsubscribed ||
          lead.emailBounceStatus === 'HARD_BOUNCE' ||
          lead.emailBounceStatus === 'COMPLAINT' ||
          lead.status === 'DO_NOT_CONTACT')
      ) {
        recipient.status = 'UNSUBSCRIBED';
        recipient.unsubscribedAt = new Date();
        recipient.failureReason = 'Lead has unsubscribed or is suppressed';
        await recipient.save();
        return;
      }
      if (lead?.status === 'INSTALLED') {
        recipient.status = 'SKIPPED';
        recipient.failureReason = 'Already uses Agla Kaam';
        await recipient.save();
        return;
      }

      // 2. Build personalized templates & unsubscribe links
      const unsubscribeUrl = this.unsubscribeService.buildUnsubscribeUrl(
        recipient.email,
        recipient.leadId.toString(),
        campaign._id.toString(),
      );

      const context = {
        businessName: recipient.businessName || lead?.businessName,
        displayName: recipient.displayName || lead?.displayName,
        city: recipient.city || lead?.city,
        category: recipient.category || lead?.category,
        area: lead?.area,
        state: lead?.state,
        email: recipient.email,
        phone: lead?.phone,
      };

      const renderedSubject = this.templateEngine.render(
        campaign.subject,
        context,
      );

      const compiledHtml = this.templateEngine.compileHtml(
        campaign.htmlContent,
        context,
        unsubscribeUrl,
      );

      const compiledText = this.templateEngine.compileText(
        campaign.emailContent,
        campaign.htmlContent,
        context,
        unsubscribeUrl,
      );

      // 3. Dispatch through Amazon SES
      const result = await this.sesService.sendEmail({
        to: recipient.email,
        fromName: campaign.senderName,
        fromEmail: campaign.senderEmail,
        replyTo: campaign.replyTo,
        subject: renderedSubject,
        html: compiledHtml,
        text: compiledText,
        unsubscribeUrl,
        textOnly: campaign.plainTextOnly === true,
      });

      // 4. Mark successful, and schedule the first follow-up if there is one
      recipient.status = 'SENT';
      recipient.sesMessageId = result.messageId;
      recipient.sentAt = new Date();
      recipient.lastSentAt = recipient.sentAt;
      recipient.failureReason = undefined;
      const firstFollowUp = campaign.followUps?.[0];
      if (firstFollowUp) {
        recipient.nextFollowUpAt = new Date(Date.now() + firstFollowUp.delayDays * 86400_000);
      }
      await recipient.save();

      // The lead has now been contacted.
      if (lead) {
        lead.lastContactedAt = new Date();
        if (lead.status === 'NEW' || lead.status === 'REVIEWED') lead.status = 'CONTACTED';
        await lead.save();
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to send email to ${recipient.email}: ${err.message}`,
      );

      const isThrottled =
        err.name === 'ThrottlingException' ||
        err.name === 'TooManyRequestsException' ||
        err.message?.includes('rate exceeded');

      if (isThrottled) {
        this.logger.warn(`SES rate limit hit. Backing off for 3 seconds...`);
        await new Promise((r) => setTimeout(r, 3000));
      }

      recipient.retryCount += 1;
      recipient.failureReason = err.message || 'Unknown SES delivery error';

      if (recipient.retryCount <= recipient.maxRetries && isThrottled) {
        // Re-queue throttled jobs for retry
        recipient.status = 'QUEUED';
        recipient.lockedAt = undefined;
      } else {
        // Final failure
        recipient.status = 'FAILED';
      }

      await recipient.save();
    }
  }

  /**
   * Synchronizes live count metrics on the campaign document.
   */
  async syncCampaignCounters(campaignId: Types.ObjectId): Promise<void> {
    const [sent, failed, delivered, bounced, complained, unsubscribed, queued] =
      await Promise.all([
        this.recipientModel.countDocuments({
          campaignId,
          status: { $in: ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'] },
        }),
        this.recipientModel.countDocuments({ campaignId, status: 'FAILED' }),
        this.recipientModel.countDocuments({ campaignId, status: 'DELIVERED' }),
        this.recipientModel.countDocuments({ campaignId, status: 'BOUNCED' }),
        this.recipientModel.countDocuments({
          campaignId,
          status: 'COMPLAINED',
        }),
        this.recipientModel.countDocuments({
          campaignId,
          $or: [
            { status: 'UNSUBSCRIBED' },
            { unsubscribedAt: { $exists: true, $ne: null } },
          ],
        }),
        this.recipientModel.countDocuments({
          campaignId,
          status: { $in: ['QUEUED', 'SENDING'] },
        }),
      ]);

    await this.campaignModel.findByIdAndUpdate(campaignId, {
      $set: {
        sentCount: sent,
        failedCount: failed,
        deliveredCount: delivered,
        bouncedCount: bounced,
        complainedCount: complained,
        unsubscribedCount: unsubscribed,
        queuedCount: queued,
      },
    });
  }

  private followUpRunning = false;

  /** Sends follow-ups that are due, inside sending hours and the daily limit. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processFollowUps(): Promise<number> {
    if (this.followUpRunning) return 0;
    this.followUpRunning = true;
    try {
      return await this.runFollowUps();
    } catch (err: any) {
      this.logger.error(`Follow-up run failed: ${err.message}`, err.stack);
      return 0;
    } finally {
      this.followUpRunning = false;
    }
  }

  private async runFollowUps(): Promise<number> {
    if (!this.sendWindow().open) return 0;
    let room = this.dailyLimit - (await this.sentLast24h());
    if (room <= 0) return 0;

    const now = new Date();
    const unlocked = [
      { followUpLockedAt: { $exists: false } },
      { followUpLockedAt: null },
      { followUpLockedAt: { $lt: new Date(now.getTime() - 10 * 60_000) } },
    ];
    const due = await this.recipientModel
      .find({ nextFollowUpAt: { $lte: now }, status: { $in: ['SENT', 'DELIVERED'] }, $or: unlocked })
      .sort({ nextFollowUpAt: 1 })
      .limit(Math.min(room, 100))
      .exec();

    const campaigns = new Map<string, EmailCampaignDocument | null>();
    const gapMs = Math.ceil(1000 / this.rateLimitPerSec);
    let sent = 0;

    for (const candidate of due) {
      // Claim it, so a second worker can't send the same follow-up.
      const r = await this.recipientModel.findOneAndUpdate(
        { _id: candidate._id, nextFollowUpAt: candidate.nextFollowUpAt, $or: unlocked },
        { $set: { followUpLockedAt: now } },
        { new: true },
      );
      if (!r) continue;
      const stop = (reason: string) =>
        this.recipientModel.updateOne(
          { _id: r._id },
          { $unset: { nextFollowUpAt: 1, followUpLockedAt: 1 }, $set: { followUpStopReason: reason } },
        );

      const key = r.campaignId.toString();
      if (!campaigns.has(key)) campaigns.set(key, await this.campaignModel.findById(r.campaignId));
      const campaign = campaigns.get(key);
      if (!campaign || campaign.status === 'CANCELLED') {
        await stop('Campaign cancelled');
        continue;
      }
      if (campaign.status === 'PAUSED') {
        // Waits; goes out once the campaign is resumed.
        await this.recipientModel.updateOne({ _id: r._id }, { $unset: { followUpLockedAt: 1 } });
        continue;
      }
      const followUp = campaign.followUps?.[r.followUpStep];
      if (!followUp) {
        await stop('No more follow-ups');
        continue;
      }
      const lead = await this.leadModel.findById(r.leadId);
      const blocker = this.followUpBlocker(lead);
      if (blocker) {
        await stop(blocker);
        continue;
      }

      const started = Date.now();
      try {
        const unsubscribeUrl = this.unsubscribeService.buildUnsubscribeUrl(r.email, r.leadId.toString(), key);
        const context = {
          businessName: r.businessName || lead?.businessName,
          displayName: r.displayName || lead?.displayName,
          city: r.city || lead?.city,
          category: r.category || lead?.category,
          area: lead?.area,
          state: lead?.state,
          email: r.email,
          phone: lead?.phone,
        };
        const subject = followUp.subject?.trim()
          ? this.templateEngine.render(followUp.subject, context)
          : `Re: ${this.templateEngine.render(campaign.subject, context)}`;
        const text = this.templateEngine.compileText(followUp.body, '', context, unsubscribeUrl);
        await this.sesService.sendEmail({
          to: r.email,
          fromName: campaign.senderName,
          fromEmail: campaign.senderEmail,
          replyTo: campaign.replyTo,
          subject,
          html: text,
          text,
          unsubscribeUrl,
          textOnly: true,
        });
        const next = campaign.followUps?.[r.followUpStep + 1];
        await this.recipientModel.updateOne(
          { _id: r._id },
          {
            $set: {
              lastSentAt: new Date(),
              followUpStep: r.followUpStep + 1,
              ...(next ? { nextFollowUpAt: new Date(Date.now() + next.delayDays * 86400_000) } : {}),
            },
            $unset: { followUpLockedAt: 1, ...(next ? {} : { nextFollowUpAt: 1 }) },
          },
        );
        if (lead) {
          lead.lastContactedAt = new Date();
          await lead.save();
        }
        sent++;
        if (--room <= 0) break;
      } catch (err: any) {
        const throttled = err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException';
        if (throttled) {
          await this.recipientModel.updateOne({ _id: r._id }, { $unset: { followUpLockedAt: 1 } });
          break;
        }
        await stop(`Follow-up failed: ${err.message || 'SES error'}`);
      }
      const wait = gapMs - (Date.now() - started);
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    }
    if (sent) this.logger.log(`Sent ${sent} follow-up email(s).`);
    return sent;
  }

  private followUpBlocker(lead: LeadDocument | null): string | null {
    if (!lead) return 'Lead deleted';
    if (lead.isEmailUnsubscribed) return 'Unsubscribed';
    if (lead.emailBounceStatus && lead.emailBounceStatus !== 'NONE') return 'Email bounced';
    if (FOLLOW_UP_STOP_STATUSES.includes(lead.status)) {
      return `Lead marked ${lead.status.toLowerCase().replace(/_/g, ' ')}`;
    }
    if (lead.whatsappRepliedAt) return 'Replied on WhatsApp';
    return null;
  }

  /**
   * Crash recovery & lock cleanup. Runs once every minute.
   * If the server restarted during active sending, releases stale locks back to 'QUEUED'
   * and automatically restarts any interrupted campaigns.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async recoverStaleLocks(): Promise<void> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 1. Release stale recipient locks
    const staleResult = await this.recipientModel.updateMany(
      {
        status: 'SENDING',
        lockedAt: { $lt: fiveMinutesAgo },
      },
      {
        $set: {
          status: 'QUEUED',
          lockedAt: undefined,
        },
      },
    );

    if (staleResult.modifiedCount > 0) {
      this.logger.warn(
        `Recovered ${staleResult.modifiedCount} stale recipient locks.`,
      );
    }

    // 2. Check for campaigns stuck in SENDING that have no active in-memory worker
    const sendingCampaigns = await this.campaignModel
      .find({ status: { $in: ['SENDING', 'QUEUED'] } })
      .select('_id')
      .exec();

    for (const c of sendingCampaigns) {
      const idStr = c._id.toString();
      if (!this.activeCampaignWorkers.has(idStr)) {
        this.logger.log(`Resuming interrupted campaign worker for ${idStr}`);
        this.startProcessingCampaign(idStr);
      }
    }
  }
}
