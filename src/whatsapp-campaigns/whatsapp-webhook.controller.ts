import { Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { WhatsappCloudService } from './services/whatsapp-cloud.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';

/**
 * Meta's callback for the WhatsApp number: set the Callback URL in the Meta
 * app to https://<api>/api/whatsapp/webhook and the Verify Token to
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN, then subscribe to "messages".
 */
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
      throw new ForbiddenException('Bad signature');
    }
    try {
      await this.webhook.handle(req.body);
    } catch (err) {
      // Answer 200 anyway: Meta retries a failed webhook for days, and one
      // bad payload must not block every later one.
      this.logger.error(`WhatsApp webhook handling failed: ${(err as Error).message}`, (err as Error).stack);
    }
    return { received: true };
  }
}
