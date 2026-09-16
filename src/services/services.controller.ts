import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import { RescheduleServiceDto } from './dto/reschedule-service.dto';
import { CompleteServiceDto } from './dto/complete-service.dto';
import { ServiceLocationDto } from './dto/service-location.dto';

// Ceiling on a customer's service history in one response. Well past what
// any real customer accumulates, and it keeps the endpoint bounded.
const MAX_HISTORY_LIMIT = 200;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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

  // MUST stay above @Get(':id') — Nest matches routes in declaration order,
  // and ':id' would otherwise swallow "/page" and try to look up a service
  // whose id is the literal string "page".
  // Paged, filtered and searched on the server. A separate route from GET
  // /services on purpose: that one returns a bare array and is still what
  // already-installed app versions call, so its shape must not change.
  //
  // Above the global 60/min budget for the same reason the customer page is:
  // scrolling a long list plus a few debounced search terms is easily a dozen
  // calls, and using the app normally must not return "Too Many Requests".
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Get('page')
  findPage(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListServicesDto,
  ) {
    return this.servicesService.findPageForBusiness(
      business.businessId,
      business,
      query,
    );
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
      { serviceDate: dto.serviceDate, nextServiceDate: dto.nextServiceDate },
      business,
      dto.assignedTechnicianId,
    );
  }

  @Patch(':id/complete')
  complete(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: CompleteServiceDto,
  ) {
    return this.servicesService.completeService(
      business.businessId,
      id,
      business,
      dto?.location,
    );
  }

  @Patch(':id/location')
  setLocation(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: ServiceLocationDto,
  ) {
    return this.servicesService.setServiceLocation(
      business.businessId,
      id,
      business,
      dto,
    );
  }

  @Patch(':id/revisit')
  revisit(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body('revisitDate') revisitDate: string,
  ) {
    return this.servicesService.revisitService(
      business.businessId,
      id,
      revisitDate,
      business,
    );
  }

  @Patch(':id/cancel')
  cancel(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.servicesService.cancelService(business.businessId, id, business);
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    // Optional, and only meaningful alongside customerId. Capped so a typo
    // in the query string cannot ask for an unbounded history.
    @Query('limit') limit?: string,
  ) {
    if (customerId) {
      const parsed = Number.parseInt(limit ?? '', 10);
      return this.servicesService.findHistoryForCustomer(
        business.businessId,
        customerId,
        business,
        Number.isFinite(parsed) && parsed > 0
          ? Math.min(parsed, MAX_HISTORY_LIMIT)
          : undefined,
      );
    }
    return this.servicesService.findAllForBusiness(
      business.businessId,
      business,
      status,
    );
  }

  @Post(':id/photos/:kind')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async uploadPhoto(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Image file is required');
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    if (kind !== 'before' && kind !== 'after') {
      throw new BadRequestException('Photo kind must be before or after');
    }
    await this.servicesService.uploadPhoto(
      business.businessId,
      id,
      kind,
      file.buffer,
      file.mimetype,
      business,
    );
    return { success: true };
  }

  @Get(':id/photos/:kind')
  async getPhoto(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() res?: Response,
  ) {
    if (kind !== 'before' && kind !== 'after') {
      throw new BadRequestException('Photo kind must be before or after');
    }
    const photo = await this.servicesService.getPhoto(
      business.businessId,
      id,
      kind,
      business,
    );
    if (!photo) throw new NotFoundException('Photo not found');
    res?.setHeader('Content-Type', photo.contentType);
    res?.setHeader('Cache-Control', 'private, max-age=86400');
    return res?.send(photo.data);
  }

  @Delete(':id/photos/:kind')
  async deletePhoto(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Param('kind') kind: string,
  ) {
    if (kind !== 'before' && kind !== 'after') {
      throw new BadRequestException('Photo kind must be before or after');
    }
    await this.servicesService.deletePhoto(
      business.businessId,
      id,
      kind,
      business,
    );
    return { success: true };
  }

  @Post(':id/signature')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async uploadSignature(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Signature file is required');
    await this.servicesService.uploadSignature(
      business.businessId,
      id,
      file.buffer,
      file.mimetype || 'image/png',
      business,
    );
    return { success: true };
  }

  @Get(':id/signature')
  async getSignature(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Res() res?: Response,
  ) {
    const sig = await this.servicesService.getSignature(
      business.businessId,
      id,
      business,
    );
    if (!sig) throw new NotFoundException('Signature not found');
    res?.setHeader('Content-Type', sig.contentType);
    res?.setHeader('Cache-Control', 'private, max-age=86400');
    return res?.send(sig.data);
  }
}

