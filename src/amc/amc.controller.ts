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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { AmcService } from './amc.service';
import { CreateAmcDto } from './dto/create-amc.dto';
import { UpdateAmcDto } from './dto/update-amc.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('amc')
export class AmcController {
  constructor(private readonly amcService: AmcService) {}

  @Post()
  @Roles('owner')
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateAmcDto,
  ) {
    return this.amcService.create(business.businessId, dto);
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.amcService.findAllForBusiness(business.businessId, {
      status,
      customerId,
    });
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.amcService.findOnePopulated(business.businessId, id);
  }

  @Patch(':id/log-visit')
  logVisit(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.amcService.logVisit(business.businessId, id);
  }

  @Patch(':id/skip-visit')
  skipVisit(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.amcService.skipVisit(business.businessId, id);
  }

  @Patch(':id')
  @Roles('owner')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateAmcDto,
  ) {
    return this.amcService.update(business.businessId, id, dto);
  }

  @Delete(':id')
  @Roles('owner')
  remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.amcService.remove(business.businessId, id);
  }
}
