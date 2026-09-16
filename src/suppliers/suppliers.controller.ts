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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersDto } from './dto/list-suppliers.dto';

// Owner-only throughout: the supplier book is purchasing, which technicians
// have no part in — the same reason they never see the purchase list.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Roles('owner')
  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliersService.create(business.businessId, dto);
  }

  @Roles('owner')
  @Get()
  findPage(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListSuppliersDto,
  ) {
    return this.suppliersService.findPage(business.businessId, query);
  }

  @Roles('owner')
  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.suppliersService.findOne(business.businessId, id);
  }

  @Roles('owner')
  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(business.businessId, id, dto);
  }

  @Roles('owner')
  @Delete(':id')
  async remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    await this.suppliersService.remove(business.businessId, id);
    return { success: true };
  }
}
