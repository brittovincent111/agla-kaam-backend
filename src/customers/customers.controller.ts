import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles('owner')
  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(business.businessId, dto);
  }

  // Open to technicians — filtered to their assigned customers.
  // Paged, searchable list. A separate route from GET /customers on purpose:
  // that one returns a bare array and is still what already-installed app
  // versions call, so its shape must not change under them.
  //
  // Above the global 60/min budget: one screen of scrolling plus a few
  // debounced search terms is easily a dozen calls, and a customer flicking
  // through a long list must not be told "Too Many Requests" for using the
  // app normally. Still bounded — this is a cheap indexed read, and 240 pages
  // a minute is far past any human scroll.
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Get('page')
  findPage(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListCustomersDto,
  ) {
    return this.customersService.findPageForViewer(
      business.businessId,
      business,
      query,
    );
  }

  @Get()
  findAll(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.customersService.findAllForViewer(business.businessId, business);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.customersService.findOneForViewer(business.businessId, id, business);
  }

  @Roles('owner')
  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(business.businessId, id, dto);
  }

  @Roles('owner')
  @Delete(':id')
  remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.customersService.remove(business.businessId, id);
  }
}
