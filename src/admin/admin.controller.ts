import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminAuthGuard } from './admin-auth.guard';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.adminService.login(dto);
  }

  @UseGuards(AdminAuthGuard)
  @Get('dashboard')
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @UseGuards(AdminAuthGuard)
  @Get('businesses')
  getBusinesses(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.adminService.getBusinessesList(
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 20,
      search,
    );
  }

  @UseGuards(AdminAuthGuard)
  @Get('feedback')
  getFeedback(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.adminService.getFeedbackList(
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 20,
    );
  }

  @UseGuards(AdminAuthGuard)
  @Get('system-health')
  getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  @UseGuards(AdminAuthGuard)
  @Get('export-csv')
  async exportCsv(@Res() res: any) {
    const csvContent = await this.adminService.exportBusinessesCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=agla_kaam_businesses.csv');
    return res.status(200).send(csvContent);
  }

  @UseGuards(AdminAuthGuard)
  @Get('businesses/:id')
  getBusinessDetail(@Param('id') id: string) {
    return this.adminService.getBusinessDetail(id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('businesses/:id/subscription')
  updateSubscription(
    @Param('id') id: string,
    @Body() body: { subscriptionStatus: 'free' | 'active' | 'expired'; tier?: string; renewalDate?: string },
  ) {
    return this.adminService.updateBusinessSubscription(
      id,
      body.subscriptionStatus,
      body.tier,
      body.renewalDate,
    );
  }

  @UseGuards(AdminAuthGuard)
  @Post('broadcast-push')
  broadcastPush(
    @Body() body: { title: string; body: string; tradeType?: string },
  ) {
    return this.adminService.broadcastPushNotification(
      body.title,
      body.body,
      body.tradeType,
    );
  }
}
