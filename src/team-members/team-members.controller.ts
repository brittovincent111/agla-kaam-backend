import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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

  @Get()
  findAll(@CurrentBusiness() business: AuthenticatedBusiness) {
    return this.teamMembersService.findAllForBusiness(business.businessId);
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
}
