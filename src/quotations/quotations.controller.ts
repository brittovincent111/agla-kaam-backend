import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
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
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  isDocumentTemplateUnlocked,
} from '../common/pdf/document-templates';

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
    const buffer = await this.quotationPdfService.generate(business.businessId, quotation, templateId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quotation.quotationNumber}.pdf"`,
    });
    res.send(buffer);
  }
}
