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
  ACCENT_PRESETS,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  DOCUMENT_TEMPLATE_IDS,
  DocumentTemplateId,
  isCustomAccentUnlocked,
  isDocumentTemplateUnlocked,
  listDocumentTemplatesForTier,
} from '../common/pdf/document-templates';
import { normalizeHex } from '../common/pdf/document-colors';
import {
  buildSampleInvoice,
  buildSampleQuotation,
  SAMPLE_CUSTOMER,
  SAMPLE_SERVICE_CONTEXT,
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
    const accentUnlocked = isCustomAccentUnlocked(tier);
    // A business that has downgraded keeps its stored accent, but it stops
    // applying — both here and in the PDF (see effectiveAccent below), so the
    // picker never shows a colour the customer's invoice won't actually use.
    const activeAccent = accentUnlocked ? biz.documentAccentColor ?? null : null;
    return {
      activeTemplateId: biz.invoiceTemplateId ?? DEFAULT_DOCUMENT_TEMPLATE_ID,
      activeAccent,
      accentLocked: !accentUnlocked,
      accentPresets: ACCENT_PRESETS,
      templates: listDocumentTemplatesForTier(tier, activeAccent),
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

    // `undefined` means the caller only changed the layout — leave any stored
    // accent as it is. A real colour needs the paid tier; clearing (null)
    // never does, so a downgraded business can always reset to the default.
    let accent: string | null | undefined;
    if (dto.accentColor === null) {
      accent = null;
    } else if (dto.accentColor !== undefined) {
      if (!isCustomAccentUnlocked(tier)) {
        throw new ForbiddenException(
          'Upgrade to Invoicing or Combo to use your own brand colour.',
        );
      }
      accent = normalizeHex(dto.accentColor);
      if (!accent) {
        throw new ForbiddenException('That is not a valid colour.');
      }
    }

    const updated = await this.businessesService.setInvoiceTemplate(
      business.businessId,
      dto.templateId,
      accent,
    );
    return {
      activeTemplateId: dto.templateId,
      activeAccent: updated.documentAccentColor ?? null,
    };
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
      await this.effectiveAccent(business.businessId, biz.documentAccentColor),
      {
        serviceContext: SAMPLE_SERVICE_CONTEXT,
        payment: { method: 'UPI' },
      },
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
      await this.effectiveAccent(business.businessId, biz.documentAccentColor),
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'inline; filename="template-preview-quotation.pdf"',
    });
    res.send(buffer);
  }

  // The stored accent only applies while the tier that unlocked it is
  // active. Centralised here so a preview can never show a colour the real
  // PDF would drop.
  private async effectiveAccent(
    businessId: string,
    storedAccent: string | undefined,
  ): Promise<string | null> {
    if (!storedAccent) return null;
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    return isCustomAccentUnlocked(tier) ? storedAccent : null;
  }

  private assertValidTemplateId(templateId: string): DocumentTemplateId {
    if (!(DOCUMENT_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
      throw new NotFoundException('Unknown template');
    }
    return templateId as DocumentTemplateId;
  }
}
