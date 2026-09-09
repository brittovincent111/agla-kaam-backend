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
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { ListInventoryDto } from './dto/list-inventory.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthenticatedBusiness,
  CurrentBusiness,
} from '../common/decorators/current-business.decorator';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateInventoryItemDto,
  ) {
    return this.inventoryService.create(business.businessId, dto);
  }

  // Declared ahead of GET :id, or 'page' is read as an item id and 404s.
  //
  // A separate route from GET (the unpaged list below) on purpose: that one
  // returns a bare array and is still what already-installed app versions
  // call, so its shape must not change under them.
  //
  // Above the global 60/min budget — scrolling a long catalogue plus a few
  // debounced search terms is easily a dozen calls, and using the app
  // normally must not return "Too Many Requests".
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Get('page')
  findPage(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListInventoryDto,
  ) {
    return this.inventoryService.findPageForBusiness(business.businessId, query);
  }

  @Get()
  findAll(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.inventoryService.findAll(business.businessId);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.inventoryService.findOne(business.businessId, id);
  }

  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventoryService.update(business.businessId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.inventoryService.remove(business.businessId, id);
  }
}
