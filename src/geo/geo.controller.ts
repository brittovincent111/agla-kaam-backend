import { Controller, Get } from '@nestjs/common';
import { allGeoDefaults } from '../common/utils/geo-defaults';

/**
 * Public on purpose. The sign-up screen needs to know which dial code to
 * offer before an account — and therefore a token — exists, and this is a
 * static list of countries with nothing private in it. Serving it is what
 * keeps the app from carrying its own copy of what each country implies.
 */
@Controller('geo')
export class GeoController {
  @Get('countries')
  countries() {
    return allGeoDefaults();
  }
}
