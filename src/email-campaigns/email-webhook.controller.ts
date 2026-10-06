import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UnsubscribeService } from './services/unsubscribe.service';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientDocument,
} from './schemas/email-campaign-recipient.schema';
import {
  EmailCampaign,
  EmailCampaignDocument,
} from './schemas/email-campaign.schema';
import { Lead, LeadDocument } from '../lead-finder/schemas/lead.schema';

@Controller('marketing')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private readonly unsubscribeService: UnsubscribeService,
    @InjectModel(EmailCampaignRecipient.name)
    private readonly recipientModel: Model<EmailCampaignRecipientDocument>,
    @InjectModel(EmailCampaign.name)
    private readonly campaignModel: Model<EmailCampaignDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
  ) {}

  /**
   * Public browser-based unsubscribe link.
   * Renders a clean, friendly confirmation page.
   */
  @Get('unsubscribe')
  async handleUnsubscribePage(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) {
      throw new BadRequestException('Missing unsubscribe token');
    }

    try {
      const result = await this.unsubscribeService.processUnsubscribe(token);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed - Agla Kaam</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f9fafb;
      margin: 0;
      padding: 40px 16px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
    }
    .card {
      background: #ffffff;
      max-width: 480px;
      width: 100%;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      text-align: center;
    }
    .icon {
      width: 56px;
      height: 56px;
      background-color: #ecfdf5;
      color: #059669;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px auto;
      font-size: 28px;
    }
    h1 {
      color: #111827;
      font-size: 22px;
      font-weight: 600;
      margin: 0 0 12px 0;
    }
    p {
      color: #4b5563;
      font-size: 15px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .email-badge {
      display: inline-block;
      background: #f3f4f6;
      color: #1f2937;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 500;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .footer {
      font-size: 12px;
      color: #9ca3af;
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>You're Unsubscribed</h1>
    <p>Your email address has been removed from our marketing mailing list. You won't receive promotional emails from us again.</p>
    <div class="email-badge">${result.email}</div>
    <div class="footer">Agla Kaam · Field Service Management App</div>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(html);
    } catch (err: any) {
      this.logger.warn(`Unsubscribe failure: ${err.message}`);
      res.setHeader('Content-Type', 'text/html');
      return res.status(400).send(`
        <!DOCTYPE html>
        <html><body style="font-family:sans-serif;text-align:center;padding:50px;">
          <h2>Invalid or Expired Link</h2>
          <p>This unsubscribe link could not be verified. Please contact support@aglakaam.app if you need help.</p>
        </body></html>
      `);
    }
  }

  /**
   * One-Click RFC 8058 List-Unsubscribe handler (called by mail clients via POST).
   */
  @Post('unsubscribe')
  @HttpCode(200)
  async handleOneClickUnsubscribe(@Req() req: any) {
    const token = req.query?.token || req.body?.token;
    if (!token) {
      throw new BadRequestException('Missing unsubscribe token');
    }
    return this.unsubscribeService.processUnsubscribe(token);
  }

  /**
   * Amazon SES / SNS Webhook for Delivery, Bounce, and Complaint events.
   */
  @Post('ses-events')
  @HttpCode(200)
  async handleSesWebhook(@Req() req: any, @Body() payload: any) {
    let body = payload;

    // Handle text/plain or raw body from Amazon SNS
    if (!body || Object.keys(body).length === 0 || typeof body === 'string') {
      if (req.rawBody) {
        try {
          body = JSON.parse(req.rawBody.toString('utf8'));
        } catch {
          // Keep body as is
        }
      } else if (typeof payload === 'string') {
        try {
          body = JSON.parse(payload);
        } catch {
          return { status: 'ignored' };
        }
      }
    }

    if (!body || typeof body !== 'object') {
      return { status: 'ignored' };
    }

    // 1. Amazon SNS Subscription Confirmation
    if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
      this.logger.log(`Confirming SNS subscription via: ${body.SubscribeURL}`);
      try {
        await fetch(body.SubscribeURL);
        return { status: 'subscription_confirmed' };
      } catch (err: any) {
        this.logger.error(`SNS confirmation failed: ${err.message}`);
        return { status: 'confirmation_failed' };
      }
    }

    // 2. Notification processing (Supports both SNS wrapper and direct SES payload)
    let event: any = body.Message ? body.Message : body;
    if (typeof event === 'string') {
      try {
        event = JSON.parse(event);
      } catch {
        return { status: 'parse_error' };
      }
    }

    const eventType = event.eventType || event.notificationType;
    const mail = event.mail || {};
    const sesMessageId = mail.messageId;

    if (!sesMessageId) {
      return { status: 'no_message_id' };
    }

    this.logger.log(
      `SES Event received: Type=${eventType}, MessageId=${sesMessageId}`,
    );

    // Find the corresponding campaign recipient
    const recipient = await this.recipientModel.findOne({ sesMessageId });
    if (!recipient) {
      return { status: 'recipient_not_tracked' };
    }

    const now = new Date();

    if (eventType === 'Bounce') {
      const bounce = event.bounce || {};
      const isPermanent = bounce.bounceType === 'Permanent';

      if (recipient.status !== 'BOUNCED') {
        recipient.status = 'BOUNCED';
        recipient.bouncedAt = now;
        recipient.failureReason = `Bounce (${bounce.bounceType || 'Unknown'}): ${bounce.bouncedRecipients?.[0]?.diagnosticCode || 'Undeliverable'}`;
        await recipient.save();

        // Increment campaign bounce counter
        await this.campaignModel.findByIdAndUpdate(recipient.campaignId, {
          $inc: { bouncedCount: 1 },
        });
      }

      // If permanent hard bounce, suppress future sends to this lead across all matches
      if (isPermanent) {
        await this.leadModel.updateMany(
          {
            $or: [
              { _id: recipient.leadId },
              { email: new RegExp(`^${recipient.email}$`, 'i') },
            ],
          },
          {
            $set: {
              emailBounceStatus: 'HARD_BOUNCE',
              emailBouncedAt: now,
            },
          },
        );
      }
    } else if (eventType === 'Complaint') {
      if (recipient.status !== 'COMPLAINED') {
        recipient.status = 'COMPLAINED';
        recipient.complainedAt = now;
        recipient.failureReason = 'Recipient marked as spam/complaint';
        await recipient.save();

        await this.campaignModel.findByIdAndUpdate(recipient.campaignId, {
          $inc: { complainedCount: 1 },
        });
      }

      // Strictly suppress lead immediately across all matching records
      await this.leadModel.updateMany(
        {
          $or: [
            { _id: recipient.leadId },
            { email: new RegExp(`^${recipient.email}$`, 'i') },
          ],
        },
        {
          $set: {
            isEmailUnsubscribed: true,
            emailBounceStatus: 'COMPLAINT',
            emailComplainedAt: now,
          },
        },
      );
    } else if (eventType === 'Delivery') {
      if (recipient.status === 'SENT') {
        recipient.status = 'DELIVERED';
        recipient.deliveredAt = now;
        await recipient.save();

        await this.campaignModel.findByIdAndUpdate(recipient.campaignId, {
          $inc: { deliveredCount: 1 },
        });
      }
    }

    return { status: 'processed' };
  }
}
