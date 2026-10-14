import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/schemas/business.schema';
import { Customer, CustomerDocument } from '../customers/schemas/customer.schema';
import { Service, ServiceDocument } from '../services/schemas/service.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { ExpoPushService } from '../common/push/expo-push.service';
import { ownerPushTokens } from '../common/push/owner-tokens';
import { localHourIn } from '../common/utils/timezone';
import { idFilter } from '../common/utils/id-match';
import { EmailService } from '../common/email/email.service';
import { NUDGES_PER_STAGE, OnboardingStage, onboardingNudge, setupEmail } from './onboarding-copy';

// Local times owners look at their phone: before the day's jobs, and after.
// The cron runs at :30, so these are 10:30 and 19:30.
const SEND_HOURS = [10, 19];
// Hours to wait before each nudge of a stage: the first soon after sign-up,
// then roughly 1, 2, 4 and 7 days apart — never two in one day.
const WAIT_HOURS = [2, 20, 44, 92, 164];
// A stage reached later (customers added, no service yet) waits this long
// after the last nudge, so moving on never doubles up a day.
const STAGE_CHANGE_WAIT_HOURS = 20;
// Owners who signed up longer ago than this are left to the normal pushes.
const WINDOW_DAYS = 30;
const HOUR = 3600_000;

interface NudgeState {
  stage?: OnboardingStage;
  count?: number;
  lastAt?: Date;
  done?: boolean;
}

/**
 * Brings a new owner back until the app is working for them: a customer
 * added, then that customer's last service logged (which sets the first
 * automatic reminder). Each step gets up to five pushes at good local times,
 * at most one a day; the series stops the moment the step is done and the
 * next step's begins. Once both are done, the 8 AM due-service push takes over.
 */
@Injectable()
export class OnboardingPushService {
  private readonly logger = new Logger(OnboardingPushService.name);

  constructor(
    @InjectModel(Business.name) private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Service.name) private readonly serviceModel: Model<ServiceDocument>,
    private readonly businesses: BusinessesService,
    private readonly push: ExpoPushService,
    private readonly email: EmailService,
  ) {}

  @Cron('30 * * * *')
  async run(now: Date = new Date()): Promise<number> {
    const owners = await this.businessModel
      .find({
        createdAt: { $gte: new Date(now.getTime() - WINDOW_DAYS * 24 * HOUR) },
        'onboardingNudge.done': { $ne: true },
        $or: [{ pushToken: { $exists: true, $ne: '' } }, { 'pushTokens.0': { $exists: true } }],
      })
      .select('name tradeType language timezone createdAt phone email pushToken pushTokens onboardingNudge')
      .limit(5000)
      .lean()
      .exec();

    let sent = 0;
    for (const b of owners) {
      if (!SEND_HOURS.includes(localHourIn(b.timezone, now))) continue;
      try {
        if (await this.nudge(b, now)) sent++;
      } catch (err) {
        this.logger.warn(`Onboarding nudge for ${String(b._id)} failed: ${(err as Error).message}`);
      }
    }
    if (sent) this.logger.log(`Onboarding nudges sent: ${sent}`);
    return sent;
  }

  /** Where this owner is: setup unfinished, no customer yet, no service yet, or done. */
  async stageOf(b: { _id: Types.ObjectId | string; phone?: string; tradeType?: string }): Promise<{ stage: OnboardingStage | null; customerName?: string }> {
    // The app opens on the setup screen until both are in (RootNavigator).
    if (!b.phone || !b.tradeType) return { stage: 'setup' };
    const id = String(b._id);
    const customer = await this.customerModel
      .findOne({ businessId: idFilter(id) })
      .sort({ createdAt: -1 })
      .select('name')
      .lean()
      .exec();
    if (!customer) return { stage: 'customer' };
    if (await this.serviceModel.exists({ businessId: idFilter(id) }).exec()) return { stage: null };
    return { stage: 'service', customerName: (customer as any).name };
  }

  private async nudge(b: any, now: Date): Promise<boolean> {
    const { stage, customerName } = await this.stageOf(b);
    if (!stage) {
      await this.businessModel.updateOne({ _id: b._id }, { $set: { 'onboardingNudge.done': true } }).exec();
      return false;
    }

    const prev: NudgeState = b.onboardingNudge ?? {};
    const sameStage = prev.stage === stage;
    const count = sameStage ? prev.count ?? 0 : 0;
    if (count >= NUDGES_PER_STAGE) return false;

    const ref = prev.lastAt ? new Date(prev.lastAt) : new Date(b.createdAt);
    const wait = !sameStage && prev.lastAt ? STAGE_CHANGE_WAIT_HOURS : WAIT_HOURS[count];
    if (now.getTime() - ref.getTime() < wait * HOUR) return false;

    const msg = onboardingNudge(stage, count, {
      businessName: b.name,
      tradeType: b.tradeType,
      language: b.language,
      customerName,
    });
    if (!msg) return false;
    const tokens = ownerPushTokens(b);
    const outcome = tokens.length
      ? await this.push.send(
          tokens.map((to) => ({ to, title: msg.title, body: msg.body, data: { ...msg.data, type: 'onboarding' } })),
        )
      : { sent: 0, failed: 0, invalidTokens: [] as string[] };
    if (outcome.invalidTokens.length) await this.businesses.clearPushTokens(outcome.invalidTokens);

    // Unfinished setup: email too — notifications may be off, and it's the
    // only other way to reach them (no phone yet). Apple's private-relay
    // addresses are skipped.
    let emailed = false;
    const mail = stage === 'setup' ? setupEmail(count) : null;
    if (mail && b.email && !/privaterelay\.appleid\.com$/i.test(b.email)) {
      try {
        await this.email.sendPlain(b.email, mail.subject, mail.text);
        emailed = true;
      } catch (err) {
        this.logger.warn(`Setup email to business ${String(b._id)} failed: ${(err as Error).message}`);
      }
    }
    if (!outcome.sent && !emailed && !tokens.length) return false;
    // Counted even if delivery failed for every phone: retrying hourly
    // would turn one nudge into many.
    await this.businessModel
      .updateOne({ _id: b._id }, { $set: { onboardingNudge: { stage, count: count + 1, lastAt: now } } })
      .exec();
    return outcome.sent > 0 || emailed;
  }
}
