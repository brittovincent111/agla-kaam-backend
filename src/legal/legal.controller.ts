import { Controller, Get, Header } from '@nestjs/common';
import { PRIVACY_POLICY_HTML, TERMS_OF_SERVICE_HTML } from './legal.constants';

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
}
