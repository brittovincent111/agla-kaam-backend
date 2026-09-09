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
import { CreateWebOrderDto } from './dto/create-web-order.dto';
import { LookupAccountDto } from './dto/lookup-account.dto';
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

  // Unauthenticated by necessity (a website visitor isn't logged in to
  // anything) — throttled so it can't be used to enumerate real customers'
  // phone numbers/emails/names at volume.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('lookup-account')
  lookupAccount(@Body() dto: LookupAccountDto) {
    return this.subscriptionsService.lookupWebAccount(dto.identifier);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('create-web-order')
  createWebOrder(@Body() dto: CreateWebOrderDto) {
    return this.subscriptionsService.createWebOrder(
      dto.identifier,
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

  // Google Play Real-time Developer Notifications, delivered by Pub/Sub.
  //
  // Unauthenticated by necessity — Google calls it server-to-server. It is
  // safe because the body is never trusted: it only names a purchase token,
  // which is then re-verified against the Android Publisher API before
  // anything is written. Always answers 200 so Pub/Sub does not retry
  // something we have already decided to ignore.
  @Post('webhook/play-notification')
  @HttpCode(200)
  async handlePlayNotification(@Body() body: unknown) {
    await this.subscriptionsService.handlePlayRenewalNotification(body);
    return { received: true };
  }

  // App Store Server Notifications V2. Same trust model as above: the
  // signedPayload identifies a transaction, and Apple's own API is then
  // asked what that transaction's real state is.
  @Post('webhook/apple-notification')
  @HttpCode(200)
  async handleAppleNotification(@Body() body: unknown) {
    await this.subscriptionsService.handleAppleRenewalNotification(body);
    return { received: true };
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
