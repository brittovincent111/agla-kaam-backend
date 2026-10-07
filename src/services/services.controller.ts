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
  isTeamMember,
} from '../common/decorators/current-business.decorator';
import { ServicesService } from './services.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesDto } from './dto/list-services.dto';
import { RescheduleServiceDto } from './dto/reschedule-service.dto';
import {
  CompleteServiceDto,
  CorrectCollectionDto,
} from './dto/complete-service.dto';
import { ServiceLocationDto } from './dto/service-location.dto';
import { CallbackDto } from './dto/callback.dto';
import { ChangeWarrantyDto } from './dto/change-warranty.dto';
import { ReassignManyDto } from './dto/reassign-many.dto';

// Ceiling on a customer's service history in one response. Well past what
// any real customer accumulates, and it keeps the endpoint bounded.
const MAX_HISTORY_LIMIT = 200;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly teamMembersService: TeamMembersService,
  ) {}

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

  // The owner's "Team day": one day's booked jobs split by technician.
  // from/to: the local day as two instants (from inclusive, to exclusive).
  @Get('day-board')
  dayBoard(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const start = from
      ? new Date(from)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const end = to ? new Date(to) : new Date(start.getTime() + 86_400_000);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException('Give a valid day.');
    }
    return this.servicesService.dayBoard(
      business.businessId,
      business,
      start,
      end,
    );
  }

  @Post('reassign')
  reassignMany(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: ReassignManyDto,
  ) {
    return this.servicesService.reassignMany(
      business.businessId,
      business,
      dto.serviceIds,
      dto.assignedTechnicianId ?? null,
    );
  }

  // A technician's own days worked, for their Me tab: ?month=2026-09.
  @Get('my-work-log')
  myWorkLog(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('month') month?: string,
  ) {
    if (!isTeamMember(business) || !business.teamMemberId) {
      return { month: month ?? '', daysWorked: 0, jobs: 0, days: [] };
    }
    return this.teamMembersService.workLog(
      business.businessId,
      business.teamMemberId,
      month,
    );
  }

  // A technician's own cash still to hand over, for their Home screen.
  @Get('my-cash')
  myCash(@CurrentBusiness() business: AuthenticatedBusiness) {
    return isTeamMember(business) && business.teamMemberId
      ? this.teamMembersService.memberCash(
          business.businessId,
          business.teamMemberId,
        )
      : { cashInHand: 0, jobs: [], lastSettlement: null };
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
      { book: dto.book, visitSlot: dto.visitSlot },
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
      dto?.completedAt,
      {
        interval: dto?.nextVisitInterval,
        date: dto?.nextVisitDate,
        skip: dto?.skipNextVisit,
      },
      dto?.collectionMethod
        ? { method: dto.collectionMethod, amount: dto.collectionAmount }
        : undefined,
    );
  }

  @Patch(':id/warranty')
  changeWarranty(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: ChangeWarrantyDto,
  ) {
    return this.servicesService.changeWarranty(
      business.businessId,
      id,
      business,
      dto.warrantyPeriod,
      dto.customWarrantyDate,
    );
  }

  @Patch(':id/collection')
  correctCollection(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: CorrectCollectionDto,
  ) {
    return this.servicesService.correctCollection(
      business.businessId,
      id,
      business,
      {
        method: dto.collectionMethod,
        amount: dto.collectionAmount,
      },
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

  // A return visit for a completed job ("it's leaking again").
  @Post(':id/callback')
  callback(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: CallbackDto,
  ) {
    return this.servicesService.createCallback(
      business.businessId,
      id,
      dto,
      business,
    );
  }

  @Get(':id/callbacks')
  async callbacks(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    // Access-checked through the original job.
    await this.servicesService.findOne(business.businessId, id, business);
    return this.servicesService.findCallbacks(business.businessId, id);
  }

  @Patch(':id/cancel')
  cancel(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.servicesService.cancelService(
      business.businessId,
      id,
      business,
    );
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
      throw new BadRequestException(
        'Only JPEG, PNG, and WebP images are allowed',
      );
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
