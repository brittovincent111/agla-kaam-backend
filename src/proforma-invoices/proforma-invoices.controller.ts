import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { ProformaPdfService } from './proforma-pdf.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { CurrentBusiness, AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  isCustomAccentUnlocked,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  isDocumentTemplateUnlocked,
} from '../common/pdf/document-templates';
import { ListProformaInvoicesDto } from './dto/list-proforma-invoices.dto';

@Controller('proforma-invoices')
@UseGuards(JwtAuthGuard)
export class ProformaInvoicesController {
  constructor(
    private readonly proformaService: ProformaInvoicesService,
    private readonly proformaPdfService: ProformaPdfService,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateProformaInvoiceDto,
  ) {
    return this.proformaService.create(business.businessId, dto);
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
    @Query() query: ListProformaInvoicesDto,
  ) {
    return this.proformaService.findPageForBusiness(business.businessId, query);
  }

  @Get()
  findAll(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.proformaService.findAll(business.businessId);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.proformaService.findOne(business.businessId, id);
  }

  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateProformaInvoiceDto,
  ) {
    return this.proformaService.update(business.businessId, id, dto);
  }

  @Delete(':id')
  delete(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.proformaService.delete(business.businessId, id);
  }

  @Post(':id/convert')
  convert(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.proformaService.convertToTaxInvoice(business.businessId, id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const [proforma, biz, tier] = await Promise.all([
      this.proformaService.findOne(business.businessId, id),
      this.businessesService.findById(business.businessId),
      this.subscriptionsService.getActiveTier(business.businessId),
    ]);
    const templateId = isDocumentTemplateUnlocked(biz.invoiceTemplateId, tier)
      ? biz.invoiceTemplateId
      : DEFAULT_DOCUMENT_TEMPLATE_ID;
    const accentColor = isCustomAccentUnlocked(tier)
      ? biz.documentAccentColor ?? null
      : null;
    const buffer = await this.proformaPdfService.generate(
      business.businessId,
      proforma as any,
      templateId,
      accentColor,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${proforma.proformaNumber}.pdf"`,
    });
    res.send(buffer);
  }
}
