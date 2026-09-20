import { Controller, Get, Query } from '@nestjs/common';
import { AppVersionService, Platform } from './app-version.service';

/**
 * Public, like /geo/countries: the app has to be able to discover that it is
 * too old before it can sign in, and a blocked build has no token to present.
 */
@Controller('app-version')
export class AppVersionController {
  constructor(private readonly service: AppVersionService) {}

  @Get()
  get(@Query('platform') platform?: string) {
    const normalised: Platform = platform === 'android' ? 'android' : 'ios';
    return this.service.forPlatform(normalised);
  }
}
