import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { EmailCampaignService } from './services/email-campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import {
  QueryCampaignRecipientsDto,
  QueryCampaignsDto,
} from './dto/query-campaigns.dto';
import { SendTestEmailDto } from './dto/send-test-email.dto';

@Controller(['admin/campaigns', 'admin/email-campaigns'])
@UseGuards(AdminAuthGuard)
export class EmailCampaignController {
  constructor(private readonly campaignService: EmailCampaignService) {}

  @Post()
  @HttpCode(201)
  async createCampaign(@Body() dto: CreateCampaignDto, @Req() req: any) {
    const adminUser = req.admin?.email || req.admin?.username || 'Admin';
    return this.campaignService.createCampaign(dto, adminUser);
  }

  @Get()
  async listCampaigns(@Query() query: QueryCampaignsDto) {
    return this.campaignService.listCampaigns(query);
  }

  @Get('setup')
  async setup() {
    return this.campaignService.setup();
  }

  @Get(':id')
  async getCampaign(@Param('id') id: string) {
    return this.campaignService.getCampaignById(id);
  }

  @Patch(':id')
  async updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignService.updateCampaign(id, dto);
  }

  @Delete(':id')
  async deleteCampaign(@Param('id') id: string) {
    return this.campaignService.deleteCampaign(id);
  }

  @Post(':id/recipients/count')
  @HttpCode(200)
  async calculateRecipients(@Param('id') id: string) {
    return this.campaignService.calculateRecipientCount(id);
  }

  @Post(':id/start')
  @HttpCode(202)
  async startCampaign(@Param('id') id: string) {
    return this.campaignService.startCampaign(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  async pauseCampaign(@Param('id') id: string) {
    return this.campaignService.pauseCampaign(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  async resumeCampaign(@Param('id') id: string) {
    return this.campaignService.resumeCampaign(id);
  }

  @Post(':id/test-send')
  @HttpCode(200)
  async sendTestEmail(@Param('id') id: string, @Body() dto: SendTestEmailDto) {
    return this.campaignService.sendTestEmail(id, dto);
  }

  @Get(':id/follow-ups')
  async followUps(@Param('id') id: string) {
    return this.campaignService.followUpStats(id);
  }

  @Post(':id/follow-ups/stop')
  @HttpCode(200)
  async stopFollowUps(@Param('id') id: string) {
    return this.campaignService.stopFollowUps(id);
  }

  @Get(':id/recipients')
  async getRecipients(
    @Param('id') id: string,
    @Query() query: QueryCampaignRecipientsDto,
  ) {
    return this.campaignService.getCampaignRecipients(id, query);
  }
}
