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
    const digitsOnly = phone.replace(/[^\d]/g, '');
    return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
  }

  // Daily sweep across all businesses. Push notifications are not wired up yet —
  // this is where an FCM dispatch call would go once the mobile app registers
  // device tokens. For now it just logs counts so the pipeline is testable end-to-end.
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async computeDueTodayForAllBusinesses(): Promise<void> {
    const businesses = await this.businessModel
      .find()
      .select('_id name')
      .exec();
    for (const business of businesses) {
      const due = await this.dueToday(business.id);
      if (due.length > 0) {
        this.logger.log(`${business.name}: ${due.length} service(s) due today`);
        // TODO: dispatch FCM push notification(s) to this business's registered device(s).
      }
    }
  }
}
