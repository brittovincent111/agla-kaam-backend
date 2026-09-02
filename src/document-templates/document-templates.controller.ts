import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InvoicePdfService } from '../invoicing/invoice-pdf.service';
import { QuotationPdfService } from '../quotations/quotation-pdf.service';
import { SetDocumentTemplateDto } from './dto/set-document-template.dto';
import {
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  DOCUMENT_TEMPLATE_IDS,
  DocumentTemplateId,
  isDocumentTemplateUnlocked,
  listDocumentTemplatesForTier,
} from '../common/pdf/document-templates';
import {
  buildSampleInvoice,
  buildSampleQuotation,
  SAMPLE_CUSTOMER,
} from './sample-data';

// Owner-only: templates change what customers see on real invoices/quotations.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly quotationPdfService: QuotationPdfService,
  ) {}

  @Get()
  async list(@CurrentBusiness() business: AuthenticatedBusiness) {
    const [tier, biz] = await Promise.all([
      this.subscriptionsService.getActiveTier(business.businessId),
      this.businessesService.findById(business.businessId),
    ]);
    return {
      activeTemplateId: biz.invoiceTemplateId ?? DEFAULT_DOCUMENT_TEMPLATE_ID,
      templates: listDocumentTemplatesForTier(tier),
    };
  }

  @Patch()
  async setActive(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: SetDocumentTemplateDto,
  ) {
    const tier = await this.subscriptionsService.getActiveTier(
      business.businessId,
    );
    if (!isDocumentTemplateUnlocked(dto.templateId, tier)) {
      throw new ForbiddenException(
        'Upgrade to Invoicing or Combo to use this template.',
      );
    }
    await this.businessesService.setInvoiceTemplate(
      business.businessId,
      dto.templateId,
    );
    return { activeTemplateId: dto.templateId };
  }

  @Get(':templateId/preview/invoice')
  async previewInvoice(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('templateId') templateId: string,
    @Res() res: Response,
  ) {
    const id = this.assertValidTemplateId(templateId);
    const biz = await this.businessesService.findByIdWithBranding(
      business.businessId,
    );
    const buffer = await this.invoicePdfService.render(
      biz,
      SAMPLE_CUSTOMER,
      buildSampleInvoice(),
      id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="template-preview-invoice.pdf"',
    });
    res.send(buffer);
  }

  @Get(':templateId/preview/quotation')
  async previewQuotation(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('templateId') templateId: string,
    @Res() res: Response,
  ) {
    const id = this.assertValidTemplateId(templateId);
    const biz = await this.businessesService.findByIdWithBranding(
      business.businessId,
    );
    const buffer = await this.quotationPdfService.render(
      biz,
      SAMPLE_CUSTOMER,
      buildSampleQuotation(),
      id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'inline; filename="template-preview-quotation.pdf"',
    });
    res.send(buffer);
  }

  private assertValidTemplateId(templateId: string): DocumentTemplateId {
    if (!(DOCUMENT_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
      throw new NotFoundException('Unknown template');
    }
    return templateId as DocumentTemplateId;
  }
}
