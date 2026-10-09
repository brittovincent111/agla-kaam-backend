import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { HelpVideosService } from './help-videos.service';
import { CreateHelpVideoDto } from './dto/create-help-video.dto';
import { UpdateHelpVideoDto } from './dto/update-help-video.dto';
import { ReorderHelpVideosDto } from './dto/reorder-help-videos.dto';

@Controller('admin/help-videos')
@UseGuards(AdminAuthGuard)
export class AdminHelpVideosController {
  constructor(private readonly helpVideos: HelpVideosService) {}

  @Get()
  list() {
    return this.helpVideos.listAll();
  }

  @Post()
  create(@Body() dto: CreateHelpVideoDto) {
    return this.helpVideos.create(dto);
  }

  // Declared before ':id' so 'reorder' is never read as an id.
  @Patch('reorder')
  reorder(@Body() dto: ReorderHelpVideosDto) {
    return this.helpVideos.reorder(dto.ids);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateHelpVideoDto) {
    return this.helpVideos.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.helpVideos.remove(id);
  }
}
