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
import { QuickNotesService } from './quick-notes.service';
import { CreateQuickNoteDto } from './dto/create-quick-note.dto';
import { UpdateQuickNoteDto } from './dto/update-quick-note.dto';
import { ListQuickNotesDto } from './dto/list-quick-notes.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthenticatedBusiness,
  CurrentBusiness,
} from '../common/decorators/current-business.decorator';

@Controller('quick-notes')
@UseGuards(JwtAuthGuard)
export class QuickNotesController {
  constructor(private readonly quickNotesService: QuickNotesService) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateQuickNoteDto,
  ) {
    return this.quickNotesService.create(
      business.businessId,
      business.teamMemberId || null,
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ListQuickNotesDto,
  ) {
    return this.quickNotesService.findAll(business.businessId, query);
  }

  @Get(':id')
  findOne(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.quickNotesService.findOne(business.businessId, id);
  }

  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateQuickNoteDto,
  ) {
    return this.quickNotesService.update(business.businessId, id, dto);
  }

  @Delete(':id')
  delete(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.quickNotesService.delete(business.businessId, id);
  }
}
