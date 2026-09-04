import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { RescheduleServiceDto } from './dto/reschedule-service.dto';

@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateServiceDto,
  ) {
    return this.servicesService.create(business.businessId, dto, business);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.servicesService.findOne(business.businessId, id, business);
  }

  @Patch(':id/reschedule')
  reschedule(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: RescheduleServiceDto,
  ) {
    return this.servicesService.reschedule(
      business.businessId,
      id,
      dto.nextServiceDate,
      business,
      dto.assignedTechnicianId,
    );
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('customerId') customerId?: string,
  ) {
    if (customerId) {
      return this.servicesService.findHistoryForCustomer(
        business.businessId,
        customerId,
        business,
      );
    }
    return this.servicesService.findAllForBusiness(business.businessId, business);
  }
}
