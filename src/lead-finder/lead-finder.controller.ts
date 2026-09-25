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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { LeadFinderService } from './lead-finder.service';
import { LeadSearchJobService } from './lead-search-job.service';
import { LeadScheduleService } from './lead-schedule.service';
import { LeadProviderRegistry } from './providers/provider-registry.service';
import { StartLeadSearchDto } from './dto/start-lead-search.dto';
import { QueryLeadsDto } from './dto/query-leads.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { CreateLeadScheduleDto } from './dto/create-lead-schedule.dto';

@Controller(['admin/lead-finder', 'admin'])
@UseGuards(AdminAuthGuard)
export class LeadFinderController {
  constructor(
    private readonly leadFinderService: LeadFinderService,
    private readonly searchJobService: LeadSearchJobService,
    private readonly scheduleService: LeadScheduleService,
    private readonly providerRegistry: LeadProviderRegistry,
  ) {}

  // 1. Search Jobs
  @Post(['jobs/search', 'leads/search'])
  @HttpCode(202)
  async startSearch(@Body() dto: StartLeadSearchDto) {
    const job = await this.searchJobService.createAndStartJob(dto);
    return {
      message: 'Lead discovery search job queued successfully',
      jobId: job._id.toString(),
      job,
    };
  }

  @Get(['jobs', 'lead-search-jobs'])
  async listJobs(@Query('limit') limit = '20') {
    return this.searchJobService.listJobs(parseInt(limit, 10) || 20);
  }

  @Get(['jobs/:id', 'lead-search-jobs/:id'])
  async getJob(@Param('id') id: string) {
    return this.searchJobService.getJob(id);
  }

  @Post(['jobs/:id/cancel', 'lead-search-jobs/:id/cancel'])
  async cancelJob(@Param('id') id: string) {
    return this.searchJobService.cancelJob(id);
  }

  // 2. Lead CRM
  @Get('leads')
  async getLeads(@Query() query: QueryLeadsDto) {
    return this.leadFinderService.queryLeads(query);
  }

  @Get(['export-csv', 'leads/export'])
  async exportLeadsCsv(@Query() query: QueryLeadsDto, @Res() res: Response) {
    const csv = await this.leadFinderService.exportCsv(query);
    const filename = `agla_kaam_leads_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  }

  @Get('leads/:id')
  async getLead(@Param('id') id: string) {
    return this.leadFinderService.getLeadById(id);
  }

  @Patch('leads/:id')
  async updateLead(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadFinderService.updateLead(id, dto);
  }

  @Post('leads/:id/activity')
  async logActivity(
    @Param('id') id: string,
    @Body() dto: CreateLeadActivityDto,
  ) {
    return this.leadFinderService.logActivity(id, dto);
  }

  // 3. Schedulers & On-Demand Manual Triggers (No cron needed!)
  @Get(['schedules', 'lead-schedules'])
  async listSchedules() {
    return this.scheduleService.listSchedules();
  }

  @Post(['schedules', 'lead-schedules'])
  async createSchedule(@Body() dto: CreateLeadScheduleDto) {
    return this.scheduleService.createSchedule(dto);
  }

  @Patch(['schedules/:id', 'lead-schedules/:id'])
  async updateSchedule(
    @Param('id') id: string,
    @Body() updates: any,
  ) {
    return this.scheduleService.updateSchedule(id, updates);
  }

  @Delete(['schedules/:id', 'lead-schedules/:id'])
  async deleteSchedule(@Param('id') id: string) {
    return this.scheduleService.deleteSchedule(id);
  }

  @Post(['schedules/:id/run-now', 'lead-schedules/:id/run-now'])
  async runScheduleNow(@Param('id') id: string) {
    return this.scheduleService.triggerScheduleRun(id);
  }

  @Post(['schedules/run-all-due', 'lead-schedules/run-all-due'])
  async runAllDueSchedules() {
    return this.scheduleService.triggerDueSchedules();
  }

  // 4. Analytics & Telemetry
  @Get(['analytics', 'lead-analytics'])
  async getAnalytics() {
    return this.leadFinderService.getAnalytics();
  }

  @Get(['providers', 'lead-providers'])
  async listProviders() {
    return this.providerRegistry.listProviders();
  }
}
