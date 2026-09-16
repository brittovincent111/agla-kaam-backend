import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthenticatedBusiness,
  CurrentBusiness,
} from '../common/decorators/current-business.decorator';
import { ListPurchasesDto } from './dto/list-purchases.dto';
import { RecordPurchasePaymentDto } from './dto/record-purchase-payment.dto';
import { PurchasePdfService } from './purchase-pdf.service';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  isCustomAccentUnlocked,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  isDocumentTemplateUnlocked,
} from '../common/pdf/document-templates';

@Controller('purchases')
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly purchasePdfService: PurchasePdfService,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  // What the business owes each supplier. Declared before the ":id" routes
  // so "payables" is not swallowed as a purchase id.
  @Get('payables')
  payables(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.purchasesService.payablesBySupplier(business.businessId);
  }

  @Patch(':id/payment')
  recordPayment(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: RecordPurchasePaymentDto,
  ) {
    return this.purchasesService.recordPayment(
      business.businessId,
      id,
      dto.amount,
    );
  }

  // Same template/accent gating as the invoice download: a locked template
  // silently falls back to the default rather than rendering something the
  // plan does not include.
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const [purchase, biz, tier] = await Promise.all([
      this.purchasesService.findOne(business.businessId, id),
      this.businessesService.findById(business.businessId),
      this.subscriptionsService.getActiveTier(business.businessId),
    ]);
    const templateId = isDocumentTemplateUnlocked(biz.invoiceTemplateId, tier)
      ? biz.invoiceTemplateId
      : DEFAULT_DOCUMENT_TEMPLATE_ID;
    const accentColor = isCustomAccentUnlocked(tier)
      ? biz.documentAccentColor ?? null
      : null;
    const buffer = await this.purchasePdfService.generate(
      business.businessId,
      purchase as never,
      templateId,
      accentColor,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${purchase.purchaseNumber}.pdf"`,
    });
    res.send(buffer);
  }

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
