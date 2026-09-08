import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ServicesService } from '../services/services.service';
import type { AuthenticatedBusiness } from '../common/decorators/current-business.decorator';
import {
  Business,
  BusinessDocument,
} from '../businesses/schemas/business.schema';
import { DEFAULT_REMINDER_TEMPLATE, renderMessageTemplate } from '../common/utils/message-template';
import { toWhatsAppNumber } from '../common/utils/phone';
import { BusinessesService } from '../businesses/businesses.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { ExpoPushService, PushMessage } from '../common/push/expo-push.service';
import { isSendHourIn, startOfLocalDay } from '../common/utils/timezone';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// 8 AM in the business's own timezone — early enough to plan the day, late
// enough not to wake anyone.
const REMINDER_SEND_HOUR = 8;

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly servicesService: ServicesService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    private readonly businessesService: BusinessesService,
    private readonly teamMembersService: TeamMembersService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  dueToday(businessId: string, viewer?: AuthenticatedBusiness, timezone?: string) {
    const from = startOfLocalDay(timezone, new Date());
    const to = addDays(from, 1);
    return this.servicesService.findDueBetween(businessId, from, to, viewer);
  }

  dueSoon(businessId: string, days: number, viewer?: AuthenticatedBusiness, timezone?: string) {
    const from = addDays(startOfLocalDay(timezone, new Date()), 1);
    const to = addDays(startOfLocalDay(timezone, new Date()), days + 1);
    return this.servicesService.findDueBetween(businessId, from, to, viewer);
  }

  overdue(businessId: string, viewer?: AuthenticatedBusiness, timezone?: string) {
    const before = startOfLocalDay(timezone, new Date());
    return this.servicesService.findOverdue(businessId, before, viewer);
  }

  // "Expiring soon" window matches the client's warranty-status bucketing (14 days).
  warrantyAlerts(businessId: string, viewer?: AuthenticatedBusiness, timezone?: string) {
    const expiringBefore = addDays(startOfLocalDay(timezone, new Date()), 14);
    return this.servicesService.findWarrantyAlerts(businessId, expiringBefore, viewer);
  }

  buildWhatsAppMessage(
    vars: { customerName: string; businessName: string; serviceType: string; nextServiceDate: string },
    template?: string,
  ): string {
    return renderMessageTemplate(template?.trim() || DEFAULT_REMINDER_TEMPLATE, vars);
  }

  buildWhatsAppLink(phone: string, message: string): string {
    return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;
  }

  // Hourly sweep. Each business is notified when it is 8 AM in *their*
  // timezone, so the same job serves India, the Gulf and the US correctly —
  // this used to run once a day on server time, which meant a Dubai
  // business was pinged at 6:30 AM and a US one overnight.
  //
  // Everything is gathered first and pushed in batches, rather than one HTTP
  // request per business inside a sequential loop.
  @Cron(CronExpression.EVERY_HOUR)
  async dispatchDueTodayReminders(): Promise<void> {
    const now = new Date();

    const businesses = await this.businessModel
      .find({ pushToken: { $exists: true, $ne: '' } })
      .select('_id name pushToken timezone')
      .exec();

    // Only the businesses whose local morning it is right now.
    const dueNow = businesses.filter((business) =>
      isSendHourIn(business.timezone, now, REMINDER_SEND_HOUR),
    );
    if (!dueNow.length) return;

    const messages: PushMessage[] = [];

    for (const business of dueNow) {
      const businessId = business.id as string;

      // Owner: everything due across the whole business.
      const ownerDue = await this.dueToday(businessId, undefined, business.timezone);
      if (ownerDue.length && business.pushToken) {
        messages.push(this.buildDuePush(business.pushToken, ownerDue.length));
      }

      // Technicians: only what is actually assigned to them. Without the
      // per-viewer scope every technician would be told the owner's total.
      const technicians =
        await this.teamMembersService.findNotifiableForBusiness(businessId);
      for (const technician of technicians) {
        if (!technician.pushToken) continue;
        const theirDue = await this.dueToday(
          businessId,
          {
            businessId,
            role: 'technician',
            teamMemberId: technician.id as string,
          },
          business.timezone,
        );
        if (theirDue.length) {
          messages.push(this.buildDuePush(technician.pushToken, theirDue.length));
        }
      }
    }

    if (!messages.length) return;

    const outcome = await this.expoPushService.send(messages);
    this.logger.log(
      `Reminder push: ${outcome.sent} sent, ${outcome.failed} failed, ` +
        `${outcome.invalidTokens.length} dead token(s) across ${dueNow.length} business(es)`,
    );

    // Drop tokens Expo says are gone, so they are not retried every day.
    if (outcome.invalidTokens.length) {
      await Promise.all([
        this.businessesService.clearPushTokens(outcome.invalidTokens),
        this.teamMembersService.clearPushTokens(outcome.invalidTokens),
      ]);
    }
  }

  private buildDuePush(token: string, dueCount: number): PushMessage {
    const plural = dueCount === 1 ? 'service' : 'services';
    return {
      to: token,
      title: `${dueCount} ${plural} due today`,
      body:
        dueCount === 1
          ? 'One customer is due for service today. Tap to see who.'
          : `${dueCount} customers are due for service today. Tap to see who.`,
      data: { screen: 'Reminders' },
    };
  }
}
