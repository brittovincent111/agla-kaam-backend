import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Service, ServiceDocument } from './schemas/service.schema';
import { CreateServiceDto } from './dto/create-service.dto';
import { CustomersService } from '../customers/customers.service';
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
    private readonly customersService: CustomersService,
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
    });
  }

  async findOne(
    businessId: string,
    serviceId: string,
  ): Promise<ServiceDocument> {
    if (!Types.ObjectId.isValid(serviceId)) {
      throw new NotFoundException('Service not found');
    }
    const service = await this.serviceModel.findById(serviceId).exec();
    if (!service || service.businessId.toString() !== businessId) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  // Pushes the next-service date out without logging a new service — lets a
  // due/overdue reminder be resolved (e.g. "call me next month instead")
  // without implying the work was actually done.
  async reschedule(
    businessId: string,
    serviceId: string,
    nextServiceDate: string,
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId);
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
      .exec();
  }

  // Sorted soonest-due first — this is the "what's coming up" view, not a
  // historical log, since tracking upcoming service is the app's core purpose.
  async findAllForBusiness(businessId: string, viewer?: AuthenticatedBusiness): Promise<ServiceDocument[]> {
    const query: Record<string, unknown> = { businessId };
    if (viewer?.role === 'technician') {
      query.customerId = { $in: await this.customersService.findAssignedCustomerIds(businessId, viewer.teamMemberId!) };
    }
    return this.serviceModel
      .find(query)
      .sort({ nextServiceDate: 1 })
      .populate('customerId')
      .exec();
  }

  // A technician's reminder feeds are scoped to their assigned customers —
  // otherwise a technician's Home screen would leak every customer's data.
  private async technicianScope(
    businessId: string,
    viewer?: AuthenticatedBusiness,
  ): Promise<Record<string, unknown>> {
    if (viewer?.role !== 'technician') return {};
    const customerIds = await this.customersService.findAssignedCustomerIds(businessId, viewer.teamMemberId!);
    return { customerId: { $in: customerIds } };
  }

  async findDueBetween(
    businessId: string,
    from: Date,
    to: Date,
    viewer?: AuthenticatedBusiness,
  ): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({ businessId, nextServiceDate: { $gte: from, $lt: to }, ...(await this.technicianScope(businessId, viewer)) })
      .sort({ nextServiceDate: 1 })
      .populate('customerId')
      .exec();
  }

  async findOverdue(businessId: string, before: Date, viewer?: AuthenticatedBusiness): Promise<ServiceDocument[]> {
    return this.serviceModel
      .find({ businessId, nextServiceDate: { $lt: before }, ...(await this.technicianScope(businessId, viewer)) })
      .sort({ nextServiceDate: 1 })
      .populate('customerId')
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
        ...(await this.technicianScope(businessId, viewer)),
      })
      .sort({ warrantyExpiry: 1 })
      .populate('customerId')
      .exec();
  }
}
