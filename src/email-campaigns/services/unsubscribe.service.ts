import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientDocument,
} from '../schemas/email-campaign-recipient.schema';
import {
  EmailCampaign,
  EmailCampaignDocument,
} from '../schemas/email-campaign.schema';
import {
  LeadActivity,
  LeadActivityDocument,
} from '../../lead-finder/schemas/lead-activity.schema';

export interface UnsubscribeTokenPayload {
  email: string;
  leadId: string;
  campaignId?: string;
}

@Injectable()
export class UnsubscribeService {
  private readonly logger = new Logger(UnsubscribeService.name);
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(EmailCampaignRecipient.name)
    private readonly recipientModel: Model<EmailCampaignRecipientDocument>,
    @InjectModel(EmailCampaign.name)
    private readonly campaignModel: Model<EmailCampaignDocument>,
    @InjectModel(LeadActivity.name)
    private readonly activityModel: Model<LeadActivityDocument>,
  ) {
    this.secret =
      this.configService.get<string>('JWT_SECRET') ||
      'fallback_secret_agla_kaam_marketing_unsub';

    this.baseUrl =
      this.configService.get<string>('UNSUBSCRIBE_BASE_URL') ||
      this.configService.get<string>('PUBLIC_API_URL') ||
      'https://aglakaam.app';
  }

  /**
   * Generates a tamper-proof HMAC-SHA256 signature for email + leadId (+ campaignId).
   */
  generateToken(email: string, leadId: string, campaignId?: string): string {
    const normalizedEmail = email.trim().toLowerCase();
    const data = `${normalizedEmail}|${leadId}|${campaignId || ''}`;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(data)
      .digest('hex');

    const payload: Record<string, string> = {
      e: normalizedEmail,
      l: leadId,
      s: signature,
    };

    if (campaignId) {
      payload.c = campaignId;
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  /**
   * Builds the complete unsubscribe URL for insertion into marketing emails.
   */
  buildUnsubscribeUrl(
    email: string,
    leadId: string,
    campaignId?: string,
  ): string {
    const token = this.generateToken(email, leadId, campaignId);
    // Base URL without trailing slash
    const base = this.baseUrl.replace(/\/+$/, '');
    return `${base}/api/marketing/unsubscribe?token=${token}`;
  }

  /**
   * Verifies the token and extracts email, leadId, and optional campaignId.
   */
  verifyToken(token: string): UnsubscribeTokenPayload {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);

      if (!parsed.e || !parsed.l || !parsed.s) {
        throw new BadRequestException('Malformed unsubscribe token');
      }

      // Support signatures generated with campaignId or without (backward compatibility)
      const dataWithCampaign = `${parsed.e}|${parsed.l}|${parsed.c || ''}`;
      const dataWithoutCampaign = `${parsed.e}|${parsed.l}`;

      const expectedSigWith = crypto
        .createHmac('sha256', this.secret)
        .update(dataWithCampaign)
        .digest('hex');

      const expectedSigWithout = crypto
        .createHmac('sha256', this.secret)
        .update(dataWithoutCampaign)
        .digest('hex');

      const matchWith =
        parsed.s.length === expectedSigWith.length &&
        crypto.timingSafeEqual(
          Buffer.from(parsed.s),
          Buffer.from(expectedSigWith),
        );

      const matchWithout =
        parsed.s.length === expectedSigWithout.length &&
        crypto.timingSafeEqual(
          Buffer.from(parsed.s),
          Buffer.from(expectedSigWithout),
        );

      if (!matchWith && !matchWithout) {
        throw new BadRequestException('Invalid or expired unsubscribe token');
      }

      return {
        email: parsed.e,
        leadId: parsed.l,
        campaignId: parsed.c,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Invalid unsubscribe token structure');
    }
  }

  /**
   * Executes the unsubscribe action idempotently.
   */
  async processUnsubscribe(token: string): Promise<{
    success: boolean;
    email: string;
    message: string;
  }> {
    const { email, leadId, campaignId } = this.verifyToken(token);
    const now = new Date();

    // 1. Update Lead suppression state
    if (Types.ObjectId.isValid(leadId)) {
      const lead = await this.leadModel.findById(leadId);
      if (lead) {
        lead.isEmailUnsubscribed = true;
        lead.unsubscribedAt = now;
        await lead.save();

        // Record activity log
        await this.activityModel.create({
          leadId: lead._id,
          type: 'OTHER',
          message: 'Unsubscribed from marketing emails',
          notes: `Unsubscribe link clicked for ${email}`,
          performedBy: 'Lead (Unsubscribe Link)',
        });
      }
    } else {
      // Fallback: update any leads matching this email address
      await this.leadModel.updateMany(
        { email: new RegExp(`^${email}$`, 'i') },
        {
          $set: {
            isEmailUnsubscribed: true,
            unsubscribedAt: now,
          },
        },
      );
    }

    // 2. Mark any pending or queued campaign recipients as UNSUBSCRIBED
    await this.recipientModel.updateMany(
      {
        email: email.toLowerCase(),
        status: { $in: ['PENDING', 'QUEUED'] },
      },
      {
        $set: {
          status: 'UNSUBSCRIBED',
          unsubscribedAt: now,
          failureReason: 'Recipient unsubscribed before message was dispatched',
        },
      },
    );

    // 3. If campaignId is tracked, update recipient and campaign metrics
    if (campaignId && Types.ObjectId.isValid(campaignId)) {
      await this.recipientModel.updateOne(
        {
          campaignId: new Types.ObjectId(campaignId),
          email: email.toLowerCase(),
        },
        {
          $set: {
            unsubscribedAt: now,
          },
        },
      );

      await this.campaignModel.findByIdAndUpdate(campaignId, {
        $inc: { unsubscribedCount: 1 },
      });
    }

    this.logger.log(`Recipient successfully unsubscribed: ${email}`);

    return {
      success: true,
      email,
      message:
        'You have been successfully unsubscribed from future marketing emails.',
    };
  }

  /**
   * Checks if an email is suppressed or unsubscribed.
   */
  async isEmailSuppressed(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const lead = await this.leadModel.findOne({
      email: new RegExp(`^${normalized}$`, 'i'),
      $or: [
        { isEmailUnsubscribed: true },
        { emailBounceStatus: { $in: ['HARD_BOUNCE', 'COMPLAINT'] } },
        { status: { $in: ['DO_NOT_CONTACT', 'INVALID'] } },
      ],
    });

    return Boolean(lead);
  }
}
