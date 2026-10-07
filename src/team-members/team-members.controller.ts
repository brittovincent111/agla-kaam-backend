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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentBusiness,
  AuthenticatedBusiness,
} from '../common/decorators/current-business.decorator';
import { TeamMembersService } from './team-members.service';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { ResetTeamMemberPasswordDto } from './dto/reset-team-member-password.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('team-members')
export class TeamMembersController {
  constructor(private readonly teamMembersService: TeamMembersService) {}

  @Post()
  create(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Body() dto: CreateTeamMemberDto,
  ) {
    return this.teamMembersService.create(business.businessId, dto);
  }

  // The one route a manager may use here: they assign and dispatch, so they
  // need the team to pick from. Read-only — adding, editing, deactivating,
  // passwords, seats and cash all stay the owner's. A manager is not given
  // other members' device tokens or sign-in provider ids.
  @Roles('owner', 'manager')
  //
  // ?light=1 leaves out each member's completed-job count (serviceCount) and
  // every field a picker does not need. Without it, the full list as before.
  @Get()
  async findAll(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Query('light') light?: string,
  ) {
    const members = await this.teamMembersService.findAllForBusiness(
      business.businessId,
      { light: light === '1' || light === 'true' },
    );
    if (business.role === 'owner') return members;
    return members.map(
      ({ pushToken: _p, googleId: _g, appleId: _a, ...rest }) => rest,
    );
  }

  // Seats used and available, for "3 of 4 seats used". Before ':id' routes.
  @Get('seats')
  seats(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.teamMembersService.seatInfo(business.businessId);
  }

  // Declared before ':id' routes so "cash" is not read as an id.
  @Get('cash')
  cashSummary(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.teamMembersService.cashSummary(business.businessId);
  }

  @Get(':id/cash')
  memberCash(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.teamMembersService.memberCash(business.businessId, id);
  }

  @Post(':id/settle-cash')
  settleCash(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.teamMembersService.settleCash(business.businessId, id);
  }

  // Days worked, from the jobs they completed: ?month=2026-09.
  @Get(':id/work-log')
  workLog(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.teamMembersService.workLog(business.businessId, id, month);
  }

  // Their open jobs and customers to another technician, or to nobody.
  @Post(':id/hand-over')
  handOver(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() body: { toMemberId?: string | null },
  ) {
    return this.teamMembersService.handOver(
      business.businessId,
      id,
      body?.toMemberId ?? null,
    );
  }

  @Get(':id/tasks')
  getMemberTasks(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.teamMembersService.getMemberTasks(business.businessId, id);
  }

  @Patch(':id')
  update(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamMembersService.update(business.businessId, id, dto);
  }

  @Patch(':id/activate')
  activate(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.teamMembersService.setActive(business.businessId, id, true);
  }

  @Patch(':id/deactivate')
  deactivate(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.teamMembersService.setActive(business.businessId, id, false);
  }

  @Patch(':id/password')
  resetPassword(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
    @Body() dto: ResetTeamMemberPasswordDto,
  ) {
    return this.teamMembersService.resetPassword(
      business.businessId,
      id,
      dto.password,
    );
  }

  @Delete(':id')
  remove(
    @CurrentBusiness() business: AuthenticatedBusiness,
    @Param('id') id: string,
  ) {
    return this.teamMembersService.remove(business.businessId, id);
  }
}
