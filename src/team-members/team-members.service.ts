import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeamMember, TeamMemberDocument } from './schemas/team-member.schema';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TEAM_SEAT_LIMIT, tierAllowsTeam } from '../common/constants/subscription-options';

@Injectable()
export class TeamMembersService {
  constructor(
    @InjectModel(TeamMember.name) private readonly teamMemberModel: Model<TeamMemberDocument>,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  findByPhone(phone: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel.findOne({ phone }).exec();
  }

  findAllForBusiness(businessId: string): Promise<TeamMemberDocument[]> {
    return this.teamMemberModel.find({ businessId }).sort({ createdAt: 1 }).exec();
  }

  async create(businessId: string, dto: CreateTeamMemberDto): Promise<TeamMemberDocument> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    const teamEnabled = await this.subscriptionsService.hasActiveTeamAddon(businessId);
    if (!tierAllowsTeam(tier) || !teamEnabled) {
      throw new ForbiddenException(
        'The Team add-on is not active on your plan. Upgrade to Combo + Team (₹1299/year) to add technicians.',
      );
    }

    const activeCount = await this.teamMemberModel.countDocuments({ businessId, active: true }).exec();
    if (activeCount >= TEAM_SEAT_LIMIT) {
      throw new ForbiddenException(`Your Team add-on is limited to ${TEAM_SEAT_LIMIT} members.`);
    }

    const existingOwner = await this.businessesService.findByPhone(dto.phone);
    if (existingOwner) {
      throw new ConflictException('This phone number is already registered as a business owner.');
    }
    const existingMember = await this.findByPhone(dto.phone);
    if (existingMember) {
      throw new ConflictException('This phone number is already a team member on another account.');
    }

    return this.teamMemberModel.create({
      businessId,
      name: dto.name,
      phone: dto.phone,
      active: true,
    });
  }

  async setActive(businessId: string, teamMemberId: string, active: boolean): Promise<TeamMemberDocument> {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Team member not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!member || member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }
    member.active = active;
    return member.save();
  }
}
