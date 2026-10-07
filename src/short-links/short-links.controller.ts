import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { isShortCode, ShortLinksService } from './short-links.service';
import { publicWebBase } from '../common/public/public-urls';

// Public: the customer taps this in WhatsApp with no login.
@Controller('s')
export class ShortLinksController {
  constructor(
    private readonly shortLinksService: ShortLinksService,
    private readonly configService: ConfigService,
  ) {}

  @Get(':code')
  async open(@Param('code') code: string, @Res() res: Response) {
    // With the website pages in use, links already sent open there too; the
    // website looks the code up (below) and shows its own "expired" page.
    const web = publicWebBase(this.configService);
    if (web) {
      if (!isShortCode(code))
        throw new NotFoundException('This link has expired.');
      return res.redirect(302, `${web}/r/${code}`);
    }
    const target = await this.shortLinksService.resolve(code);
    if (!target) throw new NotFoundException('This link has expired.');
    return res.redirect(302, target);
  }
}

// The website's /r/:code page asks what a short code opens.
@Controller('public/links')
export class PublicLinksController {
  constructor(private readonly shortLinksService: ShortLinksService) {}

    // Called by the website's server for every customer who opens a link, so
  // all of them share one address here. The token or 8-letter code can't be
  // guessed, so a high limit costs nothing in safety.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Get(':code')
  async resolve(@Param('code') code: string) {
    const share = await this.shortLinksService.resolveShare(code);
    if (!share) throw new NotFoundException('This link has expired.');
    return share;
  }
}
