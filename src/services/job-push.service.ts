import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Service, ServiceDocument } from './schemas/service.schema';
import {
  Business,
  BusinessDocument,
} from '../businesses/schemas/business.schema';
import { TeamMembersService } from '../team-members/team-members.service';
import {
  ExpoPushService,
  PushMessage,
} from '../common/push/expo-push.service';
import { DEFAULT_TIMEZONE } from '../common/utils/timezone';
import { ownerPushTokens } from '../common/push/owner-tokens';

const SLOT_NAMES: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

/**
 * Tells a technician the moment a job lands on their list — booked for them,
 * or moved to them from someone else — instead of them finding it at 8 AM.
 *
 * Never throws and is never awaited by the request that triggered it: a push
 * that fails must not fail the booking.
 */
@Injectable()
export class JobPushService {
  private readonly logger = new Logger(JobPushService.name);

  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    private readonly teamMembersService: TeamMembersService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  /**
   * `technicianId`: who now has the job(s). `actorId`: the team member who
   * made the change, if any — nobody is told about a job they gave themselves.
   */
  notifyNewJobs(
    businessId: string,
    technicianId: string | null | undefined,
    serviceIds: string[],
    actorId?: string,
  ): void {
    if (!technicianId || !serviceIds.length || technicianId === actorId) return;
    void this.send(businessId, technicianId, serviceIds).catch((err) =>
      this.logger.warn(`New-job push failed: ${(err as Error).message}`),
    );
  }

  /**
   * A technician or manager took money at the door: the owner hears it then,
   * not when they next open the Team screen.
   */
  notifyCollection(
    businessId: string,
    collection: Omit<Collection, 'currency' | 'collectorName' | 'customerName'> & {
      collectorId: string;
      customerId: string;
    },
  ): void {
    if (collection.amount <= 0) return;
    void this.sendCollection(businessId, collection).catch((err) =>
      this.logger.warn(`Collection push failed: ${(err as Error).message}`),
    );
  }

  private async sendCollection(
    businessId: string,
    c: Omit<Collection, 'currency' | 'collectorName' | 'customerName'> & {
      collectorId: string;
      customerId: string;
    },
  ): Promise<void> {
    const business = await this.businessModel
      .findById(businessId)
      .select('pushToken pushTokens currency')
      .lean()
      .exec();
    const tokens = business ? ownerPushTokens(business) : [];
    if (!tokens.length) return;

    const [collector, job] = await Promise.all([
      this.teamMembersService.nameOf(businessId, c.collectorId),
      this.serviceModel
        .findById(c.serviceId)
        .populate('customerId', 'name')
        .select('customerId')
        .lean()
        .exec(),
    ]);
    const push = buildCollectionPush({
      ...c,
      currency: business?.currency,
      collectorName: collector ?? undefined,
      customerName:
        (job?.customerId as unknown as { name?: string } | null)?.name ?? undefined,
    });
    const outcome = await this.expoPushService.send(
      tokens.map((to) => ({ to, ...push })),
    );
    if (outcome.invalidTokens.length) {
      await this.businessModel
        .updateOne(
          { _id: businessId },
          { $pull: { pushTokens: { $in: outcome.invalidTokens } } },
        )
        .exec();
    }
  }

  private async send(
    businessId: string,
    technicianId: string,
    serviceIds: string[],
  ): Promise<void> {
    const token = await this.teamMembersService.pushTokenOf(
      businessId,
      technicianId,
    );
    if (!token) return;

    const [jobs, business] = await Promise.all([
      this.serviceModel
        .find({
          _id: { $in: serviceIds.filter((id) => Types.ObjectId.isValid(id)) },
          status: 'pending',
          booked: true,
        })
        .populate('customerId', 'name')
        .select('serviceType serviceDate visitSlot customerId')
        .sort({ serviceDate: 1 })
        .lean()
        .exec(),
      this.businessModel.findById(businessId).select('timezone').lean().exec(),
    ]);
    if (!jobs.length) return;

    const push = buildNewJobPush(
      jobs.map((job) => ({
        id: String(job._id),
        customerName:
          (job.customerId as unknown as { name?: string } | null)?.name ?? '',
        serviceType: job.serviceType,
        serviceDate: job.serviceDate,
        visitSlot: job.visitSlot,
      })),
      business?.timezone,
    );
    const outcome = await this.expoPushService.send([{ to: token, ...push }]);
    if (outcome.invalidTokens.length) {
      await this.teamMembersService.clearPushTokens(outcome.invalidTokens);
    }
  }
}

export interface Collection {
  serviceId: string;
  amount: number;
  method: 'cash' | 'upi';
  currency?: string;
  collectorName?: string;
  customerName?: string;
  serviceType?: string;
}

export function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** "₹1,200 collected by Ravi" — cash still to be handed over, or UPI paid. */
export function buildCollectionPush(c: Collection): Omit<PushMessage, 'to'> {
  const money = formatMoney(c.amount, c.currency);
  const by = c.collectorName ? ` by ${c.collectorName}` : '';
  const how = c.method === 'cash' ? 'Cash' : 'UPI';
  return {
    title: `${money} ${c.method === 'cash' ? 'cash collected' : 'paid by UPI'}${by}`,
    body: [how, c.customerName, c.serviceType].filter(Boolean).join(' · '),
    data: { screen: 'ServiceCard', serviceId: c.serviceId },
  };
}

export interface NewJob {
  id: string;
  customerName: string;
  serviceType: string;
  serviceDate: Date;
  visitSlot?: string | null;
}

/**
 * "Today", "Tomorrow" or "Sat, 12 Oct", in the business's own time zone.
 * A visit date is saved either as UTC midnight of the day or as local
 * midnight; UTC midnight is read as that UTC day, anything else in the zone.
 */
export function jobDayLabel(
  date: Date,
  timezone: string | undefined,
  now = new Date(),
): string {
  const tz = timezone || DEFAULT_TIMEZONE;
  const at = new Date(date);
  const dateZone = at.getTime() % 86_400_000 === 0 ? 'UTC' : tz;
  const dayKey = (d: Date, zone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(d);
  const jobDay = dayKey(at, dateZone);
  const today = dayKey(now, tz);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), tz);
  if (jobDay === today) return 'Today';
  if (jobDay === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: dateZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(at);
}

function slotLabel(slot?: string | null): string {
  if (!slot) return '';
  if (SLOT_NAMES[slot]) return SLOT_NAMES[slot];
  const m = /^(\d{1,2}):(\d{2})$/.exec(slot);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  return `${h % 12 || 12}${min ? `:${m[2]}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function buildNewJobPush(
  jobs: NewJob[],
  timezone: string | undefined,
  now = new Date(),
): Omit<PushMessage, 'to'> {
  if (jobs.length === 1) {
    const job = jobs[0];
    const when = [jobDayLabel(job.serviceDate, timezone, now), slotLabel(job.visitSlot)]
      .filter(Boolean)
      .join(' · ');
    return {
      title: 'New job for you',
      body: [job.customerName, job.serviceType, when].filter(Boolean).join(' · '),
      data: { screen: 'ServiceCard', serviceId: job.id },
    };
  }
  const names = [...new Set(jobs.map((j) => j.customerName).filter(Boolean))];
  const shown = names.slice(0, 2).join(', ');
  const more = names.length > 2 ? ` and ${names.length - 2} more` : '';
  return {
    title: `${jobs.length} new jobs for you`,
    body: shown ? `${shown}${more}. Tap to see your jobs.` : 'Tap to see your jobs.',
    data: { screen: 'Home' },
  };
}
