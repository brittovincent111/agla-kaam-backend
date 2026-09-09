import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentBusiness, AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import { QuotationsService } from './quotations.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  isCustomAccentUnlocked,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  isDocumentTemplateUnlocked,
} from '../common/pdf/document-templates';
import { ListQuotationsDto } from './dto/list-quotations.dto';

// Quotations are an owner-only concern — technicians log services, not money.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('quotations')
export class QuotationsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly quotationPdfService: QuotationPdfService,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  create(@CurrentBusiness() business: AuthenticatedBusiness, @Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(business.businessId, dto);
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
    @Query() query: ListQuotationsDto,
  ) {
    return this.quotationsService.findPageForBusiness(business.businessId, query);
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.quotationsService.findAllForBusiness(business.businessId, { status, search, customerId });
  }

  @Get(':id')
  findOne(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.quotationsService.findOnePopulated(business.businessId, id);
  }

  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.update(business.businessId, id, dto);
  }

  @Patch(':id/send')
  send(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.quotationsService.send(business.businessId, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.quotationsService.cancel(business.businessId, id);
  }

  @Delete(':id')
  remove(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.quotationsService.remove(business.businessId, id);
  }

  @Post(':id/convert')
  convert(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.quotationsService.convertToInvoice(business.businessId, id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const [quotation, biz, tier] = await Promise.all([
      this.quotationsService.findOnePopulated(business.businessId, id),
      this.businessesService.findById(business.businessId),
      this.subscriptionsService.getActiveTier(business.businessId),
    ]);
    const templateId = isDocumentTemplateUnlocked(biz.invoiceTemplateId, tier)
      ? biz.invoiceTemplateId
      : DEFAULT_DOCUMENT_TEMPLATE_ID;
    const accentColor = isCustomAccentUnlocked(tier)
      ? biz.documentAccentColor ?? null
      : null;
    const buffer = await this.quotationPdfService.generate(
      business.businessId,
      quotation,
      templateId,
      accentColor,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quotation.quotationNumber}.pdf"`,
    });
    res.send(buffer);
  }
}
