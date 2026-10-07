import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { InvoicingService } from './invoicing.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  isCustomAccentUnlocked,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  isDocumentTemplateUnlocked,
} from '../common/pdf/document-templates';
import { ListInvoicesDto } from './dto/list-invoices.dto';

// Invoicing is an owner-only concern — technicians log services, not money.
@UseGuards(JwtAuthGuard, RolesGuard)
// Managers bill like the owner; the business-wide money total stays the
// owner's (see outstanding-summary).
@Roles('owner', 'manager')
@Controller('invoices')
export class InvoicingController {
  constructor(
    private readonly invoicingService: InvoicingService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicingService.create(business.businessId, dto);
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
  async findPage(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListInvoicesDto,
  ) {
    const page = await this.invoicingService.findPageForBusiness(
      business.businessId,
      query,
    );
    // "₹X billed · ₹Y due" over the whole list is a business money total —
    // the owner's. A manager still sees every invoice's own amounts.
    if (business.role === 'owner') return page;
    const { summary: _summary, ...rest } = page;
    return rest;
  }

  // The invoice billing one job, or null — the completed job's checklist.
  @Get('for-service/:serviceId')
  async forService(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('serviceId') serviceId: string,
  ) {
    const invoice = await this.invoicingService.findLatestForService(
      business.businessId,
      serviceId,
    );
    if (!invoice) return { invoice: null };
    return {
      invoice: {
        _id: String(invoice._id),
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        balanceDue: invoice.balanceDue,
        status: invoice.status,
      },
    };
  }

  // Declared before ':id' so "customer-summary" is not read as an id.
  @Get('customer-summary/:customerId')
  customerSummary(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('customerId') customerId: string,
  ) {
    return this.invoicingService.customerSummary(
      business.businessId,
      customerId,
    );
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.invoicingService.findAllForBusiness(business.businessId, {
      status,
      search,
      customerId,
    });
  }

  // The business's total still owed — a business-level money total, so the
  // owner's alone; a manager sees amounts per invoice and per customer.
  @Roles('owner')
  @Get('outstanding-summary')
  outstandingSummary(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.invoicingService.findOutstandingSummary(business.businessId);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.invoicingService.findOneWithDisplayStatus(
      business.businessId,
      id,
    );
  }

  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicingService.update(business.businessId, id, dto);
  }

  @Patch(':id/send')
  send(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.invoicingService.send(business.businessId, id);
  }

  @Patch(':id/cancel')
  cancel(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.invoicingService.cancel(business.businessId, id);
  }

  @Delete(':id')
  remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.invoicingService.remove(business.businessId, id);
  }

  @Post(':id/payments')
  recordPayment(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.invoicingService.recordPayment(business.businessId, id, dto);
  }

  // Correcting or removing a payment recorded by mistake. Payments taken
  // at a job's visit are refused here — they are corrected on the job.
  @Patch(':id/payments/:paymentId')
  updatePayment(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.invoicingService.updatePayment(
      business.businessId,
      id,
      paymentId,
      dto,
    );
  }

  @Delete(':id/payments/:paymentId')
  removePayment(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.invoicingService.removePayment(
      business.businessId,
      id,
      paymentId,
    );
  }

  @Get(':id/payments')
  listPayments(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.invoicingService.findPaymentsForInvoice(
      business.businessId,
      id,
    );
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const [invoice, biz, tier] = await Promise.all([
      this.invoicingService.findOneWithDisplayStatus(business.businessId, id),
      this.businessesService.findById(business.businessId),
      this.subscriptionsService.getActiveTier(business.businessId),
    ]);
    const templateId = isDocumentTemplateUnlocked(biz.invoiceTemplateId, tier)
      ? biz.invoiceTemplateId
      : DEFAULT_DOCUMENT_TEMPLATE_ID;
    const accentColor = isCustomAccentUnlocked(tier)
      ? (biz.documentAccentColor ?? null)
      : null;
    const buffer = await this.invoicePdfService.generate(
      business.businessId,
      invoice as any,
      templateId,
      accentColor,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    });
    res.send(buffer);
  }
}
