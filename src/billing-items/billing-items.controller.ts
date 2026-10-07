import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { BillingItemsService } from './billing-items.service';

@UseGuards(JwtAuthGuard, RolesGuard)
// Line suggestions for whoever bills: the owner or a manager.
@Roles('owner', 'manager')
@Controller('billing-items')
export class BillingItemsController {
  constructor(private readonly billingItemsService: BillingItemsService) {}

  @Get('recent')
  findRecent(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.billingItemsService.findRecent(business.businessId);
  }
}
