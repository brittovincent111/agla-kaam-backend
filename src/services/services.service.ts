import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Service, ServiceDocument } from './schemas/service.schema';
import { CreateServiceDto } from './dto/create-service.dto';
import { CustomersService } from '../customers/customers.service';
import { TeamMembersService } from '../team-members/team-members.service';
import type { AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import {
  resolveNextServiceDate,
  resolveWarrantyExpiry,
} from '../common/constants/service-options';
import { idFilter, idsFilter } from '../common/utils/id-match';
import {
  Page,
  andFilters,
  buildPage,
  clampLimit,
  decodePageCursor,
  escapeRegex,
  pageCursorFilter,
  pageSort,
} from '../common/pagination/cursor-page';
import { startOfLocalDay } from '../common/utils/timezone';

import { AmcService } from '../amc/amc.service';
import { S3Service } from '../common/s3/s3.service';

@Injectable()
export class ServicesService {
  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    private readonly teamMembersService: TeamMembersService,
    @Inject(forwardRef(() => AmcService))
    private readonly amcService: AmcService,
    private readonly s3Service: S3Service,
  ) {}

  async create(
    businessId: string,
    dto: CreateServiceDto,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    // Confirms the customer belongs to this business, and — for a
    // technician — that this customer is actually assigned to them.
    await this.customersService.findOneForViewer(businessId, dto.customerId, viewer);

    const serviceDate = dto.serviceDate ?? new Date();
    const warrantyExpiry = resolveWarrantyExpiry(
      serviceDate,
      dto.warrantyPeriod,
      dto.customWarrantyDate,
    );
    const nextServiceDate = resolveNextServiceDate(
      serviceDate,
      dto.nextServiceInterval,
      dto.customNextServiceDate,
    );

    const location = dto.location
      ? { latitude: dto.location.latitude, longitude: dto.location.longitude, capturedAt: new Date() }
      : undefined;
    if (location) {
      // Cached on the customer so the next visit can reuse it without
      // capturing GPS again — still just a default, always overridable.
      await this.customersService.setDefaultLocation(businessId, dto.customerId, location);
    }

    let assignedTechnicianId: string | undefined;
    if (viewer.role === 'technician') {
      assignedTechnicianId = viewer.teamMemberId;
    } else if (dto.assignedTechnicianId) {
      await this.teamMembersService.assertActiveMember(businessId, dto.assignedTechnicianId);
      assignedTechnicianId = dto.assignedTechnicianId;
    }

    const status = dto.status ?? 'pending';
    const completedAt = status === 'completed' ? new Date() : undefined;

    const createdService = await this.serviceModel.create({
      businessId,
      customerId: dto.customerId,
      serviceType: dto.serviceType,
      status,
      serviceDate,
      completedAt,
      warrantyPeriod: dto.warrantyPeriod,
      warrantyExpiry,
      nextServiceInterval: dto.nextServiceInterval,
      nextServiceDate,
      notes: dto.notes,
      location,
      assignedTechnicianId,
      amcId: dto.amcId,
    });

    // Only a service that actually HAPPENED consumes a contract visit.
    //
    // This used to fire for every AMC-linked service, including the pending
    // ones the "log next visit" form creates. logVisit marks a visit
    // completed, and since a brand-new service is not yet on the contract's
    // schedule, it fell through to "mark the first pending visit" — stamping
    // off the very visit that had just been booked. One real service
    // therefore burned two visits, and a four-visit contract closed itself
    // after two.
    //
    // Creating an already-completed service is still a real case (a visit
    // done offline, logged afterwards from the AMC screen), and that one
    // should count.
    if (dto.amcId && status === 'completed') {
      await this.amcService.logVisit(
        businessId,
        dto.amcId,
        createdService._id.toString(),
      );
    }

    return createdService;
  }

  async completeService(
    businessId: string,
    serviceId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId, viewer);
    service.status = 'completed';
    service.completedAt = new Date();
    const saved = await service.save();

    if (service.amcId) {
      await this.amcService.logVisit(
        businessId,
        service.amcId.toString(),
        service._id.toString(),
      );
    }

    // No follow-up is raised here on purpose. "Mark complete" closes the job
    // and nothing else; the next visit is created only when the user chooses
    // "Complete & log next visit", which goes through the log form so they
    // can set its date and details. An AMC is the exception — its schedule
    // raises the next visit itself, via syncAmcServices.
    return saved;
  }

  async revisitService(
    businessId: string,
    serviceId: string,
    revisitDateStr: string,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId, viewer);
    const revisitDate = new Date(revisitDateStr);
    service.revisitDate = revisitDate;
    service.nextServiceDate = revisitDate;
    service.status = 'pending';
    return service.save();
  }

  async cancelService(
    businessId: string,
    serviceId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId, viewer);
    service.status = 'cancelled';
    return service.save();
  }

  async findOne(
    businessId: string,
    serviceId: string,
    viewer?: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    if (!Types.ObjectId.isValid(serviceId)) {
      throw new NotFoundException('Service not found');
    }
    const service = await this.serviceModel
      .findOne({
        _id: serviceId,
        businessId,
        ...(await this.technicianServiceFilter(businessId, viewer)),
      })
      .populate('assignedTechnicianId', 'name')
      .exec();
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  // Pushes the next-service date out without logging a new service — lets a
  // due/overdue reminder be resolved (e.g. "call me next month instead")
  // without implying the work was actually done. Also the entry point for
  // reassigning who's responsible for that upcoming visit.
  async reschedule(
    businessId: string,
    serviceId: string,
    nextServiceDate: string,
    viewer: AuthenticatedBusiness,
    assignedTechnicianId?: string | null,
  ): Promise<ServiceDocument> {
    // findOne is already scoped: a technician can only reschedule a service
    // that's theirs (by customer default or direct reassignment) — this used
    // to have no scoping at all.
    const service = await this.findOne(businessId, serviceId, viewer);

    if (assignedTechnicianId !== undefined) {
      if (viewer.role !== 'owner') {
        throw new ForbiddenException('Only the owner can reassign a service.');
      }
      if (assignedTechnicianId === null) {
        service.assignedTechnicianId = undefined;
      } else {
        await this.teamMembersService.assertActiveMember(businessId, assignedTechnicianId);
        service.assignedTechnicianId = new Types.ObjectId(assignedTechnicianId);
      }
    }

    service.nextServiceDate = new Date(nextServiceDate);
    service.nextServiceInterval = 'custom';
    return service.save();
  }

  /**
   * A customer's service history, most recent first.
   *
   * `limit` caps how many rows come back. The customer detail screen asks for
   * a bounded slice: a customer on a monthly AMC accumulates hundreds of
   * rows, and every one of them was being sent, parsed and rendered on each
   * visit to the screen. Omitting the limit returns the whole history, which
   * is what already-installed app versions expect.
   */
  async findHistoryForCustomer(
    businessId: string,
    customerId: string,
    viewer: AuthenticatedBusiness,
    limit?: number,
  ): Promise<ServiceDocument[]> {
    // Confirms the customer belongs to this business (also 404s on a bad id,
    // and — for a technician — on a customer that isn't assigned to them).
    await this.customersService.findOneForViewer(businessId, customerId, viewer);

    const query = this.serviceModel
      .find({ businessId, customerId })
      .sort({ serviceDate: -1 })
      .populate('assignedTechnicianId', 'name');

    // One past the asked-for count, so the caller can tell "exactly this
    // many" from "this many and more" without a second count query.
    if (limit && limit > 0) query.limit(limit + 1);

    return query.exec();
  }

  async findAllForBusiness(
    businessId: string,
    viewer?: AuthenticatedBusiness,
    statusFilter?: string,
  ): Promise<ServiceDocument[]> {
    await this.amcService.syncAmcServices(businessId);
    const query: Record<string, unknown> = {
      businessId,
      ...(await this.technicianServiceFilter(businessId, viewer)),
    };

    if (statusFilter && statusFilter !== 'all') {
      query.status = statusFilter;
    } else {
      // Never return cancelled services in main list by default
      query.status = { $ne: 'cancelled' };
    }

    return this.serviceModel
      .find(query)
      .sort({ serviceDate: 1 })
      .populate('customerId')
      .populate('assignedTechnicianId', 'name')
      .exec();
  }

  // How many customers a name search may expand to before it stops widening.
  // A service stores only its customer's id, so searching by customer name
  // means resolving names to ids first; a term like "kumar" can match the
  // whole book, and an unbounded $in would put every id in the business into
  // the query. Terms this broad are not how anyone finds one job.
  private static readonly SEARCH_CUSTOMER_CAP = 500;

  /**
   * One page of services, newest-due first.
   *
   * The unpaged findAllForBusiness above returns every non-cancelled service
   * a business has ever logged — 9.65 MB for 15,000 of them, parsed on the
   * phone before a single row is drawn. It stays for already-installed app
   * versions; new ones use this.
   */
  async findPageForBusiness(
    businessId: string,
    viewer: AuthenticatedBusiness | undefined,
    options: {
      status?: string;
      customerId?: string;
      due?: 'overdue' | 'today' | 'upcoming';
      search?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<Page<ServiceDocument>> {
    const limit = clampLimit(options.limit);
    const cursor = decodePageCursor(options.cursor);

    // Materialising AMC visits is first-page-only work: it does not change
    // while the user scrolls, and running it per page would make every scroll
    // pay for it.
    if (!cursor) {
      await this.amcService.syncAmcServices(businessId);
    }

    const filter = andFilters(
      { businessId },
      await this.technicianServiceFilter(businessId, viewer),
      options.status && options.status !== 'all'
        ? { status: options.status }
        : // Cancelled services are history, not work — same default the
          // unpaged list applies.
          { status: { $ne: 'cancelled' } },
      options.customerId ? { customerId: idFilter(options.customerId) } : {},
      this.dueWindowFilter(options.due),
      await this.serviceSearchFilter(businessId, options.search),
      pageCursorFilter(cursor, 'serviceDate', 'asc'),
    );

    // Soonest due first — this is the upcoming-work tracker, not a history
    // log — with _id breaking ties so two services due the same day cannot
    // straddle a page boundary and lose one of themselves.
    const [rows, total] = await Promise.all([
      this.serviceModel
        .find(filter)
        .sort(pageSort('serviceDate', 'asc'))
        .limit(limit + 1)
        .populate('customerId', 'name phone')
        .populate('assignedTechnicianId', 'name')
        .exec(),
      cursor ? Promise.resolve(undefined) : this.serviceModel.countDocuments(filter).exec(),
    ]);

    return buildPage(rows, limit, (row) => ({
      v: row.serviceDate.toISOString(),
      id: (row._id as { toString(): string }).toString(),
    }), total);
  }

  // The overdue / due-today / upcoming split the app used to compute on the
  // device after downloading everything. It cannot be done on one page, so it
  // has to be part of the query.
  private dueWindowFilter(due?: 'overdue' | 'today' | 'upcoming'): Record<string, unknown> {
    if (!due) return {};
    // Server local day, matching how the reminder feeds already bucket dates.
    const startOfToday = startOfLocalDay(undefined, new Date());
    const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000);
    if (due === 'overdue') return { serviceDate: { $lt: startOfToday } };
    if (due === 'today') {
      return { serviceDate: { $gte: startOfToday, $lt: startOfTomorrow } };
    }
    return { serviceDate: { $gte: startOfTomorrow } };
  }

  // Matches the service type, and the customer's name via a bounded id lookup
  // — the app's search box has always covered both.
  private async serviceSearchFilter(
    businessId: string,
    search?: string,
  ): Promise<Record<string, unknown>> {
    const term = (search ?? '').trim();
    if (!term) return {};
    const escaped = escapeRegex(term);
    const customerIds = await this.customersService.findIdsMatching(
      businessId,
      term,
      ServicesService.SEARCH_CUSTOMER_CAP,
    );
    const clauses: Record<string, unknown>[] = [
      { serviceType: { $regex: escaped, $options: 'i' } },
    ];
    if (customerIds.length) {
      clauses.push({ customerId: idsFilter(customerIds) });
    }
    return { $or: clauses };
  }

  // A technician's reminder feeds are scoped to services that are theirs —
  // either the customer's default assignment, or a service reassigned to
  // them directly, overriding that default for just this one visit.
  // Otherwise a technician's Home screen would leak every customer's data,
  // or miss a job explicitly handed to them by the owner.
  private async technicianServiceFilter(
    businessId: string,
    viewer?: AuthenticatedBusiness,
  ): Promise<Record<string, unknown>> {
    if (viewer?.role !== 'technician') return {};
    const customerIds = await this.customersService.findAssignedCustomerIds(businessId, viewer.teamMemberId!);
    // Cast explicitly rather than rely on Mongoose casting a plain string
    // against the schema — that casting isn't applied consistently for a
    // field nested inside $or (verified: it silently matched nothing here
    // even though the same string equality works fine as a top-level key
    // elsewhere in this file, e.g. findAssignedCustomerIds).
    // idFilter, not a bare ObjectId: assignedTechnicianId compiles to a Mixed
    // path, so it holds an ObjectId for rows written by reschedule() and a
    // plain string for rows written elsewhere. Matching only the ObjectId form
    // hid a technician's own reassigned services from the Services list while
    // the reminder feeds — which already used idFilter — showed them.
    return {
      $or: [
        { assignedTechnicianId: idFilter(viewer.teamMemberId!) },
        { assignedTechnicianId: { $exists: false }, customerId: { $in: customerIds } },
      ],
    };
  }

  // Used by CustomersService so a technician can reach (and log the next
  // visit for) a customer whose default technician is someone else, when a
  // specific service has been reassigned to them directly.
  async findAssignedServiceCustomerIds(businessId: string, teamMemberId: string): Promise<string[]> {
    // Both representations, for the same reason as technicianServiceFilter.
    const customerIds = await this.serviceModel
      .distinct('customerId', {
        businessId,
        assignedTechnicianId: idFilter(teamMemberId),
      })
      .exec();
    return customerIds.map((id) => id.toString());
  }

  // The soonest-due service for each of a small set of customers — the one
  // the customer list shows a status pill for.
  //
  // Replaces the client-side join that required downloading every service the
  // business had ever logged. Scoped to one page of customer ids, so the
  // amount of work does not grow with the size of the business.
  //
  // "Soonest due", not "most recently logged": a customer with an overdue AC
  // service and a comfortable RO service must surface the overdue one. This
  // is the same rule the app applied client-side (latestRelevantService), so
  // moving the join to the server does not change which row is chosen.
  async upcomingServiceSummaries(
    businessId: string,
    customerIds: string[],
  ): Promise<
    Map<
      string,
      {
        _id: string;
        serviceType: string;
        serviceDate: Date;
        nextServiceDate: Date;
        warrantyExpiry?: Date | null;
      }
    >
  > {
    const summaries = new Map<
      string,
      {
        _id: string;
        serviceType: string;
        serviceDate: Date;
        nextServiceDate: Date;
        warrantyExpiry?: Date | null;
      }
    >();
    if (!customerIds.length) return summaries;

    // Sorted soonest-due-first so the first row seen for a customer is the one
    // kept — cheaper than a $group with $first over the whole collection.
    const rows = await this.serviceModel
      .find({ businessId, customerId: idsFilter(customerIds) })
      .select('customerId serviceType serviceDate nextServiceDate warrantyExpiry')
      .sort({ serviceDate: 1 })
      .exec();

    for (const row of rows) {
      const key = row.customerId.toString();
      if (summaries.has(key)) continue;
      summaries.set(key, {
        _id: (row._id as { toString(): string }).toString(),
        serviceType: row.serviceType,
        serviceDate: row.serviceDate,
        nextServiceDate: row.nextServiceDate,
        warrantyExpiry: row.warrantyExpiry,
      });
    }
    return summaries;
  }

  // A cancelled service is not upcoming work, so it does not belong in any
  // reminder feed. The main services list has always excluded it; these
  // feeds did not, which put cancelled jobs in Home's "Overdue" section and
  // in the WhatsApp reminder run.
  private static readonly NOT_CANCELLED = { status: { $ne: 'cancelled' } };

  async findDueBetween(
    businessId: string,
    from: Date,
    to: Date,
    viewer?: AuthenticatedBusiness,
    limit?: number,
  ): Promise<ServiceDocument[]> {
    await this.amcService.syncAmcServices(businessId);
    return this.reminderQuery(
      businessId,
      { serviceDate: { $gte: from, $lt: to } },
      'serviceDate',
      viewer,
      limit,
    );
  }

  async findOverdue(
    businessId: string,
    before: Date,
    viewer?: AuthenticatedBusiness,
    limit?: number,
  ): Promise<ServiceDocument[]> {
    await this.amcService.syncAmcServices(businessId);
    return this.reminderQuery(
      businessId,
      { serviceDate: { $lt: before } },
      'serviceDate',
      viewer,
      limit,
    );
  }

  async findWarrantyAlerts(
    businessId: string,
    expiringBefore: Date,
    viewer?: AuthenticatedBusiness,
    limit?: number,
  ): Promise<ServiceDocument[]> {
    return this.reminderQuery(
      businessId,
      { warrantyExpiry: { $ne: null, $lt: expiringBefore } },
      'warrantyExpiry',
      viewer,
      limit,
    );
  }

  // How many rows a reminder feed returns, and how many there are in total.
  // Home shows a preview of each feed, not the whole thing — a business with
  // 500 overdue jobs was sending 482 KB and rendering 500 cards on the
  // dashboard, which froze the app before anything could be tapped.
  async countReminders(
    businessId: string,
    window: Record<string, unknown>,
    viewer?: AuthenticatedBusiness,
  ): Promise<number> {
    return this.serviceModel
      .countDocuments(
        andFilters(
          { businessId },
          ServicesService.NOT_CANCELLED,
          window,
          await this.technicianServiceFilter(businessId, viewer),
        ),
      )
      .exec();
  }

  private async reminderQuery(
    businessId: string,
    window: Record<string, unknown>,
    sortField: string,
    viewer: AuthenticatedBusiness | undefined,
    limit?: number,
  ): Promise<ServiceDocument[]> {
    const query = this.serviceModel
      .find(
        andFilters(
          { businessId },
          ServicesService.NOT_CANCELLED,
          window,
          await this.technicianServiceFilter(businessId, viewer),
        ),
      )
      .sort({ [sortField]: 1 })
      .populate('customerId')
      .populate('assignedTechnicianId', 'name');
    if (limit !== undefined) query.limit(limit);
    return query.exec();
  }

  async uploadPhoto(
    businessId: string,
    serviceId: string,
    kind: 'before' | 'after',
    buffer: Buffer,
    contentType: string,
    viewer?: AuthenticatedBusiness,
  ): Promise<void> {
    const service = await this.findOne(businessId, serviceId, viewer);
    const key = `businesses/${businessId}/services/${serviceId}/${kind}.${contentType.includes('png') ? 'png' : 'jpg'}`;
    await this.s3Service.upload(key, buffer, contentType);
    if (kind === 'before') {
      service.beforePhotoKey = key;
      service.beforePhotoContentType = contentType;
      service.hasBeforePhoto = true;
    } else {
      service.afterPhotoKey = key;
      service.afterPhotoContentType = contentType;
      service.hasAfterPhoto = true;
    }
    await service.save();
  }

  async getPhoto(
    businessId: string,
    serviceId: string,
    kind: 'before' | 'after',
    viewer?: AuthenticatedBusiness,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const service = await this.serviceModel
      .findOne({
        _id: serviceId,
        businessId,
        ...(await this.technicianServiceFilter(businessId, viewer)),
      })
      .select('+beforePhotoKey +beforePhotoContentType +afterPhotoKey +afterPhotoContentType')
      .exec();

    if (!service) throw new NotFoundException('Service not found');

    const key = kind === 'before' ? service.beforePhotoKey : service.afterPhotoKey;
    const contentType = kind === 'before' ? service.beforePhotoContentType : service.afterPhotoContentType;

    if (!key) return null;
    const data = await this.s3Service.download(key);
    if (!data) return null;
    return { data, contentType: contentType ?? 'image/jpeg' };
  }

  async deletePhoto(
    businessId: string,
    serviceId: string,
    kind: 'before' | 'after',
    viewer?: AuthenticatedBusiness,
  ): Promise<void> {
    const service = await this.serviceModel
      .findOne({
        _id: serviceId,
        businessId,
        ...(await this.technicianServiceFilter(businessId, viewer)),
      })
      .select('+beforePhotoKey +afterPhotoKey')
      .exec();

    if (!service) throw new NotFoundException('Service not found');

    const key = kind === 'before' ? service.beforePhotoKey : service.afterPhotoKey;
    if (key) await this.s3Service.delete(key);

    if (kind === 'before') {
      service.beforePhotoKey = undefined;
      service.beforePhotoContentType = undefined;
      service.hasBeforePhoto = false;
    } else {
      service.afterPhotoKey = undefined;
      service.afterPhotoContentType = undefined;
      service.hasAfterPhoto = false;
    }
    await service.save();
  }

  async uploadSignature(
    businessId: string,
    serviceId: string,
    buffer: Buffer,
    contentType: string,
    viewer?: AuthenticatedBusiness,
  ): Promise<void> {
    const service = await this.findOne(businessId, serviceId, viewer);
    const key = `businesses/${businessId}/services/${serviceId}/signature.png`;
    await this.s3Service.upload(key, buffer, contentType);
    service.signatureKey = key;
    service.signatureContentType = contentType;
    service.hasSignature = true;
    service.signedAt = new Date();
    await service.save();
  }

  async getSignature(
    businessId: string,
    serviceId: string,
    viewer?: AuthenticatedBusiness,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const service = await this.serviceModel
      .findOne({
        _id: serviceId,
        businessId,
        ...(await this.technicianServiceFilter(businessId, viewer)),
      })
      .select('+signatureKey +signatureContentType')
      .exec();

    if (!service || !service.signatureKey) return null;
    const data = await this.s3Service.download(service.signatureKey);
    if (!data) return null;
    return { data, contentType: service.signatureContentType ?? 'image/png' };
  }
}

