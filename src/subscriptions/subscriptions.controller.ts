import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  findMine(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.subscriptionsService.findCurrentForBusiness(
      business.businessId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner')
  @Post('activate')
  activate(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: ActivateSubscriptionDto,
  ) {
    return this.subscriptionsService.activateManually(
      business.businessId,
      dto.tier,
      dto.teamEnabled,
    );
  }

  // Not guarded: Razorpay calls this server-to-server. Signature verification
  // (see TODO in the service) is what should protect it once wired up.
  @Post('webhook/razorpay')
  handleWebhook(@Body() payload: unknown) {
    return this.subscriptionsService.handleRazorpayWebhook(payload);
  }
}
