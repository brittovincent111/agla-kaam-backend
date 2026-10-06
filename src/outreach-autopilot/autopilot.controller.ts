import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { AutopilotService } from './autopilot.service';
import { AutopilotRegionDto, UpdateAutopilotSettingsDto } from './dto/autopilot.dto';
import { istDayKey } from './autopilot-defaults';

function dayKeyOf(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestException('Day as YYYY-MM-DD');
  return raw;
}

@Controller('admin/autopilot')
@UseGuards(AdminAuthGuard)
export class AutopilotController {
  constructor(private readonly autopilot: AutopilotService) {}

  @Get()
  overview() {
    return this.autopilot.overview();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateAutopilotSettingsDto) {
    return this.autopilot.updateSettings(dto as any);
  }

  @Post('regions')
  createRegion(@Body() dto: AutopilotRegionDto) {
    if (!dto.name || !dto.places?.length) throw new BadRequestException('A region needs a name and at least one city.');
    return this.autopilot.createRegion(dto as any);
  }

  @Patch('regions/:id')
  updateRegion(@Param('id') id: string, @Body() dto: AutopilotRegionDto) {
    return this.autopilot.updateRegion(id, dto as any);
  }

  @Delete('regions/:id')
  removeRegion(@Param('id') id: string) {
    return this.autopilot.removeRegion(id);
  }

  // Run a step now instead of waiting for its time.
  @Post('run/searches')
  @HttpCode(202)
  runSearches() {
    return this.autopilot.runSearches(istDayKey(), true);
  }

  @Post('run/prepare')
  @HttpCode(202)
  prepare() {
    setImmediate(() => this.autopilot.prepareLeads());
    return { started: true };
  }

  @Post('run/plan')
  @HttpCode(200)
  plan() {
    return this.autopilot.buildPlan(istDayKey(), true);
  }

  @Post('run/report')
  @HttpCode(200)
  report() {
    return this.autopilot.report(istDayKey());
  }

  @Post('days/:dayKey/approve')
  @HttpCode(200)
  approve(@Param('dayKey') dayKey: string, @Req() req: any) {
    return this.autopilot.approve(dayKeyOf(dayKey), req.admin?.email || 'admin');
  }

  @Post('days/:dayKey/skip')
  @HttpCode(200)
  skip(@Param('dayKey') dayKey: string) {
    return this.autopilot.skip(dayKeyOf(dayKey));
  }
}
