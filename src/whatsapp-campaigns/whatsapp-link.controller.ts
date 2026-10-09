import { Controller, Get, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { WhatsappBotService } from './services/whatsapp-bot.service';

/**
 * The "Get the app" link the WhatsApp assistant sends: notes that this lead
 * clicked, then goes on to the download page. Public — it is opened from
 * WhatsApp, with no login.
 */
@SkipThrottle()
@Controller('whatsapp/go')
export class WhatsappLinkController {
  constructor(private readonly bot: WhatsappBotService) {}

  @Get(':leadId')
  async go(@Param('leadId') leadId: string, @Res() res: Response) {
    const target = await this.bot.clicked(leadId);
    res.redirect(302, target);
  }
}
