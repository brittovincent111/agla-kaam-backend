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

@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly servicesService: ServicesService,
    private readonly customersService: CustomersService,
    private readonly businessesService: BusinessesService,
  ) {}

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
    );
    const customer = await this.customersService.findOne(
      business.businessId,
      service.customerId.toString(),
    );
    const businessDoc = await this.businessesService.findById(
      business.businessId,
    );

    const message = this.remindersService.buildWhatsAppMessage(
      businessDoc.name,
      customer.name,
      service.serviceType,
    );
    return {
      url: this.remindersService.buildWhatsAppLink(customer.phone, message),
      message,
    };
  }
}
