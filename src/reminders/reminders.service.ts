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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly servicesService: ServicesService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  dueToday(businessId: string, viewer?: AuthenticatedBusiness) {
    const from = startOfDay(new Date());
    const to = addDays(from, 1);
    return this.servicesService.findDueBetween(businessId, from, to, viewer);
  }

  dueSoon(businessId: string, days: number, viewer?: AuthenticatedBusiness) {
    const from = addDays(startOfDay(new Date()), 1);
    const to = addDays(startOfDay(new Date()), days + 1);
    return this.servicesService.findDueBetween(businessId, from, to, viewer);
  }

  overdue(businessId: string, viewer?: AuthenticatedBusiness) {
    const before = startOfDay(new Date());
    return this.servicesService.findOverdue(businessId, before, viewer);
  }

  // "Expiring soon" window matches the client's warranty-status bucketing (14 days).
  warrantyAlerts(businessId: string, viewer?: AuthenticatedBusiness) {
    const expiringBefore = addDays(startOfDay(new Date()), 14);
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

  // Daily morning sweep across all businesses. Dispatches Expo Push Notifications
  // to registered technician devices for services due today.
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async computeDueTodayForAllBusinesses(): Promise<void> {
    const businesses = await this.businessModel
      .find({ pushToken: { $exists: true, $ne: '' } })
      .select('_id name pushToken')
      .exec();

    for (const business of businesses) {
      if (!business.pushToken) continue;
      const due = await this.dueToday(business.id);
      if (due.length > 0) {
        this.logger.log(`Dispatching 8 AM push to ${business.name}: ${due.length} service(s) due today`);

        try {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Accept-encoding': 'gzip, deflate',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify([
              {
                to: business.pushToken,
                sound: 'default',
                title: `🔔 ${due.length} Service(s) Due Today!`,
                body: `You have ${due.length} customer service visit(s) scheduled for today. Tap to open Agla Kaam.`,
                data: { screen: 'Reminders' },
              },
            ]),
          });
        } catch (err: any) {
          this.logger.error(`Failed to dispatch push to ${business.name}: ${err.message}`);
        }
      }
    }
  }
}
