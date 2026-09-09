import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { tierHasUnlimitedCustomers } from '../common/constants/subscription-options';
import { TeamMembersService } from '../team-members/team-members.service';
import { ServicesService } from '../services/services.service';
import type { AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import { phoneMatchPatterns } from '../common/utils/phone-match';
import { idFilter } from '../common/utils/id-match';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  andFilters,
  cursorFilter,
  decodeCursor,
  encodeCursor,
  searchFilter,
} from './customer-page';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
    private readonly teamMembersService: TeamMembersService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
  ) {}

  async create(
    businessId: string,
    dto: CreateCustomerDto,
  ): Promise<CustomerDocument> {
    // The same person may be stored under several spellings ("9876543210",
    // "098765 43210", "+919876543210"), so the check is on digits rather than
    // the literal string. See phoneMatchPatterns for why a non-Indian number
    // must match on its full digits instead of a 10-digit tail.
    const patterns = phoneMatchPatterns(dto.phone);
    const existing = patterns.length
      ? await this.customerModel
          // Patterns are digits-only, so they are safe to interpolate.
          .findOne({
            businessId,
            $or: patterns.map((pattern) => ({ phone: { $regex: pattern } })),
          })
          .exec()
      : null;
    if (existing) {
      throw new ConflictException({
        message: 'A customer with this phone number already exists.',
        existingCustomerId: existing.id,
        existingCustomerName: existing.name,
      });
    }

    const tier = await this.subscriptionsService.getActiveTier(businessId);
    if (!tierHasUnlimitedCustomers(tier)) {
      const limit = Number(
        this.configService.get('FREE_TIER_CUSTOMER_LIMIT') ?? 25,
      );
      const count = await this.customerModel
        .countDocuments({ businessId })
        .exec();
      if (count >= limit) {
        throw new ForbiddenException(
          `Free plan is limited to ${limit} customers. Upgrade to add more.`,
        );
      }
    }

    return this.customerModel.create({
      businessId,
      name: dto.name,
      phone: dto.phone,
      address: dto.address,
      gstin: dto.gstin,
      source: dto.source ?? 'manual',
    });
  }

  findAllForBusiness(businessId: string): Promise<CustomerDocument[]> {
    return this.customerModel.find({ businessId }).sort({ name: 1 }).exec();
  }

  // A technician sees a customer if either the customer's default is them,
  // or they have at least one service directly reassigned to them for that
  // customer — otherwise a job handed to a technician by the owner would
  // show up in that technician's reminders feed with nowhere to tap through
  // to (no customer detail, no way to log the next visit). The owner sees
  // everyone. Used for the customer-facing list/detail endpoints.
  async findAllForViewer(
    businessId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<CustomerDocument[]> {
    // Same scope object the paged read uses, so the two genuinely cannot
    // disagree about what a technician is allowed to see.
    const scope = await this.viewerScope(businessId, viewer);
    return this.customerModel
      .find(andFilters({ businessId }, scope))
      .sort({ name: 1 })
      .exec();
  }

  async findAssignedCustomerIds(
    businessId: string,
    teamMemberId: string,
  ): Promise<string[]> {
    const customers = await this.customerModel
      .find({ businessId, assignedTechnicianId: idFilter(teamMemberId) })
      .select('_id')
      .exec();
    return customers.map((c) => c.id);
  }

  // One page of customers, each with a summary of their most recent service.
  //
  // The app used to fetch EVERY customer and EVERY service on each visit to
  // the Customers tab and join them in JavaScript — measured at 10.3 MB for
  // a 5,000-customer business (1.09 MB of customers, 9.20 MB of services,
  // the latter because each service populated its whole customer document).
  // That is downloaded, parsed and held in memory on a low-end phone.
  //
  // Here the page is 25 rows, search runs in the database, and the service
  // summary is fetched for just those 25 customers.
  async findPageForViewer(
    businessId: string,
    viewer: AuthenticatedBusiness,
    options: { search?: string; limit?: number; cursor?: string },
  ): Promise<{
    items: (CustomerDocument & { nextService?: unknown })[];
    nextCursor: string | null;
    // Only present on the first page of a result set. The app shows it as the
    // list's count; later pages omit it rather than pay for the same count
    // again on every scroll.
    total?: number;
  }> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const cursor = decodeCursor(options.cursor);

    // andFilters, not object spread: the scope, the search and the cursor are
    // each a top-level `$or`, and spreading them would keep only the last.
    const scope = await this.viewerScope(businessId, viewer);
    const filter: Record<string, unknown> = andFilters(
      { businessId },
      scope,
      searchFilter(options.search),
      cursorFilter(cursor),
    );

    // One extra row tells us whether another page exists without a count().
    // The count is fetched only for the first page, where the app needs a
    // number to display; it rides the { businessId, name } index.
    const [rows, total] = await Promise.all([
      this.customerModel
        .find(filter)
        .sort({ name: 1, _id: 1 })
        .limit(limit + 1)
        .exec(),
      cursor
        ? Promise.resolve(undefined)
        : this.customerModel.countDocuments(filter).exec(),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const summaries = await this.servicesService.upcomingServiceSummaries(
      businessId,
      page.map((customer) => customer.id as string),
    );

    const items = page.map((customer) => {
      const plain = customer.toObject() as CustomerDocument & {
        nextService?: unknown;
      };
      plain.nextService = summaries.get(customer.id as string);
      return plain;
    });

    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ name: last.name, id: last.id as string })
          : null,
      ...(total === undefined ? {} : { total }),
    };
  }

  /**
   * Ids of customers whose name or phone matches a term, capped.
   *
   * Used by the service, invoice and quotation lists: those documents store
   * only a customer id, so searching them by customer name means resolving
   * names to ids first. Capped because a term like "kumar" can match the
   * whole book, and feeding every id in the business into an `$in` is not a
   * query anyone wants to run — a term that broad is not how someone finds
   * one job.
   */
  async findIdsMatching(
    businessId: string,
    search: string,
    cap: number,
  ): Promise<string[]> {
    const term = (search ?? '').trim();
    if (!term) return [];
    const rows = await this.customerModel
      .find(andFilters({ businessId }, searchFilter(term)))
      .select('_id')
      .limit(cap)
      .exec();
    return rows.map((row) => (row._id as { toString(): string }).toString());
  }

  // The technician visibility rules, shared by the paged and unpaged reads so
  // the two can never disagree about what a technician is allowed to see.
  private async viewerScope(
    businessId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<Record<string, unknown>> {
    if (viewer.role !== 'technician') return {};
    const reassignedCustomerIds =
      await this.servicesService.findAssignedServiceCustomerIds(
        businessId,
        viewer.teamMemberId!,
      );
    return {
      $or: [
        { assignedTechnicianId: idFilter(viewer.teamMemberId!) },
        { _id: { $in: reassignedCustomerIds } },
      ],
    };
  }

  async findOne(
    businessId: string,
    customerId: string,
  ): Promise<CustomerDocument> {
    if (!Types.ObjectId.isValid(customerId)) {
      throw new NotFoundException('Customer not found');
    }
    const customer = await this.customerModel.findById(customerId).exec();
    if (!customer || customer.businessId.toString() !== businessId) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async findOneForViewer(
    businessId: string,
    customerId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<CustomerDocument> {
    const customer = await this.findOne(businessId, customerId);
    if (viewer.role === 'technician') {
      const isDefaultAssignee =
        customer.assignedTechnicianId?.toString() === viewer.teamMemberId;
      const hasReassignedService = !isDefaultAssignee
        ? (
            await this.servicesService.findAssignedServiceCustomerIds(
              businessId,
              viewer.teamMemberId!,
            )
          ).includes(customerId)
        : false;
      if (!isDefaultAssignee && !hasReassignedService) {
        throw new NotFoundException('Customer not found');
      }
    }
    return customer;
  }

  async setDefaultLocation(
    businessId: string,
    customerId: string,
    location: { latitude: number; longitude: number; capturedAt: Date },
  ): Promise<void> {
    await this.customerModel
      .updateOne(
        { _id: customerId, businessId },
        { $set: { defaultLocation: location } },
      )
      .exec();
  }

  async update(
    businessId: string,
    customerId: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerDocument> {
    const customer = await this.findOne(businessId, customerId);
    // dto.assignedTechnicianId is `null` when the owner is unassigning —
    // only a real id needs to be checked against the roster. This was
    // previously accepted with no check that the id belongs to this
    // business's active technicians at all.
    if (dto.assignedTechnicianId) {
      await this.teamMembersService.assertActiveMember(
        businessId,
        dto.assignedTechnicianId,
      );
    }
    Object.assign(customer, dto);
    return customer.save();
  }

  async remove(businessId: string, customerId: string): Promise<void> {
    const customer = await this.findOne(businessId, customerId);
    await customer.deleteOne();
  }
}
