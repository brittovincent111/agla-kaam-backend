import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentBusiness, AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import { InvoicingService } from './invoicing.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

// Invoicing is an owner-only concern — technicians log services, not money.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('invoices')
export class InvoicingController {
  constructor(
    private readonly invoicingService: InvoicingService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Post()
  create(@CurrentBusiness() business: AuthenticatedBusiness, @Body() dto: CreateInvoiceDto) {
    return this.invoicingService.create(business.businessId, dto);
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.invoicingService.findAllForBusiness(business.businessId, { status, search, customerId });
  }

  @Get('outstanding-summary')
  outstandingSummary(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.invoicingService.findOutstandingSummary(business.businessId);
  }

  @Get(':id')
  findOne(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.invoicingService.findOneWithDisplayStatus(business.businessId, id);
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
  send(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.invoicingService.send(business.businessId, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.invoicingService.cancel(business.businessId, id);
  }

  @Delete(':id')
  remove(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
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

  @Get(':id/payments')
  listPayments(@CurrentBusiness() business: AuthenticatedBusiness, @Param('id') id: string) {
    return this.invoicingService.findPaymentsForInvoice(business.businessId, id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const invoice = await this.invoicingService.findOneWithDisplayStatus(business.businessId, id);
    const buffer = await this.invoicePdfService.generate(business.businessId, invoice as any);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    });
    res.send(buffer);
  }
}
