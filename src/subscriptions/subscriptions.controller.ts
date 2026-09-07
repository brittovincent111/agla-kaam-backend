import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPlayPurchaseDto } from './dto/verify-play-purchase.dto';
import { VerifyApplePurchaseDto } from './dto/verify-apple-purchase.dto';

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner')
  @Post('create-order')
  createOrder(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateOrderDto,
  ) {
    return this.subscriptionsService.createOrder(
      business.businessId,
      dto.tier,
      dto.teamEnabled,
    );
  }

  @Post('lookup-account')
  lookupAccount(@Body() dto: { identifier: string }) {
    return this.subscriptionsService.lookupWebAccount(dto.identifier);
  }

  @Post('create-web-order')
  createWebOrder(
    @Body() dto: { identifier?: string; phone?: string; tier: any; teamEnabled?: boolean },
  ) {
    return this.subscriptionsService.createWebOrder(
      dto.identifier || dto.phone || '',
      dto.tier,
      dto.teamEnabled,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-play-purchase')
  verifyPlayPurchase(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: VerifyPlayPurchaseDto,
  ) {
    return this.subscriptionsService.verifyAndActivatePlayPurchase(
      business.businessId,
      dto.productId,
      dto.purchaseToken,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-apple-purchase')
  verifyApplePurchase(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: VerifyApplePurchaseDto,
  ) {
    return this.subscriptionsService.verifyAndActivateApplePurchase(
      business.businessId,
      dto.productId,
      dto.purchaseToken,
    );
  }

  // Not guarded by JwtAuthGuard: Razorpay calls this server-to-server.
  // The x-razorpay-signature header (verified against the raw body in the
  // service) is what protects it instead.
  @Post('webhook/razorpay')
  @HttpCode(200)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ) {
    return this.subscriptionsService.handleRazorpayWebhook(
      req.rawBody,
      signature,
    );
  }
}
