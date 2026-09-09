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
}
