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
    const existing = await this.customerModel
      .findOne({ businessId, phone: dto.phone })
      .exec();
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
    if (viewer.role !== 'technician') {
      return this.customerModel.find({ businessId }).sort({ name: 1 }).exec();
    }
    const reassignedCustomerIds =
      await this.servicesService.findAssignedServiceCustomerIds(
        businessId,
        viewer.teamMemberId!,
      );
    return this.customerModel
      .find({
        businessId,
        $or: [
          // Cast explicitly — a plain string nested inside $or isn't
          // reliably cast against the schema by Mongoose (verified: it
          // silently matched nothing when left as a string here).
          { assignedTechnicianId: new Types.ObjectId(viewer.teamMemberId) },
          { _id: { $in: reassignedCustomerIds } },
        ],
      })
      .sort({ name: 1 })
      .exec();
  }

  async findAssignedCustomerIds(
    businessId: string,
    teamMemberId: string,
  ): Promise<string[]> {
    const customers = await this.customerModel
      .find({ businessId, assignedTechnicianId: teamMemberId })
      .select('_id')
      .exec();
    return customers.map((c) => c.id);
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
