import { Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { WhatsappCloudService } from './services/whatsapp-cloud.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';

/**
 * Meta's callback for the WhatsApp number: set the Callback URL in the Meta
 * app to https://<api>/api/whatsapp/webhook and the Verify Token to
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN, then subscribe to "messages".
 */
// Not rate-limited: Meta sends a callback per status (sent, delivered, read)
// for every message from a handful of IPs, so a 250-message campaign is
// ~750 calls in minutes. Throttled ones came back 429 and were retried late
// or lost. The signature check below is what keeps others out.
@SkipThrottle()
@Controller('whatsapp/webhook')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cloud: WhatsappCloudService,
    private readonly webhook: WhatsappWebhookService,
  ) {}

  // Meta's one-time check when the callback URL is saved.
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }) {
    if (!this.cloud.verifySignature(req.rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
      this.logger.warn(
        `WhatsApp webhook rejected: bad or missing signature (check WHATSAPP_APP_SECRET is this app's secret)`,
      );
      throw new ForbiddenException('Bad signature');
    }
    this.logEvents(req.body);
    try {
      await this.webhook.handle(req.body);
    } catch (err) {
      // Answer 200 anyway: Meta retries a failed webhook for days, and one
      // bad payload must not block every later one.
      this.logger.error(`WhatsApp webhook handling failed: ${(err as Error).message}`, (err as Error).stack);
    }
    return { received: true };
  }

  // One line per callback in the pm2 out log, so a test send can be followed
  // from "sent" to "read" — or to why it failed. Ids and phone numbers only;
  // message text is not logged.
  private logEvents(body: any): void {
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        for (const s of value.statuses ?? []) {
          const errors = s.errors?.length
            ? ` errors=${JSON.stringify(
                s.errors.map((e: any) => ({
                  code: e.code,
                  title: e.title,
                  message: e.message,
                  details: e.error_data?.details,
                })),
              )}`
            : '';
          this.logger.log(`[WA status] ${s.status} id=${s.id} to=${s.recipient_id}${errors}`);
        }
        for (const m of value.messages ?? []) {
          this.logger.log(`[WA in] from=${m.from} type=${m.type} id=${m.id}${m.context?.id ? ` reply_to=${m.context.id}` : ''}`);
        }
        if (!value.statuses?.length && !value.messages?.length) {
          this.logger.log(`[WA other] field=${change?.field ?? 'unknown'}`);
        }
      }
    }
  }
}
