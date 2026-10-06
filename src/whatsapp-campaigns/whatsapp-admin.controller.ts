import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { WhatsappCampaignService } from './services/whatsapp-campaign.service';
import {
  CreateWhatsappCampaignDto,
  UpdateWhatsappCampaignDto,
  WhatsappReplyDto,
  WhatsappTestSendDto,
} from './dto/whatsapp-campaign.dto';

/** Admin panel: WhatsApp campaigns, templates and the replies inbox. */
@Controller('admin/whatsapp')
@UseGuards(AdminAuthGuard)
export class WhatsappAdminController {
  constructor(private readonly service: WhatsappCampaignService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Get('templates')
  templates() {
    return this.service.templates();
  }

  @Get('inbox')
  inbox() {
    return this.service.inbox();
  }

  @Get('inbox/:phone')
  thread(@Param('phone') phone: string) {
    return this.service.thread(phone);
  }

  @Post('inbox/reply')
  reply(@Body() dto: WhatsappReplyDto, @Req() req: any) {
    return this.service.reply(dto.phone, dto.text, req.admin?.email || req.admin?.username);
  }

  @Get('campaigns')
  list() {
    return this.service.list();
  }

  @Post('campaigns')
  create(@Body() dto: CreateWhatsappCampaignDto, @Req() req: any) {
    return this.service.create(dto, req.admin?.email || req.admin?.username);
  }

  @Get('campaigns/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch('campaigns/:id')
  update(@Param('id') id: string, @Body() dto: UpdateWhatsappCampaignDto) {
    return this.service.update(id, dto);
  }

  @Delete('campaigns/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get('campaigns/:id/preview')
  preview(@Param('id') id: string) {
    return this.service.preview(id);
  }

  @Post('campaigns/:id/test-send')
  testSend(@Param('id') id: string, @Body() dto: WhatsappTestSendDto) {
    return this.service.testSend(id, dto.phone);
  }

  @Post('campaigns/:id/start')
  start(@Param('id') id: string) {
    return this.service.start(id);
  }

  @Post('campaigns/:id/pause')
  pause(@Param('id') id: string) {
    return this.service.pause(id);
  }

  @Post('campaigns/:id/resume')
  resume(@Param('id') id: string) {
    return this.service.resume(id);
  }

  @Get('campaigns/:id/recipients')
  recipients(@Param('id') id: string, @Query('status') status?: string, @Query('page') page?: string) {
    return this.service.recipients(id, status, Number(page) || 1);
  }
}
