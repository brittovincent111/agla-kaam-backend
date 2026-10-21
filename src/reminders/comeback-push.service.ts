import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/schemas/business.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { Invoice, InvoiceDocument } from '../invoicing/schemas/invoice.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { ExpoPushService } from '../common/push/expo-push.service';
import { ownerPushTokens } from '../common/push/owner-tokens';
import { localHourIn } from '../common/utils/timezone';
import { idFilter } from '../common/utils/id-match';
import { COMEBACK_AFTER_DAYS, comebackNudge } from './comeback-copy';

// Evening, after the day's jobs: the morning belongs to the 8 AM due push.
// The cron runs at :30, so this is 19:30 local.
const SEND_HOUR = 19;
// At least this long between two of these, so an owner already quiet for
// weeks when this starts isn't sent the whole series on consecutive days.
const MIN_GAP_DAYS = 3;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface ComebackState {
  count?: number;
  lastAt?: Date;
}

/**
 * Brings back an owner who got Agla Kaam working (a customer and a service
 * in — the new-owner nudges' job is done) and then stopped using it: a push
 * after 3, 7, 14 and 30 quiet days, then silence. Any use of the app — a
 * request from it, a customer, service or bill added — counts as back, and
 * the series starts again from the beginning the next time they go quiet.
 */
@Injectable()
export class ComebackPushService {
  private readonly logger = new Logger(ComebackPushService.name);

  constructor(
    @InjectModel(Business.name) private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Service.name) private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    private readonly businesses: BusinessesService,
    private readonly push: ExpoPushService,
  ) {}

  @Cron('30 * * * *')
  async run(now: Date = new Date()): Promise<number> {
    const owners = await this.businessModel
      .find({
        'onboardingNudge.done': true,
        $or: [{ pushToken: { $exists: true, $ne: '' } }, { 'pushTokens.0': { $exists: true } }],
      })
      .select('name tradeType language timezone pushToken pushTokens lastSeenAt sessions.at comebackNudge')
      .limit(5000)
      .lean()
      .exec();

    let sent = 0;
    for (const b of owners) {
      if (localHourIn(b.timezone, now) !== SEND_HOUR) continue;
      try {
        if (await this.nudge(b, now)) sent++;
      } catch (err) {
        this.logger.warn(`Comeback push for ${String(b._id)} failed: ${(err as Error).message}`);
      }
    }
    if (sent) this.logger.log(`Comeback pushes sent: ${sent}`);
    return sent;
  }

  /** The last time anyone at this business used the app or added something. */
  async lastActive(b: any): Promise<Date | null> {
    const id = String(b._id);
    const newest = (model: Model<any>) =>
      model
        .findOne({ businessId: idFilter(id) })
        .sort({ updatedAt: -1 })
        .select('updatedAt')
        .lean()
        .exec()
        .then((r: any) => (r?.updatedAt ? new Date(r.updatedAt).getTime() : 0));
    const times = await Promise.all([newest(this.customerModel), newest(this.serviceModel), newest(this.invoiceModel)]);
    if (b.lastSeenAt) times.push(new Date(b.lastSeenAt).getTime());
    for (const s of b.sessions ?? []) if (s?.at) times.push(new Date(s.at).getTime());
    const max = Math.max(0, ...times);
    return max ? new Date(max) : null;
  }

  private async nudge(b: any, now: Date): Promise<boolean> {
    const active = await this.lastActive(b);
    if (!active) return false;
    const prev: ComebackState = b.comebackNudge ?? {};
    // Used the app since the last push: back, so the series starts over.
    const count = prev.lastAt && active > new Date(prev.lastAt) ? 0 : prev.count ?? 0;
    if (count >= COMEBACK_AFTER_DAYS.length) return false;
    if (now.getTime() - active.getTime() < COMEBACK_AFTER_DAYS[count] * DAY) return false;
    if (prev.lastAt && now.getTime() - new Date(prev.lastAt).getTime() < MIN_GAP_DAYS * DAY - HOUR) return false;

    const id = String(b._id);
    const [customers, dueSoon] = await Promise.all([
      this.customerModel.countDocuments({ businessId: idFilter(id) }).exec(),
      this.serviceModel
        .countDocuments({ businessId: idFilter(id), status: 'pending', serviceDate: { $gte: now, $lt: new Date(now.getTime() + 30 * DAY) } })
        .exec(),
    ]);
    const msg = comebackNudge(count, {
      businessName: b.name,
      tradeType: b.tradeType,
      language: b.language,
      customers,
      dueSoon,
    });
    if (!msg) return false;
    const tokens = ownerPushTokens(b);
    if (!tokens.length) return false;
    const outcome = await this.push.send(
      tokens.map((to) => ({ to, title: msg.title, body: msg.body, data: { ...msg.data, type: 'comeback' } })),
    );
    if (outcome.invalidTokens.length) await this.businesses.clearPushTokens(outcome.invalidTokens);
    // Counted even if every phone failed: retrying hourly would turn one push into many.
    await this.businessModel
      .updateOne({ _id: b._id }, { $set: { comebackNudge: { count: count + 1, lastAt: now } } })
      .exec();
    return outcome.sent > 0;
  }
}
