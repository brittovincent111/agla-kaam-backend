import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { RemindersService } from './reminders.service';
import { ServicesService } from '../services/services.service';
import { CustomersService } from '../customers/customers.service';
import { BusinessesService } from '../businesses/businesses.service';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { formatCurrency } from '../common/pdf/document-render';

function formatDateEnIN(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly servicesService: ServicesService,
    private readonly customersService: CustomersService,
    private readonly businessesService: BusinessesService,
    private readonly servicePresetsService: ServicePresetsService,
    private readonly invoicingService: InvoicingService,
  ) {}

  // One request for the whole dashboard: the four reminder feeds, each capped
  // to `limit` rows and carrying its true total. Replaces four unpaged calls.
  @Get('summary')
  summary(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.remindersService.summary(business.businessId, business, {
      days: days ? Number(days) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('overdue')
  overdue(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.remindersService.overdue(business.businessId, business);
  }

  @Get('warranty-alerts')
  warrantyAlerts(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.remindersService.warrantyAlerts(business.businessId, business);
  }

  @Get('due-today')
  dueToday(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.remindersService.dueToday(business.businessId, business);
  }

  @Get('due-soon')
  dueSoon(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('days') days?: string,
  ) {
    return this.remindersService.dueSoon(
      business.businessId,
      days ? Number(days) : 30,
      business,
    );
  }

  @Get('whatsapp-link/:serviceId')
  async whatsappLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('serviceId') serviceId: string,
  ) {
    const service = await this.servicesService.findOne(
      business.businessId,
      serviceId,
      business,
    );
    const customer = await this.customersService.findOne(
      business.businessId,
      service.customerId.toString(),
    );
    const businessDoc = await this.businessesService.findById(
      business.businessId,
    );
    const preset = await this.servicePresetsService.findByName(
      business.businessId,
      service.serviceType,
    );

    const message = this.remindersService.buildWhatsAppMessage(
      {
        customerName: customer.name,
        businessName: businessDoc.name,
        serviceType: service.serviceType,
        nextServiceDate: formatDateEnIN(service.nextServiceDate),
      },
      preset?.messageTemplate,
    );
    return {
      url: this.remindersService.buildWhatsAppLink(customer.phone, message),
      message,
    };
  }

  // Chasing an unpaid invoice. The app could show that money was outstanding
  // but had no way to ask for it — every other reminder here is about work
  // due, not money owed.
  @Get('payment-link/:invoiceId')
  async paymentLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('invoiceId') invoiceId: string,
  ) {
    const invoice = await this.invoicingService.findOne(
      business.businessId,
      invoiceId,
    );
    const customer = await this.customersService.findOne(
      business.businessId,
      invoice.customerId.toString(),
    );
    const businessDoc = await this.businessesService.findById(
      business.businessId,
    );

    const message = this.remindersService.buildPaymentReminderMessage(
      {
        customerName: customer.name,
        businessName: businessDoc.name,
        invoiceNumber: invoice.invoiceNumber,
        // The amount still owed, not the invoice total — chasing the full
        // amount on a part-paid invoice is how you annoy a customer who has
        // already paid half.
        balanceDue: formatCurrency(
          invoice.balanceDue,
          invoice.currency || businessDoc.currency || 'INR',
        ),
        dueDate: formatDateEnIN(invoice.dueDate),
      },
      businessDoc.paymentReminderTemplate,
    );

    return {
      url: this.remindersService.buildWhatsAppLink(customer.phone, message),
      message,
      balanceDue: invoice.balanceDue,
    };
  }

  // The service-card share. Separate from whatsapp-link above because the two
  // messages say different things — this one is the record of the work done,
  // that one is a nudge about work that is due — but both are now rendered
  // here rather than one here and one on the device.
  @Get('service-card-link/:serviceId')
  async serviceCardLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('serviceId') serviceId: string,
  ) {
    const service = await this.servicesService.findOne(
      business.businessId,
      serviceId,
      business,
    );
    const customer = await this.customersService.findOne(
      business.businessId,
      service.customerId.toString(),
    );
    const businessDoc = await this.businessesService.findById(
      business.businessId,
    );

    const status =
      service.status === 'cancelled'
        ? 'Cancelled'
        : service.status === 'completed'
          ? 'Completed'
          : 'Pending';

    const reviewLine =
      service.status === 'completed' && businessDoc.googleReviewUrl?.trim()
        ? `\n\n⭐ Enjoyed our service? Please leave us a Google review:\n${businessDoc.googleReviewUrl.trim()}`
        : '';

    const message = this.remindersService.buildServiceCardMessage(
      {
        customerName: customer.name,
        businessName: businessDoc.name,
        serviceType: service.serviceType,
        status,
        serviceDate: formatDateEnIN(service.serviceDate),
        // Carries its own newline so the line vanishes on a pending job.
        completedLine: service.completedAt
          ? `Completed Date: ${formatDateEnIN(service.completedAt)}\n`
          : '',
        warranty: service.warrantyExpiry
          ? `Warranty until ${formatDateEnIN(service.warrantyExpiry)}`
          : 'No warranty',
        nextServiceDate:
          service.nextServiceInterval === 'none'
            ? 'None'
            : formatDateEnIN(service.nextServiceDate),
        businessContact: businessDoc.phone
          ? `${businessDoc.name} — ${businessDoc.phone}`
          : businessDoc.name,
        reviewLine,
      },
      businessDoc.serviceCardTemplate,
    );

    return {
      url: this.remindersService.buildWhatsAppLink(customer.phone, message),
      message,
    };
  }
}
