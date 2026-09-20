import { Controller, Get, Header } from '@nestjs/common';
import {
  DELETE_ACCOUNT_HTML,
  PRIVACY_POLICY_HTML,
  TERMS_OF_SERVICE_HTML,
  SUPPORT_HTML,
} from './legal.constants';

@Controller('legal')
export class LegalController {
  @Get('privacy-policy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacyPolicy(): string {
    return PRIVACY_POLICY_HTML;
  }

  @Get('terms-of-service')
  @Header('Content-Type', 'text/html; charset=utf-8')
  termsOfService(): string {
    return TERMS_OF_SERVICE_HTML;
  }

  // Support & Help Desk page required by Apple App Store and Google Play
  @Get('support')
  @Header('Content-Type', 'text/html; charset=utf-8')
  support(): string {
    return SUPPORT_HTML;
  }

  @Get('contact')
  @Header('Content-Type', 'text/html; charset=utf-8')
  contact(): string {
    return SUPPORT_HTML;
  }

  // Public page linked from the Google Play "Delete account URL" / "Delete
  // data URL" store-listing fields — must be reachable without auth since
  // it's meant for someone who no longer has the app installed.
  @Get('delete-account')
  @Header('Content-Type', 'text/html; charset=utf-8')
  deleteAccount(): string {
    return DELETE_ACCOUNT_HTML;
  }
}
