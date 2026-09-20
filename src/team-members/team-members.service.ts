import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { TeamMember, TeamMemberDocument } from './schemas/team-member.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { BusinessesService } from '../businesses/businesses.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  FREE_TIER_TEAM_LIMIT,
  TEAM_SEAT_LIMIT,
  tierAllowsTeam,
} from '../common/constants/subscription-options';
import { idFilter, idsFilter } from '../common/utils/id-match';

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class TeamMembersService {
  constructor(
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly businessesService: BusinessesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  findByEmail(email: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel.findOne({ email: email.toLowerCase() }).exec();
  }

  // passwordHash has select:false on the schema — only AuthService's login
  // check needs it, so every other read of a TeamMember stays password-free.
  findByEmailWithPassword(email: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  findByGoogleId(googleId: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel.findOne({ googleId }).exec();
  }

  findByAppleId(appleId: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel.findOne({ appleId }).exec();
  }

  // Attaches a verified provider id to an existing technician. Never creates
  // one — a team member only ever exists because their owner added them, so a
  // social sign-in can link to that record but must not invent it.
  linkProviderId(
    id: string,
    provider: 'googleId' | 'appleId',
    providerId: string,
  ): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel
      .findByIdAndUpdate(id, { [provider]: providerId }, { new: true })
      .exec();
  }

  async findAllForBusiness(businessId: string): Promise<any[]> {
    const members = await this.teamMemberModel
      .find({ businessId: idFilter(businessId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    if (!members.length) return [];

    const memberIds = members.map((m) => m._id.toString());
    const idFilters = memberIds.flatMap((id) =>
      Types.ObjectId.isValid(id) ? [id, new Types.ObjectId(id)] : [id],
    );
    const businessIdFilters = Types.ObjectId.isValid(businessId)
      ? [businessId, new Types.ObjectId(businessId)]
      : [businessId];
    const counts = await this.serviceModel.aggregate([
      {
        $match: {
          businessId: { $in: businessIdFilters },
          assignedTechnicianId: { $in: idFilters },
          status: 'completed',
        },
      },
      { $group: { _id: '$assignedTechnicianId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    return members.map((m) => ({
      ...m,
      serviceCount: countMap.get(m._id.toString()) || 0,
    }));
  }

  async getMemberTasks(businessId: string, teamMemberId: string) {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Team member not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).lean().exec();
    if (!member || member.businessId?.toString() !== businessId.toString()) {
      throw new NotFoundException('Team member not found');
    }

    // Customers whose default assigned technician is this member
    const assignedCustomers = await this.customerModel
      .find({
        businessId: idFilter(businessId),
        assignedTechnicianId: idFilter(teamMemberId),
      })
      .sort({ name: 1 })
      .lean()
      .exec();

    const assignedCustomerIds = assignedCustomers.map((c) => c._id.toString());

    // Services directly assigned or through default customer assignment
    const serviceFilter: any = {
      businessId: idFilter(businessId),
    };

    if (assignedCustomerIds.length > 0) {
      serviceFilter.$or = [
        { assignedTechnicianId: idFilter(teamMemberId) },
        {
          assignedTechnicianId: { $exists: false },
          customerId: idsFilter(assignedCustomerIds),
        },
      ];
    } else {
      serviceFilter.assignedTechnicianId = idFilter(teamMemberId);
    }

    const [pendingTasks, completedTasks] = await Promise.all([
      this.serviceModel
        .find({ ...serviceFilter, status: 'pending' })
        .populate('customerId', 'name phone address')
        .sort({ serviceDate: 1 })
        .lean()
        .exec(),
      this.serviceModel
        .find({ ...serviceFilter, status: 'completed' })
        .populate('customerId', 'name phone address')
        .sort({ completedAt: -1, serviceDate: -1 })
        .lean()
        .exec(),
    ]);

    return {
      member: {
        ...member,
        serviceCount: completedTasks.length,
      },
      stats: {
        completedCount: completedTasks.length,
        pendingCount: pendingTasks.length,
        customerCount: assignedCustomers.length,
      },
      pendingTasks,
      completedTasks,
      assignedCustomers,
    };
  }

  // Shared by create() (a brand-new seat) and setActive() (reactivating one)
  // — both need the same "is there room, and is the add-on still paid for"
  // guard, so reactivating can't be used to dodge the limits creation
  // enforces.
  private async assertSeatAvailable(businessId: string): Promise<void> {
    const tier = await this.subscriptionsService.getActiveTier(businessId);
    const teamEnabled =
      await this.subscriptionsService.hasActiveTeamAddon(businessId);

    const activeCount = await this.teamMemberModel
      .countDocuments({ businessId, active: true })
      .exec();

    if (!tierAllowsTeam(tier) || !teamEnabled) {
      if (activeCount >= FREE_TIER_TEAM_LIMIT) {
        throw new ForbiddenException(
          `Your plan includes ${FREE_TIER_TEAM_LIMIT} free technician seat to test team features. Upgrade to Combo + Team (₹1499/year) to add up to ${TEAM_SEAT_LIMIT} technicians.`,
        );
      }
      return;
    }

    if (activeCount >= TEAM_SEAT_LIMIT) {
      throw new ForbiddenException(
        `Your Team add-on is limited to ${TEAM_SEAT_LIMIT} members.`,
      );
    }
  }

  async create(
    businessId: string,
    dto: CreateTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    await this.assertSeatAvailable(businessId);

    const normalizedEmail = dto.email.toLowerCase();
    const existingOwner =
      await this.businessesService.findByEmail(normalizedEmail);
    if (existingOwner) {
      throw new ConflictException(
        'This email is already registered as a business owner.',
      );
    }
    const existingMember = await this.findByEmail(normalizedEmail);
    if (existingMember) {
      throw new ConflictException(
        'This email is already a team member on another account.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    try {
      return await this.teamMemberModel.create({
        businessId,
        name: dto.name.trim(),
        email: normalizedEmail,
        passwordHash,
        phone: dto.phone?.trim(),
        specialty: dto.specialty?.trim(),
        role: dto.role || 'technician',
        active: true,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          'This email is already a team member on another account.',
        );
      }
      throw err;
    }
  }

  async updatePushToken(teamMemberId: string, pushToken: string): Promise<void> {
    await this.teamMemberModel
      .findByIdAndUpdate(teamMemberId, { pushToken })
      .exec();
  }

  async clearPushTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    await this.teamMemberModel
      .updateMany({ pushToken: { $in: tokens } }, { $unset: { pushToken: '' } })
      .exec();
  }

  findNotifiableForBusiness(businessId: string) {
    return this.teamMemberModel
      .find({ businessId, active: true, pushToken: { $exists: true, $ne: '' } })
      .select('_id name pushToken')
      .exec();
  }

  async setActive(
    businessId: string,
    teamMemberId: string,
    active: boolean,
  ): Promise<TeamMemberDocument> {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Team member not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!member || member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }

    if (active && !member.active) {
      await this.assertSeatAvailable(businessId);
    }

    member.active = active;
    return member.save();
  }

  async assertActiveMember(
    businessId: string,
    teamMemberId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Technician not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (
      !member ||
      member.businessId.toString() !== businessId ||
      !member.active
    ) {
      throw new NotFoundException('Technician not found');
    }
  }


  async resetPassword(
    businessId: string,
    teamMemberId: string,
    newPassword: string,
  ): Promise<TeamMemberDocument> {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Team member not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!member || member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }

    member.passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    return member.save();
  }

  async update(
    businessId: string,
    teamMemberId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Team member not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!member || member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }

    if (dto.active === true && !member.active) {
      await this.assertSeatAvailable(businessId);
    }

    if (dto.name !== undefined) member.name = dto.name.trim();
    if (dto.phone !== undefined) member.phone = dto.phone.trim();
    if (dto.specialty !== undefined) member.specialty = dto.specialty.trim();
    if (dto.role !== undefined) member.role = dto.role;
    if (dto.active !== undefined) member.active = dto.active;

    return member.save();
  }

  async remove(
    businessId: string,
    teamMemberId: string,
  ): Promise<{ success: boolean; id: string }> {
    if (!Types.ObjectId.isValid(teamMemberId)) {
      throw new NotFoundException('Team member not found');
    }
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!member || member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }

    await this.teamMemberModel.deleteOne({ _id: teamMemberId, businessId }).exec();
    return { success: true, id: teamMemberId };
  }
}
