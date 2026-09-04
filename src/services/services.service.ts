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

@Injectable()
export class ServicesService {
  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    private readonly teamMembersService: TeamMembersService,
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

    // A technician's own log is always attributed to themselves — not
    // client-controlled, so there's no way to log a visit under someone
    // else's name. Only the owner can set this to hand a specific visit to a
    // technician other than the customer's default (or leave it unset, which
    // means "follow the customer's default").
    let assignedTechnicianId: string | undefined;
    if (viewer.role === 'technician') {
      assignedTechnicianId = viewer.teamMemberId;
    } else if (dto.assignedTechnicianId) {
      await this.teamMembersService.assertActiveMember(businessId, dto.assignedTechnicianId);
      assignedTechnicianId = dto.assignedTechnicianId;
    }

    return this.serviceModel.create({
      businessId,
      customerId: dto.customerId,
      serviceType: dto.serviceType,
      serviceDate,
      warrantyPeriod: dto.warrantyPeriod,
      warrantyExpiry,
      nextServiceInterval: dto.nextServiceInterval,
      nextServiceDate,
      notes: dto.notes,
      location,
      assignedTechnicianId,
    });
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

  async findHistoryForCustomer(
    businessId: string,
    customerId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument[]> {
    // Confirms the customer belongs to this business (also 404s on a bad id,
    // and — for a technician — on a customer that isn't assigned to them).
    await this.customersService.findOneForViewer(businessId, customerId, viewer);

    return this.serviceModel
      .find({ businessId, customerId })
      .sort({ serviceDate: -1 })
      .populate('assignedTechnicianId', 'name')
      .exec();
  }

  // Sorted soonest-due first — this is the "what's coming up" view, not a
  // historical log, since tracking upcoming service is the app's core purpose.
  async findAllForBusiness(businessId: string, viewer?: AuthenticatedBusiness): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({ businessId, ...(await this.technicianServiceFilter(businessId, viewer)) })
      .sort({ nextServiceDate: 1 })
      .populate('customerId')
      .populate('assignedTechnicianId', 'name')
      .exec();
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
    const teamMemberObjectId = new Types.ObjectId(viewer.teamMemberId);
    return {
      $or: [
        { assignedTechnicianId: teamMemberObjectId },
        { assignedTechnicianId: { $exists: false }, customerId: { $in: customerIds } },
      ],
    };
  }

  // Used by CustomersService so a technician can reach (and log the next
  // visit for) a customer whose default technician is someone else, when a
  // specific service has been reassigned to them directly.
  async findAssignedServiceCustomerIds(businessId: string, teamMemberId: string): Promise<string[]> {
    // Cast explicitly rather than trust Mongoose to cast a plain string
    // against the schema for a .distinct() filter — the same silent
    // non-match seen with $or above, so it's not worth relying on implicit
    // casting anywhere on this path.
    const customerIds = await this.serviceModel
      .distinct('customerId', {
        businessId,
        assignedTechnicianId: new Types.ObjectId(teamMemberId),
      })
      .exec();
    return customerIds.map((id) => id.toString());
  }

  async findDueBetween(
    businessId: string,
    from: Date,
    to: Date,
    viewer?: AuthenticatedBusiness,
  ): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({ businessId, nextServiceDate: { $gte: from, $lt: to }, ...(await this.technicianServiceFilter(businessId, viewer)) })
      .sort({ nextServiceDate: 1 })
      .populate('customerId')
      .populate('assignedTechnicianId', 'name')
      .exec();
  }

  async findOverdue(businessId: string, before: Date, viewer?: AuthenticatedBusiness): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({ businessId, nextServiceDate: { $lt: before }, ...(await this.technicianServiceFilter(businessId, viewer)) })
      .sort({ nextServiceDate: 1 })
      .populate('customerId')
      .populate('assignedTechnicianId', 'name')
      .exec();
  }

  async findWarrantyAlerts(
    businessId: string,
    expiringBefore: Date,
    viewer?: AuthenticatedBusiness,
  ): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({
        businessId,
        warrantyExpiry: { $ne: null, $lt: expiringBefore },
        ...(await this.technicianServiceFilter(businessId, viewer)),
      })
      .sort({ warrantyExpiry: 1 })
      .populate('customerId')
      .populate('assignedTechnicianId', 'name')
      .exec();
  }
}
