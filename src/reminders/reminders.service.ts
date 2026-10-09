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
import {
  DEFAULT_TEMPLATES,
  MessageLanguage,
  dueWording,
  messageLanguage,
  renderMessageTemplate,
  slotWording,
} from '../common/utils/message-template';
import { toWhatsAppNumber } from '../common/utils/phone';
import { BusinessesService } from '../businesses/businesses.service';
import { TeamMembersService } from '../team-members/team-members.service';
import { ExpoPushService, PushMessage } from '../common/push/expo-push.service';
import { DEFAULT_TIMEZONE, isSendHourIn, startOfLocalDay } from '../common/utils/timezone';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Dates inside a message, in the message's language: "30 Sept 2026" /
// "30 सित॰ 2026".
//
// Read in the business's timezone (India by default): the server runs in UTC,
// and a date saved as local midnight would otherwise print as the day before.
export function formatMessageDate(
  date: Date,
  lang: MessageLanguage = 'en',
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  try {
    return new Date(date).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { ...opts, timeZone: timezone });
  } catch {
    return new Date(date).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { ...opts, timeZone: DEFAULT_TIMEZONE });
  }
}

// 8 AM in the business's own timezone — early enough to plan the day, late
// enough not to wake anyone.
const REMINDER_SEND_HOUR = 8;

// Home's warranty alerts: running out within this many days ahead (the same
// "expiring soon" window as the app's warranty pill)…
export const WARRANTY_AHEAD_DAYS = 14;
// …or run out within this many days behind.
export const WARRANTY_BEHIND_DAYS = 30;

// What Home's reminder rows read off the customer: the name on the row and
// the number the WhatsApp reminder goes to.
const SUMMARY_CUSTOMER_FIELDS = 'name phone';

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

  // The business's own timezone, for "today" and dates in messages.
  private async timezoneOf(businessId: string): Promise<string> {
    const b = await this.businessModel.findById(businessId).select('timezone').lean().exec().catch(() => null);
    return (b as { timezone?: string } | null)?.timezone || DEFAULT_TIMEZONE;
  }

  dueToday(
    businessId: string,
    viewer?: AuthenticatedBusiness,
    timezone?: string,
  ) {
    const from = startOfLocalDay(timezone, new Date());
    const to = addDays(from, 1);
    return this.servicesService.findDueBetween(businessId, from, to, viewer);
  }

  dueSoon(
    businessId: string,
    days: number,
    viewer?: AuthenticatedBusiness,
    timezone?: string,
  ) {
    const from = addDays(startOfLocalDay(timezone, new Date()), 1);
    const to = addDays(startOfLocalDay(timezone, new Date()), days + 1);
    return this.servicesService.findDueBetween(businessId, from, to, viewer);
  }

  overdue(
    businessId: string,
    viewer?: AuthenticatedBusiness,
    timezone?: string,
  ) {
    const before = startOfLocalDay(timezone, new Date());
    return this.servicesService.findOverdue(businessId, before, viewer);
  }

  // "Expiring soon" window matches the client's warranty-status bucketing (14 days).
  warrantyAlerts(
    businessId: string,
    viewer?: AuthenticatedBusiness,
    timezone?: string,
  ) {
    const expiringBefore = addDays(startOfLocalDay(timezone, new Date()), 14);
    return this.servicesService.findWarrantyAlerts(
      businessId,
      expiringBefore,
      viewer,
    );
  }

  /**
   * Everything Home needs, capped, in one request.
   *
   * Home used to call four unpaged reminder feeds and the customer list —
   * five round trips, and on a busy business the overdue feed alone was
   * 482 KB and rendered as several hundred cards, which froze the app. It is
   * a dashboard: it wants the next few of each kind plus a count, and a way
   * through to the full list.
   */
  async summary(
    businessId: string,
    viewer?: AuthenticatedBusiness,
    options: { days?: number; limit?: number; timezone?: string } = {},
  ) {
    const days = options.days ?? 7;
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    // Everything the feeds below share, fetched together: the business's
    // timezone (every window depends on it), the AMC visit sync and a
    // technician's scope (every feed waits on those).
    const [timezone] = await Promise.all([
      options.timezone ?? this.timezoneOf(businessId),
      this.servicesService.prepareReminderReads(businessId, viewer),
    ]);
    const startOfToday = startOfLocalDay(timezone, new Date());
    const tomorrow = addDays(startOfToday, 1);
    const soonEnd = addDays(startOfToday, days + 1);
    // Warranty alerts are the ones worth acting on: running out within the
    // next WARRANTY_AHEAD_DAYS (offer an extension or an AMC while it is
    // still live), or run out within the last WARRANTY_BEHIND_DAYS (still a
    // warm conversation). The feed used to have no lower bound at all —
    // every warranty that had ever expired, oldest first — so a business a
    // few years in saw its preview filled with long-dead warranties and the
    // ones about to lapse pushed out of sight. Expiring ones come first,
    // soonest first; then the recently expired, most recent first.
    const warrantyBefore = addDays(startOfToday, WARRANTY_AHEAD_DAYS);
    const warrantySince = addDays(startOfToday, -WARRANTY_BEHIND_DAYS);

    // serviceDate, matching the row queries below and the Services list.
    // These counts read nextServiceDate while the rows they label were
    // selected on serviceDate, so a section could say "3 overdue" above a
    // different number of cards.
    const windows = {
      overdue: { serviceDate: { $lt: startOfToday } },
      dueToday: { serviceDate: { $gte: startOfToday, $lt: tomorrow } },
      dueSoon: { serviceDate: { $gte: tomorrow, $lt: soonEnd } },
      warrantyAlerts: {
        warrantyExpiry: { $gte: warrantySince, $lt: warrantyBefore },
      },
    };

    const [
      overdue,
      dueToday,
      dueSoon,
      warrantyAlerts,
      overdueTotal,
      dueTodayTotal,
      dueSoonTotal,
      warrantyTotal,
    ] = await Promise.all([
      this.servicesService.findOverdue(
        businessId,
        startOfToday,
        viewer,
        limit,
        SUMMARY_CUSTOMER_FIELDS,
      ),
      this.servicesService.findDueBetween(
        businessId,
        startOfToday,
        tomorrow,
        viewer,
        limit,
        SUMMARY_CUSTOMER_FIELDS,
      ),
      this.servicesService.findDueBetween(
        businessId,
        tomorrow,
        soonEnd,
        viewer,
        limit,
        SUMMARY_CUSTOMER_FIELDS,
      ),
      this.servicesService.findWarrantyFeed(
        businessId,
        {
          today: startOfToday,
          expiringBefore: warrantyBefore,
          expiredSince: warrantySince,
        },
        viewer,
        limit,
        SUMMARY_CUSTOMER_FIELDS,
      ),
      // Pending-only for the three due feeds, so the counts match the rows.
      // Warranty alerts stay on the default (not-cancelled): a warranty
      // exists only on work already carried out.
      this.servicesService.countReminders(
        businessId,
        windows.overdue,
        viewer,
        ServicesService.PENDING_ONLY,
      ),
      this.servicesService.countReminders(
        businessId,
        windows.dueToday,
        viewer,
        ServicesService.PENDING_ONLY,
      ),
      this.servicesService.countReminders(
        businessId,
        windows.dueSoon,
        viewer,
        ServicesService.PENDING_ONLY,
      ),
      this.servicesService.countReminders(
        businessId,
        windows.warrantyAlerts,
        viewer,
      ),
    ]);

    return {
      days,
      limit,
      overdue: { items: overdue, total: overdueTotal },
      dueToday: { items: dueToday, total: dueTodayTotal },
      dueSoon: { items: dueSoon, total: dueSoonTotal },
      warrantyAlerts: { items: warrantyAlerts, total: warrantyTotal },
    };
  }

  // --- Message building ---------------------------------------------------
  //
  // Every WhatsApp text the app prepares is assembled here, in the business's
  // chosen language, from the business's own template where it has one.

  /**
   * "Service due" for a visit that has not been done. The date is the date
   * THIS visit is due (serviceDate) — nextServiceDate is the visit after it,
   * which is what reminders used to print. Wording precedence: the service
   * type's own preset message, then the business-wide reminder, then ours;
   * a second reminder for the same visit uses the gentler follow-up unless
   * the business has written its own.
   */
  buildServiceDueMessage(input: {
    service: {
      serviceType: string;
      serviceDate: Date;
      lastRemindedAt?: Date | null;
      booked?: boolean;
      visitSlot?: string;
    };
    customerName: string;
    business: { name: string; language?: string; reminderTemplate?: string };
    presetTemplate?: string;
  }): string {
    const lang = messageLanguage(input.business.language);
    const dueDate = formatMessageDate(input.service.serviceDate, lang);
    // Booked (the customer agreed a day) and still ahead: a confirmation.
    // "Shall we book a visit?" to someone who already booked one confuses them.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (
      input.service.booked === true &&
      new Date(input.service.serviceDate) >= today
    ) {
      return renderMessageTemplate(DEFAULT_TEMPLATES.visitConfirm[lang], {
        customerName: input.customerName,
        businessName: input.business.name,
        serviceType: input.service.serviceType,
        dueDate,
        slotText: slotWording(lang, input.service.visitSlot),
      });
    }
    const custom =
      input.presetTemplate?.trim() || input.business.reminderTemplate?.trim();
    const template =
      custom ||
      (input.service.lastRemindedAt
        ? DEFAULT_TEMPLATES.reminderFollowUp[lang]
        : DEFAULT_TEMPLATES.reminder[lang]);
    return renderMessageTemplate(template, {
      customerName: input.customerName,
      businessName: input.business.name,
      serviceType: input.service.serviceType,
      dueDate,
      // Alias kept for templates written with the old "Next due date" chip.
      nextServiceDate: dueDate,
    });
  }

  buildServiceCardMessage(
    vars: {
      customerName: string;
      businessName: string;
      serviceType: string;
      status: string;
      serviceDate: string;
      completedLine: string;
      warranty: string;
      nextServiceDate: string;
      businessContact: string;
      reviewLine?: string;
      // "Your service record: <link>", with its own leading newlines.
      recordLine?: string;
      // "Amount ₹… — pay here: <link>" when the job has been invoiced.
      invoiceLine?: string;
    },
    template?: string,
    language?: string,
  ): string {
    const lang = messageLanguage(language);
    let chosen = template?.trim() || DEFAULT_TEMPLATES.card[lang];
    // The record link is what the customer keeps and books again from, so a
    // custom message that does not place it still gets it, at the end.
    if (vars.recordLine && !chosen.includes('{recordLine}'))
      chosen += '{recordLine}';
    // Same for the bill: a job's record and its invoice go in one message.
    if (vars.invoiceLine && !chosen.includes('{invoiceLine}'))
      chosen += '{invoiceLine}';
    return renderMessageTemplate(chosen, {
      ...vars,
      reviewLine: vars.reviewLine ?? '',
      recordLine: vars.recordLine ?? '',
      invoiceLine: vars.invoiceLine ?? '',
    });
  }

  buildPaymentReminderMessage(input: {
    customerName: string;
    businessName: string;
    invoiceNumber: string;
    balanceDue: string;
    dueDate: Date;
    language?: string;
    template?: string;
    upiId?: string;
    invoiceUrl?: string;
  }): string {
    const lang = messageLanguage(input.language);
    const dueDate = formatMessageDate(input.dueDate, lang);
    const isPast =
      startOfDay(input.dueDate).getTime() < startOfDay(new Date()).getTime();
    const paymentLine = input.upiId
      ? lang === 'hi'
        ? `\n\nUPI से भुगतान करें: ${input.upiId}`
        : `\n\nPay by UPI: ${input.upiId}`
      : '';
    const invoiceLink = input.invoiceUrl
      ? lang === 'hi'
        ? `\nऑनलाइन भुगतान करें या इनवॉइस देखें: ${input.invoiceUrl}`
        : `\nPay online or view the invoice: ${input.invoiceUrl}`
      : '';
    return renderMessageTemplate(
      input.template?.trim() || DEFAULT_TEMPLATES.payment[lang],
      {
        customerName: input.customerName,
        businessName: input.businessName,
        invoiceNumber: input.invoiceNumber,
        balanceDue: input.balanceDue,
        dueDate,
        dueLine: dueWording(lang, dueDate, isPast),
        paymentLine,
        invoiceLink,
      },
    );
  }

  /**
   * Job dispatch to a technician. Built here so the three screens that send
   * it say the same thing. The map link uses the saved GPS pin when there is
   * one — an exact point — and falls back to searching the typed address.
   */
  buildDispatchMessage(input: {
    businessName: string;
    language?: string;
    technicianName: string;
    customer: {
      name: string;
      phone?: string;
      address?: string;
      location?: { latitude: number; longitude: number } | null;
    };
    serviceType: string;
    dueDate: Date;
    visitSlot?: string;
    notes?: string;
  }): string {
    const lang = messageLanguage(input.language);
    const { customer } = input;
    const pin = customer.location;
    const mapUrl = pin
      ? `https://maps.google.com/?q=${pin.latitude},${pin.longitude}`
      : customer.address
        ? `https://maps.google.com/?q=${encodeURIComponent(customer.address)}`
        : '';
    const label = (en: string, hi: string) => (lang === 'hi' ? hi : en);
    return renderMessageTemplate(DEFAULT_TEMPLATES.dispatch[lang], {
      businessName: input.businessName,
      technicianName: input.technicianName,
      customerName: customer.name,
      customerPhone: customer.phone || '—',
      serviceType: input.serviceType,
      dueDate:
        formatMessageDate(input.dueDate, lang) +
        slotWording(lang, input.visitSlot),
      addressLine: customer.address
        ? `📍 *${label('Address', 'पता')}:* ${customer.address}\n`
        : '',
      mapLine: mapUrl ? `🗺️ *${label('Map', 'मैप')}:* ${mapUrl}\n` : '',
      notesLine: input.notes?.trim()
        ? `📝 *${label('Notes', 'नोट्स')}:* ${input.notes.trim()}\n`
        : '',
    });
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
      .find({
        $or: [{ pushToken: { $exists: true, $ne: '' } }, { 'pushTokens.0': { $exists: true } }],
      })
      .select('_id name pushToken pushTokens timezone')
      .exec();

    // Only the businesses whose local morning it is right now.
    const dueNow = businesses.filter((business) =>
      isSendHourIn(business.timezone, now, REMINDER_SEND_HOUR),
    );
    if (!dueNow.length) return;

    const messages: PushMessage[] = [];

    for (const business of dueNow) {
      const businessId = business.id as string;

      // Owner: everything due and overdue across the whole business, on
      // every phone they are signed in on.
      const [ownerToday, ownerOverdue] = await Promise.all([
        this.dueToday(businessId, undefined, business.timezone),
        this.overdue(businessId, undefined, business.timezone),
      ]);
      const ownerPush = buildMorningPush(ownerToday.length, ownerOverdue.length);
      if (ownerPush) {
        for (const token of this.businessesService.ownerPushTokens(business)) {
          messages.push({ to: token, ...ownerPush });
        }
      }

      // Technicians: only what is actually assigned to them. Without the
      // per-viewer scope every technician would be told the owner's total.
      // A manager runs the whole day, so they are told the business's count.
      const technicians =
        await this.teamMembersService.findNotifiableForBusiness(businessId);
      for (const technician of technicians) {
        if (!technician.pushToken) continue;
        const viewer = {
          businessId,
          role: technician.role === 'manager' ? 'manager' : 'technician',
          teamMemberId: technician.id as string,
        } as AuthenticatedBusiness;
        const [theirToday, theirOverdue] = await Promise.all([
          this.dueToday(businessId, viewer, business.timezone),
          this.overdue(businessId, viewer, business.timezone),
        ]);
        const push = buildMorningPush(theirToday.length, theirOverdue.length);
        if (push) messages.push({ to: technician.pushToken, ...push });
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

}

/**
 * The 8 AM push: what is due today and what is overdue, one line each way.
 * Tapping it opens the list that matters most — overdue first. Nothing due
 * and nothing overdue: no push at all.
 */
export function buildMorningPush(
  today: number,
  overdue: number,
): Omit<PushMessage, 'to'> | null {
  if (!today && !overdue) return null;
  const services = (n: number) => `${n} service${n === 1 ? '' : 's'}`;
  const title =
    today && overdue
      ? `${services(today)} due today · ${overdue} overdue`
      : today
        ? `${services(today)} due today`
        : `${services(overdue)} overdue`;
  const body =
    today && overdue
      ? `Start with the ${overdue} overdue — tap to see who.`
      : today
        ? today === 1
          ? 'One customer is due for service today. Tap to see who.'
          : `${today} customers are due for service today. Tap to see who.`
        : overdue === 1
          ? 'One customer is past their service date. Tap to remind them.'
          : `${overdue} customers are past their service date. Tap to remind them.`;
  return { title, body, data: { screen: 'Services', filter: overdue ? 'overdue' : 'today' } };
}
