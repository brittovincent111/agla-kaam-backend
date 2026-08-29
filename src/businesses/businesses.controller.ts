import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessDto } from './dto/update-business.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  // Open to technicians too — read-only, and the app needs it to show the
  // business name/phone in headers and WhatsApp message templates.
  @Get('me')
  getProfile(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.businessesService.findByIdWithUsage(business.businessId);
  }

  @Roles('owner')
  @Patch('me')
  updateProfile(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businessesService.update(business.businessId, dto);
  }

  @Roles('owner')
  @Delete('me')
  deleteAccount(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.businessesService.remove(business.businessId);
  }
}
