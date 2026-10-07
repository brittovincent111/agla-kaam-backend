import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
  isTechnician,
} from '../common/decorators/current-business.decorator';
import { RemindersService, formatMessageDate } from './reminders.service';
import { ServicesService } from '../services/services.service';
import { CustomersService } from '../customers/customers.service';
import { BusinessesService } from '../businesses/businesses.service';
import { ServicePresetsService } from '../service-presets/service-presets.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { InvoiceShareService } from '../invoicing/invoice-share.service';
import { ServiceShareService } from '../services/service-share.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { formatCurrency } from '../common/pdf/document-render';
import { messageLanguage } from '../common/utils/message-template';

class ReminderSentDto {
  @IsOptional()
  @IsMongoId()
  serviceId?: string;

  @IsOptional()
  @IsMongoId()
  invoiceId?: string;

  // 'record': the completed job's service record went out (checklist tick),
  // not a "service due" reminder.
  @IsOptional()
  @IsIn(['reminder', 'record'])
  kind?: 'reminder' | 'record';
}

// How long a short link lasts: the same as the signed link it points to
// (invoice links 60 days, service records a year).
const INVOICE_LINK_DAYS = 60;
const RECORD_LINK_DAYS = 365;

// The address this request came in on, for building a link the customer can
// open when PUBLIC_API_URL is not configured. Honours the proxy's headers.
function requestBase(req: Request): string {
  const proto =
    (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  return host ? `${proto}://${host}` : '';
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
    private readonly invoiceShareService: InvoiceShareService,
    private readonly serviceShareService: ServiceShareService,
    private readonly teamMembersService: TeamMembersService,
    private readonly shortLinksService: ShortLinksService,
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

  // "Service due" for one visit.
  @Get('whatsapp-link/:serviceId')
  async whatsappLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('serviceId') serviceId: string,
  ) {
    const { message, phone } = await this.serviceDue(business, serviceId);
    return {
      url: this.remindersService.buildWhatsAppLink(phone, message),
      message,
    };
  }

  // Chasing an unpaid invoice: the amount still owed, how to pay, and a link
  // to the invoice itself — so the customer can act on it from the chat.
  @Get('payment-link/:invoiceId')
  async paymentLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('invoiceId') invoiceId: string,
    @Req() req: Request,
  ) {
    const invoice = await this.invoicingService.findOne(
      business.businessId,
      invoiceId,
    );
    const [customer, businessDoc] = await Promise.all([
      this.customersService.findOne(
        business.businessId,
        invoice.customerId.toString(),
      ),
      this.businessesService.findById(business.businessId),
    ]);

    // The UPI ID goes in only when the business prints it on invoices — the
    // same switches the PDF honours.
    const upiShown =
      businessDoc.showPaymentDetailsOnInvoice !== false &&
      businessDoc.invoiceShowUpiInfo !== false;
    const invoiceUrl =
      invoice.status !== 'draft' && invoice.status !== 'cancelled'
        ? await this.shortLinksService.shorten(
            this.invoiceShareService.url(
              this.invoiceShareService.createToken(
                business.businessId,
                invoiceId,
              ),
              requestBase(req),
            ),
            INVOICE_LINK_DAYS,
            requestBase(req),
          )
        : undefined;

    const message = this.remindersService.buildPaymentReminderMessage({
      customerName: customer.name,
      businessName: businessDoc.name,
      invoiceNumber: invoice.invoiceNumber,
      // The amount still owed, not the invoice total — chasing the full
      // amount on a part-paid invoice annoys a customer who paid half.
      balanceDue: formatCurrency(
        invoice.balanceDue,
        invoice.currency || businessDoc.currency || 'INR',
      ),
      dueDate: invoice.dueDate,
      language: businessDoc.language,
      template: businessDoc.paymentReminderTemplate,
      upiId: upiShown
        ? businessDoc.paymentUpiId?.trim() || undefined
        : undefined,
      invoiceUrl,
    });

    return {
      url: this.remindersService.buildWhatsAppLink(customer.phone, message),
      message,
      balanceDue: invoice.balanceDue,
    };
  }

  // The service-card share: the record of work done for a completed visit,
  // or the same "service due" nudge as the lists for one not done yet.
  @Get('service-card-link/:serviceId')
  async serviceCardLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('serviceId') serviceId: string,
    @Req() req: Request,
  ) {
    const service = await this.servicesService.findOne(
      business.businessId,
      serviceId,
      business,
    );
    if (service.status !== 'completed') {
      const { message, phone } = await this.serviceDue(business, serviceId);
      return {
        url: this.remindersService.buildWhatsAppLink(phone, message),
        message,
      };
    }

    const [customer, businessDoc] = await Promise.all([
      this.customersService.findOne(
        business.businessId,
        service.customerId.toString(),
      ),
      this.businessesService.findById(business.businessId),
    ]);
    const lang = messageLanguage(businessDoc.language);
    const hi = lang === 'hi';
    const date = (d: Date) => formatMessageDate(d, lang);
    const reviewUrl = businessDoc.googleReviewUrl?.trim();
    const reviewLine = reviewUrl
      ? hi
        ? `\n\n⭐ हमारी सर्विस पसंद आई? कृपया Google पर रिव्यू दें:\n${reviewUrl}`
        : `\n\n⭐ Enjoyed our service? Please leave us a Google review:\n${reviewUrl}`
      : '';

    const message = this.remindersService.buildServiceCardMessage(
      {
        customerName: customer.name,
        businessName: businessDoc.name,
        serviceType: service.serviceType,
        status: hi ? 'पूरी हुई' : 'Completed',
        serviceDate: date(service.serviceDate),
        // Carries its own newline so the line vanishes when there is none.
        completedLine: service.completedAt
          ? `${hi ? 'पूरी होने की तारीख' : 'Completed Date'}: ${date(service.completedAt)}\n`
          : '',
        warranty: service.warrantyExpiry
          ? hi
            ? `वारंटी ${date(service.warrantyExpiry)} तक`
            : `Warranty until ${date(service.warrantyExpiry)}`
          : hi
            ? 'कोई वारंटी नहीं'
            : 'No warranty',
        nextServiceDate:
          service.nextServiceInterval === 'none'
            ? hi
              ? 'कोई नहीं'
              : 'None'
            : date(service.nextServiceDate),
        businessContact: businessDoc.phone
          ? `${businessDoc.name} — ${businessDoc.phone}`
          : businessDoc.name,
        reviewLine,
        invoiceLine: await this.invoiceLineFor(
          business.businessId,
          serviceId,
          businessDoc,
          hi,
          req,
        ),
        recordLine: `\n\n${hi ? 'आपका सर्विस रिकॉर्ड (फ़ोटो, वारंटी, अगली बुकिंग)' : 'Your service record (photos, warranty, book again)'}:\n${await this.shortLinksService.shorten(
          this.serviceShareService.url(
            this.serviceShareService.createToken(business.businessId, serviceId),
            requestBase(req),
          ),
          RECORD_LINK_DAYS,
          requestBase(req),
        )}`,
      },
      businessDoc.serviceCardTemplate,
      businessDoc.language,
    );

    return {
      url: this.remindersService.buildWhatsAppLink(customer.phone, message),
      message,
    };
  }

  // Job dispatch to a technician — the service's assigned one, or the member
  // named in ?memberId (the Team member screen dispatches from their list).
  @Get('dispatch-link/:serviceId')
  async dispatchLink(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('serviceId') serviceId: string,
    @Query('memberId') memberId?: string,
  ) {
    const service = await this.servicesService.findOne(
      business.businessId,
      serviceId,
      business,
    );
    const assigned = service.assignedTechnicianId as unknown as
      { _id?: unknown } | string | undefined;
    const technicianId =
      memberId ||
      (assigned && typeof assigned === 'object'
        ? String(assigned._id)
        : assigned
          ? String(assigned)
          : '');
    const technician = technicianId
      ? await this.teamMembersService.findOwned(
          business.businessId,
          technicianId,
        )
      : null;
    if (!technician) {
      throw new BadRequestException('Assign a technician to this job first.');
    }
    if (!technician.phone) {
      throw new BadRequestException(
        `Add a phone number for ${technician.name} in Team to dispatch jobs on WhatsApp.`,
      );
    }

    const [customer, businessDoc] = await Promise.all([
      this.customersService.findOne(
        business.businessId,
        service.customerId.toString(),
      ),
      this.businessesService.findById(business.businessId),
    ]);
    // Sending a technician there means the visit is going ahead.
    await this.servicesService.markBooked(
      business.businessId,
      service._id.toString(),
    );
    const message = this.remindersService.buildDispatchMessage({
      businessName: businessDoc.name,
      language: businessDoc.language,
      technicianName: technician.name,
      customer: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        // This visit's own pin first, then the customer's saved one.
        location: service.location ?? customer.defaultLocation ?? null,
      },
      serviceType: service.serviceType,
      // A visit not done yet is due on its own date; a done one's next visit
      // is the job being dispatched.
      dueDate:
        service.status === 'pending'
          ? service.serviceDate
          : service.nextServiceDate,
      visitSlot: service.status === 'pending' ? service.visitSlot : undefined,
      notes: service.notes,
    });
    return {
      url: this.remindersService.buildWhatsAppLink(technician.phone, message),
      message,
      phone: technician.phone,
      technicianName: technician.name,
    };
  }

  // Called when the user taps "Open WhatsApp" on a prepared reminder. It
  // records that a reminder went out, not that it was delivered — WhatsApp
  // does not tell the app — which is enough to show "Reminded 3 days ago"
  // and to switch the next one to the follow-up wording.
  @Post('sent')
  async sent(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: ReminderSentDto,
  ) {
    if (dto.serviceId) {
      if (dto.kind === 'record') {
        await this.servicesService.markRecordShared(
          business.businessId,
          dto.serviceId,
          business,
        );
      } else {
        await this.servicesService.markReminded(
          business.businessId,
          dto.serviceId,
          business,
        );
      }
    }
    // Invoices are the owner's and manager's; a technician cannot open one,
    // so cannot mark one either.
    if (dto.invoiceId && !isTechnician(business)) {
      await this.invoicingService.markReminded(
        business.businessId,
        dto.invoiceId,
      );
    }
    return { ok: true };
  }

  // The bill for this job, for the same message as its record: what is owed
  // and the pay link, or a thank-you once paid. Drafts are left out — the
  // pay page does not open for an invoice that has not been issued.
  private async invoiceLineFor(
    businessId: string,
    serviceId: string,
    businessDoc: { currency?: string },
    hi: boolean,
    req: Request,
  ): Promise<string> {
    const invoice = await this.invoicingService
      .findLatestForService(businessId, serviceId)
      .catch(() => null);
    if (!invoice || invoice.status === 'draft') return '';
    const money = (n: number) =>
      formatCurrency(n, invoice.currency || businessDoc.currency || 'INR');
    if ((invoice.balanceDue ?? 0) <= 0) {
      return hi
        ? `\n\nभुगतान मिल गया: ${money(invoice.total)} — धन्यवाद!`
        : `\n\nPaid: ${money(invoice.total)} — thank you!`;
    }
    const url = await this.shortLinksService.shorten(
      this.invoiceShareService.url(
        this.invoiceShareService.createToken(businessId, String(invoice._id)),
        requestBase(req),
      ),
      INVOICE_LINK_DAYS,
      requestBase(req),
    );
    return hi
      ? `\n\nबकाया राशि: ${money(invoice.balanceDue)} — ऑनलाइन भुगतान करें: ${url}`
      : `\n\nAmount due: ${money(invoice.balanceDue)} — pay online: ${url}`;
  }

  private async serviceDue(business: AuthenticatedBusiness, serviceId: string) {
    const service = await this.servicesService.findOne(
      business.businessId,
      serviceId,
      business,
    );
    const [customer, businessDoc, preset] = await Promise.all([
      this.customersService.findOne(
        business.businessId,
        service.customerId.toString(),
      ),
      this.businessesService.findById(business.businessId),
      this.servicePresetsService.findByName(
        business.businessId,
        service.serviceType,
      ),
    ]);
    const message = this.remindersService.buildServiceDueMessage({
      service,
      customerName: customer.name,
      business: businessDoc,
      presetTemplate: preset?.messageTemplate,
    });
    return { message, phone: customer.phone };
  }
}
