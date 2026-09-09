import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthenticatedBusiness,
  CurrentBusiness,
} from '../common/decorators/current-business.decorator';
import { ListPurchasesDto } from './dto/list-purchases.dto';

@Controller('purchases')
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.purchasesService.create(business.businessId, dto);
  }

  // Paged, filtered and searched on the server. A separate route from GET
  // (the unpaged list below) on purpose: that one returns a bare array and is
  // still what already-installed app versions call, so its shape must not
  // change under them.
  //
  // Above the global 60/min budget — scrolling a long list plus a few
  // debounced search terms is easily a dozen calls, and using the app
  // normally must not return "Too Many Requests".
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Get('page')
  findPage(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListPurchasesDto,
  ) {
    return this.purchasesService.findPageForBusiness(business.businessId, query);
  }

  @Get()
  findAll(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.purchasesService.findAll(business.businessId);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.purchasesService.findOne(business.businessId, id);
  }
}
