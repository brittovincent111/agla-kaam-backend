import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { ReportsService } from './reports.service';
import { REPORT_RANGES, ReportRange } from './report-range';

class ReportQueryDto {
  @IsOptional()
  @IsIn(REPORT_RANGES)
  range?: ReportRange;
}

// Money figures: the owner's, same as invoicing.
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  summary(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.summary(
      business.businessId,
      query.range ?? 'this_month',
    );
  }
}
