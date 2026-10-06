import {
  BadRequestException,
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
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
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
import {
  isPhoneOnlyEmail,
  loginPhoneDigits,
  phoneOnlyEmail,
} from '../common/utils/login-phone';

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
  // A phone number already used to sign in — as a team member anywhere, or
  // as a business owner — cannot be given to a second login.
  private async assertLoginPhoneFree(
    loginPhone: string,
    exceptMemberId?: string,
  ): Promise<void> {
    const taken = await this.findByLoginPhoneWithPassword(loginPhone);
    if (taken && taken.id !== exceptMemberId) {
      throw new ConflictException(
        'This phone number already signs in to a team account.',
      );
    }
    const owner = await this.businessesService.findByLoginPhone(loginPhone);
    if (owner) {
      throw new ConflictException(
        'This phone number belongs to a business owner account.',
      );
    }
  }

  /**
   * The member who signs in with this number. Members added before phone
   * login have only `phone`, stored however it was typed, so those are
   * matched on its usual spellings — and only when exactly one member has it,
   * since nothing ever made `phone` unique.
   */
  async findByLoginPhoneWithPassword(
    loginPhone: string,
  ): Promise<TeamMemberDocument | null> {
    const direct = await this.teamMemberModel
      .findOne({ loginPhone })
      .select('+passwordHash')
      .exec();
    if (direct) return direct;
    const local = loginPhone.startsWith('91')
      ? loginPhone.slice(2)
      : loginPhone;
    const spellings = [
      `+${loginPhone}`,
      loginPhone,
      local,
      `0${local}`,
      `+91 ${local}`,
    ];
    const legacy = await this.teamMemberModel
      .find({ phone: { $in: spellings }, loginPhone: { $exists: false } })
      .select('+passwordHash')
      .limit(2)
      .exec();
    return legacy.length === 1 ? legacy[0] : null;
  }

  findByEmailWithPassword(email: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  findByEmailWithResetCode(email: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordResetCodeHash +passwordResetExpiresAt +passwordResetAttempts')
      .exec();
  }

  async setPasswordResetCode(
    id: string,
    codeHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.teamMemberModel
      .findByIdAndUpdate(id, {
        passwordResetCodeHash: codeHash,
        passwordResetExpiresAt: expiresAt,
        // A fresh code starts with a fresh count of wrong tries.
        passwordResetAttempts: 0,
      })
      .exec();
  }

  // New password and consumed code in one update, so a code cannot be
  // replayed after it has been used.
  findByIdWithPassword(id: string): Promise<TeamMemberDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.teamMemberModel.findById(id).select('+passwordHash').exec();
  }

  async resetPasswordWithCode(id: string, passwordHash: string): Promise<void> {
    await this.teamMemberModel
      .findByIdAndUpdate(id, {
        passwordHash,
        $unset: { passwordResetCodeHash: 1, passwordResetExpiresAt: 1, passwordResetAttempts: 1 },
      })
      .exec();
  }

  // One more wrong reset code. At `max` the code is thrown away, so it can't
  // be guessed by retrying. Returns the count so far.
  async recordResetCodeFailure(id: string, max: number): Promise<number> {
    const doc = await this.teamMemberModel
      .findByIdAndUpdate(id, { $inc: { passwordResetAttempts: 1 } }, { new: true })
      .select('+passwordResetAttempts')
      .exec();
    const tries = doc?.passwordResetAttempts ?? max;
    if (tries >= max) {
      await this.teamMemberModel
        .findByIdAndUpdate(id, { $unset: { passwordResetCodeHash: 1, passwordResetExpiresAt: 1 } })
        .exec();
    }
    return tries;
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

  // Kept so deleting the business can revoke this login at Apple.
  async setAppleRefreshToken(
    id: string,
    appleRefreshToken: string,
  ): Promise<void> {
    await this.teamMemberModel
      .updateOne({ _id: id }, { appleRefreshToken })
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
    const member = await this.teamMemberModel
      .findById(teamMemberId)
      .lean()
      .exec();
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

  /**
   * Technician seats this business has right now: with Combo + Team, the
   * standard TEAM_SEAT_LIMIT or the seats granted to it (whichever is
   * higher); without Team, the FREE_TIER_TEAM_LIMIT test seat.
   */
  async seatInfo(businessId: string): Promise<{ used: number; limit: number; teamEnabled: boolean; granted: number | null }> {
    const [tier, teamAddon, business, used] = await Promise.all([
      this.subscriptionsService.getActiveTier(businessId),
      this.subscriptionsService.hasActiveTeamAddon(businessId),
      this.businessesService.findById(businessId).catch(() => null),
      this.teamMemberModel.countDocuments({ businessId, active: true }).exec(),
    ]);
    const teamEnabled = tierAllowsTeam(tier) && teamAddon;
    const granted = business?.teamSeatLimit ?? null;
    const limit = teamEnabled ? Math.max(TEAM_SEAT_LIMIT, granted ?? 0) : FREE_TIER_TEAM_LIMIT;
    return { used, limit, teamEnabled, granted };
  }

  // Shared by create() (a brand-new seat) and setActive() (reactivating one)
  // — both need the same "is there room, and is the add-on still paid for"
  // guard, so reactivating can't be used to dodge the limits creation
  // enforces.
  private async assertSeatAvailable(businessId: string): Promise<void> {
    const { used, limit, teamEnabled } = await this.seatInfo(businessId);
    if (used < limit) return;

    if (!teamEnabled) {
      throw new ForbiddenException(
        `Your plan includes ${FREE_TIER_TEAM_LIMIT} free technician seat to test team features. Upgrade to Combo + Team (₹1499/year) to add up to ${TEAM_SEAT_LIMIT} technicians.`,
      );
    }
    // Paid team that is full: more seats come from us, not from a store upgrade.
    throw new ForbiddenException(
      `All ${limit} technician seats are in use. Remove a technician to add someone new.`,
    );
  }

  async create(
    businessId: string,
    dto: CreateTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    await this.assertSeatAvailable(businessId);

    const loginPhone = loginPhoneDigits(dto.phone);
    if (dto.phone && !loginPhone) {
      throw new BadRequestException('Enter a complete phone number.');
    }
    if (!dto.email && !loginPhone) {
      throw new BadRequestException(
        'Add a phone number or an email to sign in with.',
      );
    }
    if (loginPhone) await this.assertLoginPhoneFree(loginPhone);

    // No email: a stand-in fills the required column; it can never be typed
    // or mailed, and API responses blank it.
    const normalizedEmail = dto.email
      ? dto.email.toLowerCase()
      : phoneOnlyEmail(loginPhone!);
    if (dto.email) {
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
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    try {
      return await this.teamMemberModel.create({
        businessId,
        name: dto.name.trim(),
        email: normalizedEmail,
        passwordHash,
        phone: dto.phone?.trim(),
        ...(loginPhone ? { loginPhone } : {}),
        specialty: dto.specialty?.trim(),
        role: dto.role || 'technician',
        active: true,
      });
    } catch (err) {
      if (
        (err as { code?: number; keyPattern?: Record<string, unknown> })
          .code === 11000
      ) {
        const onPhone = !!(err as { keyPattern?: Record<string, unknown> })
          .keyPattern?.loginPhone;
        throw new ConflictException(
          onPhone
            ? 'This phone number already signs in to a team account.'
            : 'This email is already a team member on another account.',
        );
      }
      throw err;
    }
  }

  async updatePushToken(
    teamMemberId: string,
    pushToken: string,
  ): Promise<void> {
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

  // A member of this business, or null — for building a message to them,
  // where a missing member means "no technician to write to", not an error.
  async findOwned(
    businessId: string,
    teamMemberId: string,
  ): Promise<TeamMemberDocument | null> {
    if (!Types.ObjectId.isValid(teamMemberId)) return null;
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    return member && member.businessId.toString() === businessId
      ? member
      : null;
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

  /**
   * Whether this technician is one of the plan's free seats: without the
   * Team add-on a business may add FREE_TIER_TEAM_LIMIT technician "to test
   * team features", so that one must be able to use the app. The seats go to
   * the earliest-added active members — which also decides who keeps working
   * when a paid Team plan with more members lapses.
   */
  async holdsFreeSeat(
    businessId: string,
    teamMemberId: string,
  ): Promise<boolean> {
    return this.holdsSeatWithin(businessId, teamMemberId, FREE_TIER_TEAM_LIMIT);
  }

  /**
   * Whether this technician is inside the business's current seat limit.
   * Seats go to the earliest-added active members, so if the seats are
   * lowered (or Team lapses) the newest extra logins stop, not the oldest.
   */
  async holdsSeat(businessId: string, teamMemberId: string): Promise<boolean> {
    const { limit } = await this.seatInfo(businessId);
    return this.holdsSeatWithin(businessId, teamMemberId, limit);
  }

  private async holdsSeatWithin(businessId: string, teamMemberId: string, limit: number): Promise<boolean> {
    const seats = await this.teamMemberModel
      .find({ businessId, active: true })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select('_id')
      .exec();
    return seats.some((m) => m._id.toString() === teamMemberId);
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
    if (dto.phone !== undefined) {
      const loginPhone = loginPhoneDigits(dto.phone);
      if (dto.phone.trim() && !loginPhone) {
        throw new BadRequestException('Enter a complete phone number.');
      }
      // A member who signs in by phone alone must keep a number to sign in with.
      if (!loginPhone && isPhoneOnlyEmail(member.email)) {
        throw new BadRequestException(
          'This member signs in with their phone number, so it cannot be removed.',
        );
      }
      if (loginPhone && loginPhone !== member.loginPhone) {
        await this.assertLoginPhoneFree(loginPhone, member.id);
      }
      member.phone = dto.phone.trim();
      member.loginPhone = loginPhone ?? undefined;
    }
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

    await this.teamMemberModel
      .deleteOne({ _id: teamMemberId, businessId })
      .exec();

    // Their customers and open jobs go back to the owner. Left pointing at a
    // member who no longer exists, they showed no technician and no one was
    // sent to them. Completed jobs keep who did the work.
    await Promise.all([
      this.customerModel
        .updateMany(
          {
            businessId: idFilter(businessId),
            assignedTechnicianId: idFilter(teamMemberId),
          },
          { $unset: { assignedTechnicianId: 1 } },
        )
        .exec(),
      this.serviceModel
        .updateMany(
          {
            businessId: idFilter(businessId),
            assignedTechnicianId: idFilter(teamMemberId),
            status: 'pending',
          },
          { $unset: { assignedTechnicianId: 1 } },
        )
        .exec(),
    ]);
    return { success: true, id: teamMemberId };
  }

  // ---- Cash in hand ("hisab") ------------------------------------------
  //
  // Cash a technician took at the door and has not handed over yet. Nothing
  // to set up: it is whatever they entered when completing jobs, until the
  // owner taps Settle.

  private unsettledCash(
    businessId: string,
    teamMemberId?: string,
  ): Record<string, unknown> {
    return {
      businessId: idFilter(businessId),
      collectionMethod: 'cash',
      collectionAmount: { $gt: 0 },
      collectedById: teamMemberId ? teamMemberId : { $exists: true, $ne: null },
      cashSettledAt: { $exists: false },
    };
  }

  /** Every technician holding cash: { teamMemberId, cashInHand, jobs }. */
  async cashSummary(
    businessId: string,
  ): Promise<
    { teamMemberId: string; name: string; cashInHand: number; jobs: number }[]
  > {
    const rows = await this.serviceModel
      .aggregate<{ _id: string; cashInHand: number; jobs: number }>([
        { $match: this.unsettledCash(businessId) },
        {
          $group: {
            _id: '$collectedById',
            cashInHand: { $sum: '$collectionAmount' },
            jobs: { $sum: 1 },
          },
        },
      ])
      .exec();
    const names = new Map(
      (
        await this.teamMemberModel
          .find({
            _id: {
              $in: rows
                .map((r) => r._id)
                .filter((id) => Types.ObjectId.isValid(String(id))),
            },
          })
          .select('name')
          .exec()
      ).map((m) => [m._id.toString(), m.name]),
    );
    return rows
      .map((r) => ({
        teamMemberId: String(r._id),
        name: names.get(String(r._id)) ?? 'Former member',
        cashInHand: Math.round(r.cashInHand * 100) / 100,
        jobs: r.jobs,
      }))
      .sort((a, b) => b.cashInHand - a.cashInHand);
  }

  /** One technician's unsettled cash, job by job, and their last hand-over. */
  async memberCash(businessId: string, teamMemberId: string) {
    const jobs = await this.serviceModel
      .find(this.unsettledCash(businessId, teamMemberId))
      .sort({ collectedAt: -1 })
      .limit(200)
      .populate('customerId', 'name')
      .select('serviceType collectionAmount collectedAt customerId')
      .exec();
    const cashInHand =
      Math.round(
        jobs.reduce((sum, j) => sum + (j.collectionAmount ?? 0), 0) * 100,
      ) / 100;

    // The most recent Settle stamps every job it covered with the same time.
    const [last] = await this.serviceModel
      .aggregate<{ _id: Date; amount: number; jobs: number }>([
        {
          $match: {
            businessId: idFilter(businessId),
            collectionMethod: 'cash',
            collectedById: teamMemberId,
            cashSettledAt: { $exists: true },
            collectionAmount: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: '$cashSettledAt',
            amount: { $sum: '$collectionAmount' },
            jobs: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 1 },
      ])
      .exec();

    return {
      cashInHand,
      jobs: jobs.map((j) => ({
        serviceId: j._id.toString(),
        serviceType: j.serviceType,
        customerName:
          j.customerId &&
          typeof j.customerId === 'object' &&
          'name' in (j.customerId as object)
            ? String((j.customerId as unknown as { name: string }).name)
            : '',
        amount: j.collectionAmount ?? 0,
        collectedAt: j.collectedAt,
      })),
      lastSettlement: last
        ? {
            at: last._id,
            amount: Math.round(last.amount * 100) / 100,
            jobs: last.jobs,
          }
        : null,
    };
  }

  /**
   * The owner has the cash. Settles exactly the jobs counted a moment ago —
   * cash entered while the owner was counting stays for next time.
   */
  async settleCash(
    businessId: string,
    teamMemberId: string,
  ): Promise<{ settled: number; jobs: number }> {
    // A member removed while still holding cash can still be settled: the
    // jobs are this business's own (unsettledCash is scoped to it).
    const member = Types.ObjectId.isValid(teamMemberId)
      ? await this.teamMemberModel.findById(teamMemberId).exec()
      : null;
    if (member && member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }
    const open = await this.serviceModel
      .find(this.unsettledCash(businessId, teamMemberId))
      .select('_id collectionAmount')
      .exec();
    if (!open.length) return { settled: 0, jobs: 0 };
    const at = new Date();
    await this.serviceModel
      .updateMany(
        {
          _id: { $in: open.map((j) => j._id) },
          cashSettledAt: { $exists: false },
        },
        { $set: { cashSettledAt: at } },
      )
      .exec();
    const settled =
      Math.round(
        open.reduce((sum, j) => sum + (j.collectionAmount ?? 0), 0) * 100,
      ) / 100;
    return { settled, jobs: open.length };
  }

  // ---- Work log ---------------------------------------------------------
  //
  // Attendance without anyone marking it: a day counts as worked when the
  // technician completed a job that day. Built from what completing a job
  // already records, so there is nothing to set up or tap.

  /**
   * One month of a technician's completed jobs, day by day in the business's
   * own timezone: jobs done, first and last completion time. Only days with
   * work are returned; the app lays them over the calendar.
   */
  async workLog(businessId: string, teamMemberId: string, month?: string) {
    const member = await this.teamMemberModel.findById(teamMemberId).exec();
    if (!member || member.businessId.toString() !== businessId) {
      throw new NotFoundException('Team member not found');
    }
    const now = new Date();
    const key = /^\d{4}-\d{2}$/.test(month ?? '')
      ? month!
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = key.split('-').map(Number);
    const business = await this.businessesService.findById(businessId);
    const timezone = business?.timezone || 'Asia/Kolkata';

    // Their jobs: completed by them; or, for jobs from before completions
    // were attributed, assigned to them (directly, or by being their
    // customer's default technician).
    const customerIds = (
      await this.customerModel
        .find({
          businessId: idFilter(businessId),
          assignedTechnicianId: idFilter(teamMemberId),
        })
        .select('_id')
        .exec()
    ).map((c) => c._id.toString());

    // A day either side of the month in UTC; the exact local month is
    // matched on the local date below.
    const from = new Date(Date.UTC(y, m - 1, 1) - 86_400_000);
    const to = new Date(Date.UTC(y, m, 1) + 86_400_000);

    const days = await this.serviceModel
      .aggregate<{ _id: string; jobs: number; first: string; last: string }>([
        {
          $match: {
            businessId: idFilter(businessId),
            status: 'completed',
            completedAt: { $gte: from, $lt: to },
            $or: [
              { completedById: teamMemberId },
              {
                completedById: { $exists: false },
                $or: [
                  { assignedTechnicianId: idFilter(teamMemberId) },
                  // Both stored forms: aggregation does not cast, and a job's
                  // customerId is a string on some rows — matching only the
                  // ObjectId form showed "0 days" for a technician with 25 jobs.
                  {
                    assignedTechnicianId: { $exists: false },
                    customerId: idsFilter(customerIds),
                  },
                ],
              },
            ],
          },
        },
        {
          $addFields: {
            day: {
              $dateToString: {
                date: '$completedAt',
                format: '%Y-%m-%d',
                timezone,
              },
            },
          },
        },
        { $match: { day: { $regex: `^${key}-` } } },
        {
          $group: {
            _id: '$day',
            jobs: { $sum: 1 },
            firstAt: { $min: '$completedAt' },
            lastAt: { $max: '$completedAt' },
          },
        },
        {
          $project: {
            jobs: 1,
            first: {
              $dateToString: { date: '$firstAt', format: '%H:%M', timezone },
            },
            last: {
              $dateToString: { date: '$lastAt', format: '%H:%M', timezone },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();

    return {
      month: key,
      daysWorked: days.length,
      jobs: days.reduce((sum, d) => sum + d.jobs, 0),
      days: days.map((d) => ({
        date: d._id,
        jobs: d.jobs,
        first: d.first,
        last: d.last,
      })),
    };
  }

  /**
   * Gives a technician's open jobs and default customers to someone else (or
   * to nobody) — when they are switched off or leave. Left where they were,
   * the jobs sat on the list of someone who can no longer sign in, and
   * nobody else was told about them.
   */
  async handOver(
    businessId: string,
    fromMemberId: string,
    toMemberId: string | null,
  ): Promise<{ jobs: number; customers: number }> {
    if (toMemberId) {
      if (toMemberId === fromMemberId)
        throw new BadRequestException('Pick someone else.');
      await this.assertActiveMember(businessId, toMemberId);
    }
    const to = toMemberId ? new Types.ObjectId(toMemberId) : null;
    const [jobs, customers] = await Promise.all([
      this.serviceModel
        .updateMany(
          {
            businessId: idFilter(businessId),
            assignedTechnicianId: idFilter(fromMemberId),
            status: 'pending',
          },
          to
            ? { $set: { assignedTechnicianId: to } }
            : { $unset: { assignedTechnicianId: 1 } },
        )
        .exec(),
      this.customerModel
        .updateMany(
          {
            businessId: idFilter(businessId),
            assignedTechnicianId: idFilter(fromMemberId),
          },
          to
            ? { $set: { assignedTechnicianId: to } }
            : { $unset: { assignedTechnicianId: 1 } },
        )
        .exec(),
    ]);
    return { jobs: jobs.modifiedCount, customers: customers.modifiedCount };
  }
}
