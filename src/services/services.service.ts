import { dateRangeFilter } from '../common/pagination/date-range';
import { splitList } from '../common/pagination/list-options';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleRef } from '@nestjs/core';
import { Model, Types } from 'mongoose';
import { Service, ServiceDocument } from './schemas/service.schema';
import { CreateServiceDto } from './dto/create-service.dto';
import { CustomersService } from '../customers/customers.service';
import { TeamMembersService } from '../team-members/team-members.service';
import type { AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import {
  NextServiceInterval,
  WarrantyPeriod,
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
  SortDirection,
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
    private readonly moduleRef: ModuleRef,
  ) {}

  async create(
    businessId: string,
    dto: CreateServiceDto,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    // Confirms the customer belongs to this business, and — for a
    // technician — that this customer is actually assigned to them.
    await this.customersService.findOneForViewer(
      businessId,
      dto.customerId,
      viewer,
    );

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
      ? {
          latitude: dto.location.latitude,
          longitude: dto.location.longitude,
          capturedAt: new Date(),
        }
      : undefined;
    if (location) {
      // Cached on the customer so the next visit can reuse it without
      // capturing GPS again — still just a default, always overridable.
      await this.customersService.setDefaultLocation(
        businessId,
        dto.customerId,
        location,
      );
    }

    let assignedTechnicianId: string | undefined;
    if (viewer.role === 'technician') {
      assignedTechnicianId = viewer.teamMemberId;
    } else if (dto.assignedTechnicianId) {
      await this.teamMembersService.assertActiveMember(
        businessId,
        dto.assignedTechnicianId,
      );
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
      ...(status === 'pending'
        ? this.bookingOnCreate(dto.booked, serviceDate, dto.visitSlot)
        : {}),
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
    location?: { latitude: number; longitude: number },
    completedAtIso?: string,
    nextVisit?: {
      interval?: '1m' | '3m' | '6m' | '1y';
      date?: string;
      skip?: boolean;
    },
    collection?: { method: 'cash' | 'upi' | 'unpaid'; amount?: number },
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId, viewer);
    // A completion queued offline arrives late: take its own time, within
    // reason — never in the future, never more than 30 days back.
    const claimed = completedAtIso ? new Date(completedAtIso) : null;
    const nowMs = Date.now();
    const completedAt =
      claimed &&
      !Number.isNaN(claimed.getTime()) &&
      claimed.getTime() <= nowMs + 5 * 60_000 &&
      claimed.getTime() >= nowMs - 30 * 86_400_000
        ? claimed
        : new Date();
    // Sent twice (a retry after a timeout that had in fact succeeded): the
    // job is already done — answer with it rather than completing it again,
    // which would re-count an AMC visit.
    if (service.status === 'completed') return service;
    service.status = 'completed';
    service.completedAt = completedAt;
    service.completedById =
      viewer.role === 'technician' && viewer.teamMemberId
        ? viewer.teamMemberId
        : 'owner';
    // Warranty and the next visit run from the day the work was actually
    // done — a job finished two weeks late (or marked complete early) was
    // keeping the dates of the day it was booked for.
    this.rederiveFromDate(service, service.completedAt);

    // Completing is the one moment a live GPS read is trustworthy — the
    // technician is at the door. Only fills a gap: a pin already captured
    // when the job was logged is the more deliberate record and wins.
    if (location && !service.location) {
      const captured = {
        latitude: location.latitude,
        longitude: location.longitude,
        capturedAt: new Date(),
      };
      service.location = captured;
      // Cached on the customer too, so every future visit inherits it and
      // "Use saved location from last visit" works — same as the log path.
      // Seed-only: nobody asked for this read, so it must not move a pin that
      // was already deliberately set.
      await this.customersService.setDefaultLocation(
        businessId,
        service.customerId.toString(),
        captured,
        true,
      );
    }

    // The next visit, booked in the same step when the app asks for one.
    // Home, Services and the 8 AM reminder list only OPEN jobs, so a job
    // completed without one was never due again — the customer's six-monthly
    // reminder was silently lost. An AMC visit and a callback never book one
    // here: the contract's schedule raises AMC visits, and a callback's
    // original job keeps the customer's cycle.
    if (nextVisit && !nextVisit.skip && !service.amcId && !service.callbackOf) {
      const followUp = await this.bookFollowUp(service, completedAt, nextVisit);
      if (followUp) {
        service.nextVisitId = followUp._id;
        service.nextServiceDate = followUp.serviceDate;
      }
    }

    // Money taken at the door. Cash is in the hand of whoever completed the
    // job — a technician's shows on the Team screen until the owner settles
    // it; an owner completing it already has the cash, so nothing to hand over.
    if (collection) {
      const amount =
        collection.method === 'unpaid'
          ? 0
          : Math.round((collection.amount ?? 0) * 100) / 100;
      service.collectionMethod = collection.method;
      service.collectionAmount = amount;
      service.collectedAt = completedAt;
      if (viewer.role === 'technician' && viewer.teamMemberId) {
        service.collectedById = viewer.teamMemberId;
      }
      if (collection.method !== 'cash' || !service.collectedById) {
        // Nothing for anyone to hand over.
        service.cashSettledAt = completedAt;
      }
    }

    const saved = await service.save();

    // If the job already has a sent invoice, the money goes on it now;
    // otherwise it is picked up when an invoice for the job is sent.
    if (collection && (saved.collectionAmount ?? 0) > 0) {
      await this.applyCollectionToInvoice(businessId, saved._id.toString());
    }

    if (service.amcId) {
      await this.amcService.logVisit(
        businessId,
        service.amcId.toString(),
        service._id.toString(),
      );
    }
    return saved;
  }

  /**
   * The open job for a completed one's next visit: same customer, service
   * and technician, carrying the same warranty and repeat time so its own
   * completion books the one after. If a matching open job is already booked
   * close to that date (someone scheduled it by hand), that one is used
   * instead of a second.
   */
  private async bookFollowUp(
    done: ServiceDocument,
    completedAt: Date,
    next: { interval?: '1m' | '3m' | '6m' | '1y'; date?: string },
  ): Promise<ServiceDocument | null> {
    const chosenDate = next.date ? new Date(next.date) : null;
    const interval =
      next.interval ?? (done.nextServiceInterval as NextServiceInterval);
    const date =
      chosenDate && !Number.isNaN(chosenDate.getTime())
        ? chosenDate
        : interval && interval !== 'none' && interval !== 'custom'
          ? resolveNextServiceDate(completedAt, interval)
          : null;
    if (!date) return null;

    const window = 21 * 86_400_000;
    const existing = await this.serviceModel
      .findOne({
        businessId: idFilter(done.businessId.toString()),
        customerId: idFilter(done.customerId.toString()),
        status: 'pending',
        serviceDate: {
          $gte: new Date(date.getTime() - window),
          $lte: new Date(date.getTime() + window),
        },
        serviceType: done.serviceType,
        _id: { $ne: done._id },
      })
      .collation({ locale: 'en', strength: 2 })
      .exec();
    if (existing) return existing;

    const repeat: NextServiceInterval =
      next.interval ?? (interval as NextServiceInterval) ?? 'custom';
    const assigned = done.assignedTechnicianId as unknown as
      { _id?: unknown } | undefined;
    const lastTechnician =
      assigned && typeof assigned === 'object' && assigned._id
        ? String(assigned._id)
        : done.assignedTechnicianId
          ? String(done.assignedTechnicianId)
          : done.completedById && done.completedById !== 'owner'
            ? done.completedById
            : undefined;
    const period = done.warrantyPeriod as WarrantyPeriod;
    return this.serviceModel.create({
      businessId: done.businessId,
      customerId: done.customerId,
      serviceType: done.serviceType,
      status: 'pending',
      serviceDate: date,
      warrantyPeriod: period === 'custom' ? 'none' : period,
      warrantyExpiry:
        period && period !== 'custom'
          ? resolveWarrantyExpiry(date, period)
          : null,
      nextServiceInterval: repeat === 'custom' ? 'none' : repeat,
      nextServiceDate:
        repeat && repeat !== 'custom' && repeat !== 'none'
          ? resolveNextServiceDate(date, repeat)
          : date,
      // A reminder date, not an appointment: the customer has not agreed to
      // it. Assigned to nobody until it is booked — it used to copy the
      // technician, who then found it on their Today list and morning push.
      booked: false,
      suggestedTechnicianId: lastTechnician,
    });
  }

  // Marks that the service record went to the customer (the checklist tick).
  // Resolved at call time: InvoicingModule imports this module, so a
  // constructor dependency the other way round would be circular.
  private async applyCollectionToInvoice(
    businessId: string,
    serviceId: string,
  ): Promise<void> {
    try {
      const { InvoicingService } =
        await import('../invoicing/invoicing.service');
      const invoicing = this.moduleRef.get(InvoicingService, { strict: false });
      await invoicing.applyJobCollections(businessId, [serviceId]);
    } catch (err) {
      // The job is completed either way; the money is picked up again when
      // an invoice for it is sent.
      console.error('[collections] could not apply to invoice', serviceId, err);
    }
  }

  /**
   * The owner correcting what was taken at the door (a technician typed
   * ₹8,000 for ₹800). Moves the cash-in-hand figure and the invoice payment
   * with it, so neither keeps the wrong number.
   */
  async correctCollection(
    businessId: string,
    serviceId: string,
    viewer: AuthenticatedBusiness,
    collection: { method: 'cash' | 'upi' | 'unpaid'; amount?: number },
  ): Promise<ServiceDocument> {
    if (viewer.role === 'technician') {
      throw new ForbiddenException(
        'Only the owner can correct a collected amount.',
      );
    }
    const service = await this.findOne(businessId, serviceId, viewer);
    if (service.status !== 'completed') {
      throw new BadRequestException(
        'Only a completed job has a collected amount.',
      );
    }
    const amount =
      collection.method === 'unpaid'
        ? 0
        : Math.round((collection.amount ?? 0) * 100) / 100;
    const wasCash = service.collectionMethod === 'cash';
    service.collectionMethod = collection.method;
    service.collectionAmount = amount;
    service.collectedAt =
      service.collectedAt ?? service.completedAt ?? new Date();
    if (collection.method !== 'cash' || !service.collectedById) {
      // Nothing for anyone to hand over.
      service.cashSettledAt = service.cashSettledAt ?? new Date();
    } else if (!wasCash) {
      // Now cash in the technician's hand — back on their hand-over.
      service.cashSettledAt = undefined;
    }

    const paymentId = service.collectionPaymentId;
    if (paymentId) {
      const { InvoicingService } =
        await import('../invoicing/invoicing.service');
      const invoicing = this.moduleRef.get(InvoicingService, { strict: false });
      const applied = await invoicing.adjustJobPayment(
        businessId,
        paymentId,
        amount,
        collection.method === 'upi' ? 'upi' : 'cash',
      );
      if (applied === null) {
        service.collectionPaymentId = undefined;
        service.collectionAppliedAt = undefined;
      }
    }
    const saved = await service.save();
    if (!saved.collectionPaymentId && amount > 0) {
      await this.applyCollectionToInvoice(businessId, saved._id.toString());
    }
    return this.findOne(businessId, serviceId, viewer);
  }

  /**
   * Takes this job's door payment for putting on an invoice, once: the
   * claim is atomic, so two sends (or a send racing a completion) cannot
   * both record it. Null when there is nothing (left) to apply.
   */
  async claimCollection(
    businessId: string,
    serviceId: string,
  ): Promise<{
    amount: number;
    method: 'cash' | 'upi';
    collectedAt: Date;
  } | null> {
    const claimed = await this.serviceModel
      .findOneAndUpdate(
        {
          _id: serviceId,
          businessId: idFilter(businessId),
          collectionMethod: { $in: ['cash', 'upi'] },
          collectionAmount: { $gt: 0 },
          collectionAppliedAt: { $exists: false },
        },
        { $set: { collectionAppliedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!claimed) return null;
    return {
      amount: claimed.collectionAmount!,
      method: claimed.collectionMethod as 'cash' | 'upi',
      collectedAt: claimed.collectedAt ?? new Date(),
    };
  }

  async finishCollectionClaim(
    serviceId: string,
    paymentId: string | null,
  ): Promise<void> {
    await this.serviceModel
      .updateOne(
        { _id: serviceId },
        paymentId
          ? { $set: { collectionPaymentId: paymentId } }
          : // Not applied after all (no open balance): release it for a later invoice.
            { $unset: { collectionAppliedAt: 1 } },
      )
      .exec();
  }

  async markRecordShared(
    businessId: string,
    serviceId: string,
    viewer: AuthenticatedBusiness,
  ) {
    const service = await this.findOne(businessId, serviceId, viewer);
    await this.serviceModel
      .updateOne({ _id: service._id }, { $set: { recordSharedAt: new Date() } })
      .exec();
  }

  /**
   * Pins where the job is, from the service card.
   *
   * Separate from create and complete because that is the moment a
   * technician is actually standing at the door — the log form can only
   * offer a live GPS read while a visit is being *scheduled*, which is
   * usually from the office.
   *
   * Overwrites an existing pin: someone tapping this is correcting it.
   */
  async setServiceLocation(
    businessId: string,
    serviceId: string,
    viewer: AuthenticatedBusiness,
    location: { latitude: number; longitude: number },
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId, viewer);
    const captured = {
      latitude: location.latitude,
      longitude: location.longitude,
      capturedAt: new Date(),
    };
    service.location = captured;
    // The customer default is what makes every FUTURE visit navigable.
    await this.customersService.setDefaultLocation(
      businessId,
      service.customerId.toString(),
      captured,
    );
    return service.save();
  }

  /**
   * Re-derives what hangs off a job's date when the date changes: warranty
   * and the next-visit date both count from the day the work happens. A
   * custom warranty or next date is a date someone chose, so it is left
   * alone. Without this, pushing a visit (or finishing it late) left its
   * warranty and its next reminder counting from a day nothing happened.
   */
  private rederiveFromDate(service: ServiceDocument, from: Date): void {
    const period = service.warrantyPeriod as WarrantyPeriod;
    if (period && period !== 'custom') {
      service.warrantyExpiry = resolveWarrantyExpiry(from, period);
    }
    const interval = service.nextServiceInterval as NextServiceInterval;
    if (interval && interval !== 'custom') {
      service.nextServiceDate = resolveNextServiceDate(from, interval);
    }
  }

  async revisitService(
    businessId: string,
    serviceId: string,
    revisitDateStr: string,
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    const service = await this.findOne(businessId, serviceId, viewer);
    // "Revisit" is "came, could not finish, coming back": it belongs to a
    // job that is still open. On a completed job it silently reopened the
    // record; that is a new visit, logged as one.
    if (service.status !== 'pending') {
      throw new BadRequestException(
        service.status === 'completed'
          ? 'This job is already done. Log a new visit for the return trip.'
          : 'A cancelled job cannot be revisited.',
      );
    }
    const revisitDate = new Date(revisitDateStr);
    if (Number.isNaN(revisitDate.getTime())) {
      throw new BadRequestException('Choose a date for the revisit.');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (revisitDate.getTime() < today.getTime() - 86_400_000) {
      // A day of slack for time zones; a revisit is a future visit.
      throw new BadRequestException('A revisit has to be today or later.');
    }

    service.originalServiceDate ??= service.serviceDate;
    service.revisitCount = (service.revisitCount ?? 0) + 1;
    service.revisitDate = revisitDate;
    // The revisit IS the visit now due, and every "due" list and reminder
    // reads serviceDate. It used to move only nextServiceDate — which left
    // the job overdue AND overwrote the following visit's date with the
    // revisit's, so the regular six-monthly reminder was lost for good.
    service.serviceDate = revisitDate;
    this.rederiveFromDate(service, revisitDate);
    service.lastRemindedAt = undefined;
    if (service.amcId) {
      await this.amcService.moveVisit(
        businessId,
        service.amcId.toString(),
        service._id.toString(),
        revisitDate,
      );
    }
    return service.save();
  }

  // Access-checked like every other read: a technician can only mark their
  // own jobs.
  async markReminded(
    businessId: string,
    serviceId: string,
    viewer: AuthenticatedBusiness,
  ): Promise<void> {
    const service = await this.findOne(businessId, serviceId, viewer);
    await this.serviceModel
      .updateOne({ _id: service._id }, { $set: { lastRemindedAt: new Date() } })
      .exec();
  }

  /**
   * Books a callback for a completed job: a new, open visit linked to it.
   *
   * Not a revisit — that is for a job not finished yet, and reopening a done
   * one would erase that it was done. The callback carries no warranty and
   * no next-service cycle of its own (it is a fix, not new work), and no AMC
   * link, so it does not use up one of a contract's visits. The original job
   * is not modified at all.
   */
  async createCallback(
    businessId: string,
    serviceId: string,
    dto: { date: string; notes?: string },
    viewer: AuthenticatedBusiness,
  ): Promise<ServiceDocument> {
    const picked = await this.findOne(businessId, serviceId, viewer);
    if (picked.status !== 'completed') {
      throw new BadRequestException(
        'A callback is for a job already done. For an open job, use Revisit later.',
      );
    }
    // A callback booked from a callback belongs to the original job: that is
    // whose warranty covers it, and where the card lists its callbacks.
    // Linking to the repair visit instead made every second callback read
    // "out of warranty" (a callback carries none of its own).
    const original = picked.callbackOf
      ? await this.findOne(
          businessId,
          picked.callbackOf.toString(),
          viewer,
        ).catch(() => picked)
      : picked;
    if (original.status !== 'completed') {
      throw new BadRequestException(
        'A callback is for a job already done. For an open job, use Revisit later.',
      );
    }
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Choose a date for the callback.');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date.getTime() < today.getTime() - 86_400_000) {
      throw new BadRequestException('A callback has to be today or later.');
    }

    const underWarranty =
      !!original.warrantyExpiry &&
      original.warrantyExpiry.getTime() >= date.getTime();
    const assigned = original.assignedTechnicianId as unknown as
      { _id?: unknown } | undefined;
    const reason = dto.notes?.trim();

    return this.serviceModel.create({
      businessId,
      customerId: original.customerId,
      serviceType: original.serviceType,
      status: 'pending',
      serviceDate: date,
      warrantyPeriod: 'none',
      warrantyExpiry: null,
      nextServiceInterval: 'none',
      nextServiceDate: date,
      notes:
        reason ||
        `Callback for the ${original.serviceType} done on ${original.serviceDate.toDateString()}.`,
      // The same technician goes back — populated or not, keep the id.
      assignedTechnicianId:
        assigned && typeof assigned === 'object' && assigned._id
          ? (assigned._id as any)
          : original.assignedTechnicianId,
      callbackOf: original._id,
      underWarranty,
    });
  }

  // The callbacks raised against a job, newest first — for the original's
  // card to list.
  findCallbacks(businessId: string, serviceId: string) {
    return this.serviceModel
      .find({
        businessId: idFilter(businessId),
        callbackOf: idFilter(serviceId),
      })
      .select('serviceDate status underWarranty')
      .sort({ serviceDate: -1 })
      .lean()
      .exec();
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
    dates: { serviceDate?: string; nextServiceDate?: string },
    viewer: AuthenticatedBusiness,
    assignedTechnicianId?: string | null,
    booking?: { book?: boolean; visitSlot?: string | null },
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
        await this.teamMembersService.assertActiveMember(
          businessId,
          assignedTechnicianId,
        );
        service.assignedTechnicianId = new Types.ObjectId(assignedTechnicianId);
      }
    }

    // Only "Book visit" books it. Moving a reminder to next week, or
    // pencilling in a technician, is not the customer agreeing — booking it
    // silently put it on a technician's day before anyone had called.
    if (booking?.book) {
      service.booked = true;
    }
    if (booking?.visitSlot !== undefined) {
      service.visitSlot = booking.visitSlot || undefined;
    }

    // Each date moves on its own. A reassign passes neither and must leave
    // both alone; an older client passes only nextServiceDate.
    if (dates.serviceDate !== undefined) {
      const moved = new Date(dates.serviceDate);
      // A new date is a new appointment: the customer has not been reminded
      // about it yet, so the next reminder is a first one, not a follow-up.
      const changed = moved.getTime() !== service.serviceDate?.getTime();
      if (changed) {
        service.lastRemindedAt = undefined;
      }
      service.serviceDate = moved;
      // A job that has not happened yet: its warranty and next visit move
      // with it — unless this same request sets the next date itself.
      if (
        changed &&
        service.status === 'pending' &&
        dates.nextServiceDate === undefined
      ) {
        this.rederiveFromDate(service, moved);
      }
      if (changed && service.amcId && service.status === 'pending') {
        await this.amcService.moveVisit(
          businessId,
          service.amcId.toString(),
          service._id.toString(),
          moved,
        );
      }
    }
    if (dates.nextServiceDate !== undefined) {
      service.nextServiceDate = new Date(dates.nextServiceDate);
      // Only the next-visit date invalidates the interval it was derived
      // from. Moving serviceDate leaves nextServiceDate where it was.
      service.nextServiceInterval = 'custom';
    }
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
    await this.customersService.findOneForViewer(
      businessId,
      customerId,
      viewer,
    );

    const query = this.serviceModel
      .find({ businessId, customerId })
      .sort({ serviceDate: -1, _id: -1 })
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
      technicianId?: string;
      serviceType?: string;
      from?: string;
      to?: string;
      amcOnly?: string;
      callbacksOnly?: string;
      notReminded?: string;
      bookedOnly?: string;
      booking?: 'booked' | 'notbooked';
      toBook?: string;
      sort?: 'soonest' | 'latest';
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

    // Finished and cancelled work is history: newest first, unless the
    // Filters sheet asked for an order.
    const isHistory =
      options.status === 'completed' || options.status === 'cancelled';
    const direction: SortDirection = options.sort
      ? options.sort === 'latest'
        ? 'desc'
        : 'asc'
      : isHistory
        ? 'desc'
        : 'asc';
    const pickedCustomers = splitList(options.customerId);
    const pickedTechnicians = splitList(options.technicianId);
    const pickedTypes = (options.serviceType ?? '')
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 50);

    const filter = andFilters(
      { businessId },
      await this.technicianServiceFilter(businessId, viewer),
      options.status && options.status !== 'all'
        ? { status: options.status }
        : // Cancelled services are history, not work — same default the
          // unpaged list applies.
          { status: { $ne: 'cancelled' } },
      pickedCustomers.length ? { customerId: idsFilter(pickedCustomers) } : {},
      await this.dueWindowFilter(businessId, options.due),
      await this.serviceSearchFilter(businessId, options.search),
      pickedTechnicians.length
        ? {
            $or: (
              await Promise.all(
                pickedTechnicians.map((id) =>
                  this.technicianJobsFilter(businessId, id),
                ),
              )
            ).flatMap((f) => (f.$or as Record<string, unknown>[]) ?? [f]),
          }
        : {},
      pickedTypes.length
        ? {
            serviceType: {
              $in: pickedTypes.map(
                (t) => new RegExp(`^${escapeRegex(t)}$`, 'i'),
              ),
            },
          }
        : {},
      options.amcOnly === 'true' ? { amcId: { $exists: true, $ne: null } } : {},
      options.callbacksOnly === 'true'
        ? { callbackOf: { $exists: true, $ne: null } }
        : {},
      options.notReminded === 'true' ? { lastRemindedAt: null } : {},
      options.bookedOnly === 'true' || options.booking === 'booked'
        ? { booked: true }
        : {},
      options.booking === 'notbooked' ? { booked: { $ne: true } } : {},
      options.toBook === 'true' ? this.toBookFilter() : {},
      dateRangeFilter('serviceDate', options.from, options.to),
      pageCursorFilter(cursor, 'serviceDate', direction),
    );

    // Soonest due first — this is the upcoming-work tracker — with _id
    // breaking ties so two services due the same day cannot straddle a page
    // boundary and lose one of themselves.
    const [rows, total] = await Promise.all([
      this.serviceModel
        .find(filter)
        .sort(pageSort('serviceDate', direction))
        .limit(limit + 1)
        // Address and saved pin: a technician's Today list opens directions.
        .populate('customerId', 'name phone address defaultLocation')
        .populate('assignedTechnicianId', 'name')
        .exec(),
      cursor
        ? Promise.resolve(undefined)
        : this.serviceModel.countDocuments(filter).exec(),
    ]);

    return buildPage(
      rows,
      limit,
      (row) => ({
        v: row.serviceDate.toISOString(),
        id: (row._id as { toString(): string }).toString(),
      }),
      total,
    );
  }

  // The overdue / due-today / upcoming split the app used to compute on the
  // device after downloading everything. It cannot be done on one page, so it
  // has to be part of the query.
  private async dueWindowFilter(
    businessId: string,
    due?: 'overdue' | 'today' | 'upcoming',
  ): Promise<Record<string, unknown>> {
    if (!due) return {};
    // The business's own day (India by default) — the same window the Home
    // reminder feeds use, never the server's UTC clock.
    const business = await this.serviceModel.db
      .collection('businesses')
      .findOne({ _id: Types.ObjectId.isValid(businessId) ? new Types.ObjectId(businessId) : (businessId as any) }, { projection: { timezone: 1 } })
      .catch(() => null);
    const startOfToday = startOfLocalDay(business?.timezone, new Date());
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
    return this.technicianJobsFilter(businessId, viewer.teamMemberId!);
  }

  // A technician's jobs: assigned to them, or unassigned jobs of customers
  // who are theirs by default.
  private async technicianJobsFilter(
    businessId: string,
    teamMemberId: string,
  ): Promise<Record<string, unknown>> {
    const customerIds = await this.customersService.findAssignedCustomerIds(
      businessId,
      teamMemberId,
    );
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
        { assignedTechnicianId: idFilter(teamMemberId) },
        {
          assignedTechnicianId: { $exists: false },
          customerId: { $in: customerIds },
        },
      ],
    };
  }

  // Used by CustomersService so a technician can reach (and log the next
  // visit for) a customer whose default technician is someone else, when a
  // specific service has been reassigned to them directly.
  async findAssignedServiceCustomerIds(
    businessId: string,
    teamMemberId: string,
  ): Promise<string[]> {
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
      .select(
        'customerId serviceType serviceDate nextServiceDate warrantyExpiry',
      )
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

  // A due feed is work still to be done. A completed job is not that, and
  // the Services list has always asked the server for status: 'pending' —
  // Home kept showing a job under "Overdue" after it had been completed.
  //
  // Warranty alerts deliberately keep NOT_CANCELLED instead: a warranty only
  // exists on work that has been carried out, so pending-only would empty
  // that feed.
  static readonly PENDING_ONLY = { status: 'pending' };

  // "To book": a reminder that needs the owner now — the customer was already
  // messaged, or the date is within a week (or past). A reminder months away
  // is not on this list yet.
  private toBookFilter(): Record<string, unknown> {
    const soon = new Date();
    soon.setHours(0, 0, 0, 0);
    soon.setDate(soon.getDate() + 8);
    return {
      status: 'pending',
      booked: { $ne: true },
      $or: [
        { lastRemindedAt: { $exists: true, $ne: null } },
        { serviceDate: { $lt: soon } },
      ],
    };
  }

  // A new pending visit is booked only when the person logging it says the
  // customer agreed. Older apps do not say: near-term (today or tomorrow) is
  // treated as booked, anything further out as a reminder date.
  private bookingOnCreate(
    booked: boolean | undefined,
    serviceDate: Date,
    visitSlot?: string,
  ): { booked: boolean; visitSlot?: string } {
    let isBooked = booked;
    if (isBooked === undefined) {
      const endOfTomorrow = new Date();
      endOfTomorrow.setHours(0, 0, 0, 0);
      endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
      isBooked = new Date(serviceDate) < endOfTomorrow;
    }
    return isBooked
      ? { booked: true, ...(visitSlot ? { visitSlot } : {}) }
      : { booked: false };
  }

  // Dispatching a job to a technician on WhatsApp sends them there: it is booked.
  async markBooked(businessId: string, serviceId: string): Promise<void> {
    await this.serviceModel
      .updateOne(
        {
          _id: serviceId,
          businessId: idFilter(businessId),
          booked: { $ne: true },
        },
        { $set: { booked: true } },
      )
      .exec();
  }

  /**
   * One day's booked work, split by technician — the owner's "Team day".
   * Each job counts for its own technician, or the customer's default one
   * when it has none; a job with neither (or with someone no longer active)
   * is "not assigned". Also counts due visits in the range still to book.
   */
  async dayBoard(
    businessId: string,
    viewer: AuthenticatedBusiness,
    from: Date,
    to: Date,
  ) {
    if (viewer.role === 'technician') {
      throw new ForbiddenException('Only the owner can see the team day.');
    }
    await this.amcService.syncAmcServices(businessId);
    const range = { $gte: from, $lt: to };
    const [jobs, notBooked, members] = await Promise.all([
      this.serviceModel
        .find({
          businessId: idFilter(businessId),
          status: 'pending',
          booked: true,
          serviceDate: range,
        })
        .sort({ serviceDate: 1, _id: 1 })
        .limit(500)
        .populate('customerId', 'name phone address assignedTechnicianId')
        .exec(),
      this.serviceModel
        .countDocuments({
          businessId: idFilter(businessId),
          status: 'pending',
          booked: { $ne: true },
          serviceDate: range,
        })
        .exec(),
      this.teamMembersService.findAllForBusiness(businessId),
    ]);
    const active = new Map(
      (
        members as unknown as {
          _id: Types.ObjectId;
          name: string;
          active: boolean;
        }[]
      )
        .filter((m) => m.active)
        .map((m) => [m._id.toString(), m.name]),
    );
    const groups = new Map<string, unknown[]>();
    for (const id of active.keys()) groups.set(id, []);
    const unassigned: unknown[] = [];
    for (const job of jobs) {
      const customer = job.customerId as unknown as {
        _id: Types.ObjectId;
        name?: string;
        phone?: string;
        address?: string;
        assignedTechnicianId?: unknown;
      } | null;
      const own = job.assignedTechnicianId
        ? String(job.assignedTechnicianId)
        : '';
      const fallback = customer?.assignedTechnicianId
        ? String(customer.assignedTechnicianId)
        : '';
      const tech = own || fallback;
      const row = {
        _id: job._id.toString(),
        serviceType: job.serviceType,
        serviceDate: job.serviceDate,
        visitSlot: job.visitSlot ?? null,
        customerName: customer?.name ?? '',
        customerAddress: customer?.address ?? '',
        viaCustomerDefault: !own && !!fallback,
      };
      if (tech && active.has(tech)) groups.get(tech)!.push(row);
      else unassigned.push(row);
    }
    return {
      members: [...active.entries()]
        .map(([id, name]) => ({
          teamMemberId: id,
          name,
          jobs: groups.get(id)!,
        }))
        .sort(
          (a, b) =>
            b.jobs.length - a.jobs.length || a.name.localeCompare(b.name),
        ),
      unassigned,
      notBooked,
    };
  }

  /**
   * Moves several jobs to one technician (or to nobody) at once — "move all
   * of Ravi's jobs today to Suresh" when someone is off.
   */
  async reassignMany(
    businessId: string,
    viewer: AuthenticatedBusiness,
    serviceIds: string[],
    technicianId: string | null,
  ): Promise<{ moved: number }> {
    if (viewer.role === 'technician') {
      throw new ForbiddenException('Only the owner can reassign jobs.');
    }
    if (technicianId)
      await this.teamMembersService.assertActiveMember(
        businessId,
        technicianId,
      );
    const ids = serviceIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const res = await this.serviceModel
      .updateMany(
        {
          _id: { $in: ids },
          businessId: idFilter(businessId),
          status: 'pending',
        },
        technicianId
          ? {
              $set: {
                assignedTechnicianId: new Types.ObjectId(technicianId),
                booked: true,
              },
            }
          : { $unset: { assignedTechnicianId: 1 } },
      )
      .exec();
    return { moved: res.modifiedCount };
  }

  // A technician is sent to booked visits only; a due one is the owner's to
  // arrange first.
  private technicianBookedOnly(
    viewer?: AuthenticatedBusiness,
  ): Record<string, unknown> {
    return viewer?.role === 'technician' ? { booked: true } : {};
  }

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
      {
        serviceDate: { $gte: from, $lt: to },
        ...this.technicianBookedOnly(viewer),
      },
      'serviceDate',
      viewer,
      limit,
      ServicesService.PENDING_ONLY,
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
      { serviceDate: { $lt: before }, ...this.technicianBookedOnly(viewer) },
      'serviceDate',
      viewer,
      limit,
      ServicesService.PENDING_ONLY,
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
    statusFilter: Record<string, unknown> = ServicesService.NOT_CANCELLED,
  ): Promise<number> {
    return this.serviceModel
      .countDocuments(
        andFilters(
          { businessId },
          statusFilter,
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
    statusFilter: Record<string, unknown> = ServicesService.NOT_CANCELLED,
  ): Promise<ServiceDocument[]> {
    const query = this.serviceModel
      .find(
        andFilters(
          { businessId },
          statusFilter,
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
      .select(
        '+beforePhotoKey +beforePhotoContentType +afterPhotoKey +afterPhotoContentType',
      )
      .exec();

    if (!service) throw new NotFoundException('Service not found');

    const key =
      kind === 'before' ? service.beforePhotoKey : service.afterPhotoKey;
    const contentType =
      kind === 'before'
        ? service.beforePhotoContentType
        : service.afterPhotoContentType;

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

    const key =
      kind === 'before' ? service.beforePhotoKey : service.afterPhotoKey;
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
