import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AutopilotDay,
  AutopilotDayDocument,
  AutopilotRegion,
  AutopilotRegionDocument,
  AutopilotSettings,
  AutopilotSettingsDocument,
} from './schemas/autopilot.schemas';
import { sendingDaysLeft } from '../common/utils/outreach-budget';
import { TradeKind, kindOf, tradeOf } from '../lead-finder/trades';
import { tradeEmail } from './trade-copy';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_MESSAGES,
  DEFAULT_REGIONS,
  LanguageMessages,
  allocate,
  istDayKey,
  istDayStart,
  istDaysLeftInMonth,
  splitByWeight,
  textToHtml,
} from './autopilot-defaults';
import { Lead, LeadDocument } from '../lead-finder/schemas/lead.schema';
import { LeadSearchJob, LeadSearchJobDocument } from '../lead-finder/schemas/lead-search-job.schema';
import { LeadSearchJobService } from '../lead-finder/lead-search-job.service';
import { ProviderUsageService } from '../lead-finder/provider-usage.service';
import { EmailFinderService } from '../lead-finder/email-finder.service';
import { LeadInstallSyncService } from '../lead-finder/lead-install-sync.service';
import { WhatsappRecipient, WhatsappRecipientDocument } from '../whatsapp-campaigns/schemas/whatsapp-recipient.schema';
import { WhatsappCampaign, WhatsappCampaignDocument } from '../whatsapp-campaigns/schemas/whatsapp-campaign.schema';
import { WhatsappCampaignService } from '../whatsapp-campaigns/services/whatsapp-campaign.service';
import { WhatsappQueueService } from '../whatsapp-campaigns/services/whatsapp-queue.service';
import { WhatsappCloudService } from '../whatsapp-campaigns/services/whatsapp-cloud.service';
import {
  EmailCampaignRecipient,
  EmailCampaignRecipientDocument,
} from '../email-campaigns/schemas/email-campaign-recipient.schema';
import { EmailCampaign, EmailCampaignDocument } from '../email-campaigns/schemas/email-campaign.schema';
import { EmailCampaignService } from '../email-campaigns/services/email-campaign.service';
import { EmailCampaignQueueService } from '../email-campaigns/services/email-campaign-queue.service';
import { SesService } from '../email-campaigns/services/ses.service';

const NOT_REACHABLE = ['DO_NOT_CONTACT', 'INVALID', 'NOT_INTERESTED', 'INSTALLED'];
// Brakes: stop a channel when people object faster than this (last 7 days).
const MIN_VOLUME_FOR_BRAKES = 50;
const EMAIL_MAX_BOUNCE = 0.03;
const EMAIL_MAX_COMPLAINT = 0.001;
const WHATSAPP_MAX_OPT_OUT = 0.02;
// A locality+trade is searched again after this long, deeper each time.
const RESEARCH_AFTER_DAYS = 21;

interface RegionPlan {
  regionId: string;
  name: string;
  language: string;
  searches: { planned: number; jobIds: string[]; combos: string[] };
  whatsapp: { count: number; leadIds: string[]; sample: string[]; template?: string; languageCode?: string; campaignId?: string; note?: string };
  email: {
    count: number;
    leadIds: string[];
    sample: string[];
    language?: string;
    campaignId?: string;
    note?: string;
    // One campaign per kind of work, each with its own opening line.
    byKind?: Partial<Record<TradeKind, string[]>>;
    campaigns?: { kind: TradeKind; id: string; count: number }[];
  };
}

@Injectable()
export class AutopilotService implements OnModuleInit {
  private readonly logger = new Logger(AutopilotService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(AutopilotRegion.name) private readonly regionModel: Model<AutopilotRegionDocument>,
    @InjectModel(AutopilotSettings.name) private readonly settingsModel: Model<AutopilotSettingsDocument>,
    @InjectModel(AutopilotDay.name) private readonly dayModel: Model<AutopilotDayDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadSearchJob.name) private readonly jobModel: Model<LeadSearchJobDocument>,
    @InjectModel(WhatsappRecipient.name) private readonly waRecipientModel: Model<WhatsappRecipientDocument>,
    @InjectModel(WhatsappCampaign.name) private readonly waCampaignModel: Model<WhatsappCampaignDocument>,
    @InjectModel(EmailCampaignRecipient.name) private readonly emailRecipientModel: Model<EmailCampaignRecipientDocument>,
    @InjectModel(EmailCampaign.name) private readonly emailCampaignModel: Model<EmailCampaignDocument>,
    private readonly searchJobs: LeadSearchJobService,
    private readonly usage: ProviderUsageService,
    private readonly emailFinder: EmailFinderService,
    private readonly installSync: LeadInstallSyncService,
    private readonly waCampaigns: WhatsappCampaignService,
    private readonly waQueue: WhatsappQueueService,
    private readonly waCloud: WhatsappCloudService,
    private readonly emailCampaigns: EmailCampaignService,
    private readonly emailQueue: EmailCampaignQueueService,
    private readonly ses: SesService,
  ) {}

  async onModuleInit() {
    await this.settings().catch((err) => this.logger.warn(`Autopilot setup deferred: ${err.message}`));
  }

  // ------------------------------------------------------------ settings & regions

  /** The settings document, created with defaults (and starter regions) on first use. */
  async settings(): Promise<AutopilotSettingsDocument> {
    let s = await this.settingsModel.findOne({ key: 'main' }).exec();
    if (!s) {
      s = await this.settingsModel.create({ key: 'main', messages: {} });
      if ((await this.regionModel.countDocuments()) === 0) {
        await this.regionModel.insertMany(
          DEFAULT_REGIONS.map((r) => ({ ...r, categories: DEFAULT_CATEGORIES, weight: r.weight ?? 1, enabled: true })),
        );
      }
    }
    return s;
  }

  async updateSettings(patch: Partial<AutopilotSettings>) {
    const s = await this.settings();
    const wasOn = s.enabled;
    const fields: (keyof AutopilotSettings)[] = [
      'enabled', 'approvalMode', 'searchFreeMonthly', 'whatsappMaxPerDay', 'emailStartPerDay', 'emailGrowth',
      'emailMaxPerDay', 'emailAfterWhatsappDays', 'senderName', 'senderEmail', 'replyTo', 'notifyEmail',
    ];
    for (const f of fields) if (patch[f] !== undefined) (s as any)[f] = patch[f];
    if (patch.messages) {
      // null for a language goes back to the built-in text.
      const next = { ...(s.messages ?? {}) };
      for (const [lang, m] of Object.entries(patch.messages)) {
        if (m === null) delete next[lang];
        else next[lang] = m;
      }
      s.messages = next;
      s.markModified('messages');
    }
    // The two weeks of approvals start the first time it is switched on.
    if (s.enabled && !wasOn && s.approvalMode === 'two_weeks' && !s.autoApproveFrom) {
      s.autoApproveFrom = new Date(Date.now() + 14 * 86400_000);
    }
    return s.save();
  }

  regions() {
    return this.regionModel.find().sort({ createdAt: 1 }).exec();
  }

  createRegion(dto: Partial<AutopilotRegion>) {
    return this.regionModel.create({ categories: DEFAULT_CATEGORIES, ...dto });
  }

  async updateRegion(id: string, dto: Partial<AutopilotRegion>) {
    const r = await this.regionModel.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true }).exec();
    if (!r) throw new NotFoundException('Region not found');
    return r;
  }

  async removeRegion(id: string) {
    await this.regionModel.deleteOne({ _id: id });
    return { deleted: true };
  }

  private messagesFor(s: AutopilotSettingsDocument, language: string): LanguageMessages {
    return { ...DEFAULT_MESSAGES.en, ...(s.messages?.en ?? {}), ...(DEFAULT_MESSAGES[language] ?? {}), ...(s.messages?.[language] ?? {}) };
  }

  private regionLeadMatch(r: AutopilotRegionDocument): Record<string, any> {
    const cities = r.places.map((p) => new RegExp(`^${escapeRx(p.city.trim())}$`, 'i'));
    const match: Record<string, any> = { city: { $in: cities } };
    if (r.categories?.length) match.category = { $in: r.categories };
    return match;
  }

  private async day(dayKey: string): Promise<AutopilotDayDocument> {
    return (
      (await this.dayModel.findOne({ dayKey }).exec()) ??
      (await this.dayModel.findOneAndUpdate({ dayKey }, { $setOnInsert: { dayKey } }, { upsert: true, new: true }).exec())!
    );
  }

  // ------------------------------------------------------------ 1. lead search

  /** What is left of Google's free calls this month, spread over the days left. */
  async searchBudget(now = new Date()) {
    const s = await this.settings();
    const used = await this.usage.monthRequests('google_places');
    const usedToday = (await this.usage.getTelemetrySummary('google_places')).todayRequests;
    // Fixed at the start of the day, so pressing "Search" again can't spend tomorrow's share.
    // The admin setting can lower it, never raise it past the server's cap.
    const freeMonthly = Math.min(s.searchFreeMonthly || this.usage.monthlyLimit, this.usage.monthlyLimit);
    const leftAtDayStart = Math.max(0, freeMonthly - (used - usedToday));
    const today = Math.floor(leftAtDayStart / istDaysLeftInMonth(now));
    return {
      freeMonthly,
      usedThisMonth: used,
      leftThisMonth: Math.max(0, freeMonthly - used),
      today,
      usedToday,
      leftToday: Math.max(0, today - usedToday),
    };
  }

  /** Runs today's searches once: least recently searched locality+trade first. */
  async runSearches(dayKey = istDayKey(), force = false) {
    const s = await this.settings();
    const day = await this.day(dayKey);
    if (day.searchesRunAt && !force) return day;

    const allowance = await this.searchBudget();
    const budget = allowance.leftToday;
    // Pressing "Search" again after today's share is spent: say so, change nothing.
    if (!budget && force && allowance.leftThisMonth > 0) {
      throw new BadRequestException(
        `Today's ${allowance.today} free searches are already used — the next ones run tomorrow at 06:00 (${allowance.leftThisMonth} left this month).`,
      );
    }
    const regions = (await this.regions()).filter((r) => r.enabled);
    const shares = splitByWeight(budget, regions.map((r) => r.weight));
    day.searchBudget = budget;
    day.searchesRunAt = new Date();
    day.brakes = [...(day.brakes ?? []).filter((b) => b.channel !== 'search'), ...this.searchBrakes(allowance)];

    const history = await this.searchHistory();
    const plans: RegionPlan[] = (day.regions?.length ? day.regions : regions.map((r) => this.emptyPlan(r))) as RegionPlan[];
    const jobs: { plan: RegionPlan; dto: any }[] = [];

    regions.forEach((r, i) => {
      const plan = plans.find((p) => p.regionId === r.id) ?? plans[plans.push(this.emptyPlan(r)) - 1];
      let calls = shares[i];
      for (const combo of this.nextCombos(r, history)) {
        if (calls <= 0) break;
        const pages = Math.min(calls, combo.pages);
        calls -= pages;
        plan.searches.planned += pages;
        plan.searches.combos.push(`${combo.area || 'Whole city'}, ${combo.city} · ${combo.category.replace(/_/g, ' ')}`);
        jobs.push({
          plan,
          dto: { country: 'India', state: combo.state, city: combo.city, area: combo.area || undefined, category: combo.category, limit: 20 * pages, maxRequests: pages },
        });
      }
    });

    day.regions = plans as any;
    day.markModified('regions');
    await day.save();

    // One at a time, a few seconds apart: polite to Google and to our own rate limits.
    setImmediate(async () => {
      for (const { plan, dto } of jobs) {
        try {
          const job = await this.searchJobs.createAndStartJob(dto, 'autopilot');
          plan.searches.jobIds.push(job._id.toString());
        } catch (err: any) {
          this.logger.warn(`Autopilot search failed to start: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      // Only the searches part: the plan may have been built meanwhile.
      for (const plan of plans) {
        await this.dayModel.updateOne({ dayKey, 'regions.regionId': plan.regionId }, { $set: { 'regions.$.searches': plan.searches } });
      }
    });
    if (!s.enabled) this.logger.log('Autopilot searches ran manually while switched off.');
    return day;
  }

  /** Only a month that is truly used up is a brake; a spent day is normal. */
  private searchBrakes(a: { leftThisMonth: number; freeMonthly: number }) {
    return a.leftThisMonth <= 0
      ? [{ channel: 'search' as const, reason: `All ${a.freeMonthly} free Google searches for this month are used — searching resumes on the 1st.` }]
      : [];
  }

  private emptyPlan(r: AutopilotRegionDocument): RegionPlan {
    return {
      regionId: r.id,
      name: r.name,
      language: r.language,
      searches: { planned: 0, jobIds: [], combos: [] },
      whatsapp: { count: 0, leadIds: [], sample: [] },
      email: { count: 0, leadIds: [], sample: [] },
    };
  }

  private async searchHistory() {
    const rows = await this.jobModel.aggregate<{ _id: string; last: Date; runs: number; lastNew: number; recentNew: number }>([
      { $match: { status: { $in: ['COMPLETED', 'RUNNING', 'QUEUED'] } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { $concat: [{ $toLower: '$city' }, '|', { $toLower: { $ifNull: ['$area', ''] } }, '|', '$category'] },
          last: { $max: '$createdAt' },
          runs: { $sum: 1 },
          lastNew: { $last: '$newLeads' },
        },
      },
    ]);
    return new Map(rows.map((r) => [r._id, r]));
  }

  /** Locality+trade pairs to search, never-searched first, then the stalest. */
  private nextCombos(r: AutopilotRegionDocument, history: Map<string, any>) {
    const combos: { state: string; city: string; area: string; category: string; pages: number; last: number; secondary: boolean }[] = [];
    const cats = r.categories?.length ? r.categories : DEFAULT_CATEGORIES;
    // Interleave cities so one big city doesn't take the whole budget.
    const maxLoc = Math.max(...r.places.map((p) => Math.max(1, p.localities.length)));
    for (let li = 0; li < maxLoc; li++) {
      for (const place of r.places) {
        const locs = place.localities.length ? place.localities : [''];
        if (li >= locs.length) continue;
        for (const category of cats) {
          // Specialist trades: once per city, not per locality.
          const cityWide = tradeOf(category)?.scope === 'city';
          if (cityWide && li > 0) continue;
          const area = cityWide ? '' : locs[li];
          const key = `${place.city.toLowerCase()}|${area.toLowerCase()}|${category}`;
          const h = history.get(key);
          if (h) {
            const age = Date.now() - new Date(h.last).getTime();
            if (age < RESEARCH_AFTER_DAYS * 86400_000) continue;
            // Exhausted: a re-search that found nothing new.
            if (h.runs >= 2 && h.lastNew === 0) continue;
          }
          combos.push({
            state: place.state,
            city: place.city,
            area,
            category,
            pages: h ? Math.min(3, h.runs + 1) : 1,
            last: h ? new Date(h.last).getTime() : 0,
            secondary: tradeOf(category)?.tier === 'secondary',
          });
        }
      }
    }
    // Never-searched primary trades first, then never-searched secondary ones,
    // then the stalest re-searches. Stable sort keeps the city interleaving.
    const rank = (c: (typeof combos)[number]) => (c.last === 0 ? (c.secondary ? 1 : 0) : 2);
    return combos.sort((a, b) => rank(a) - rank(b) || a.last - b.last);
  }

  // ------------------------------------------------------------ 2. limits & brakes

  /** Today's people limits per channel, after warm-up and brakes. */
  async limits(dayKey = istDayKey()) {
    const s = await this.settings();
    const brakes: { channel: 'whatsapp' | 'email'; reason: string }[] = [];
    const since = new Date(Date.now() - 7 * 86400_000);

    // WhatsApp
    let whatsapp = Math.min(s.whatsappMaxPerDay, this.waQueue.dailyLimit);
    let monthBudget: any = this.waQueue.budget();
    let quality: string | undefined;
    let tier: string | undefined;
    if (!this.waCloud.isConfigured()) {
      brakes.push({ channel: 'whatsapp', reason: 'WhatsApp is not connected.' });
      whatsapp = 0;
    } else {
      try {
        const h = await this.waCloud.phoneHealth();
        quality = h.qualityRating;
        tier = h.messagingLimitTier;
        if (h.dailyCap) whatsapp = Math.min(whatsapp, h.dailyCap);
        if (quality === 'RED') {
          brakes.push({ channel: 'whatsapp', reason: 'Meta rates the number RED (too many blocks or reports). Paused until it recovers.' });
          whatsapp = 0;
        } else if (quality === 'YELLOW') {
          brakes.push({ channel: 'whatsapp', reason: 'Meta rates the number YELLOW — sending at half pace.' });
          whatsapp = Math.floor(whatsapp / 2);
        }
      } catch (err: any) {
        this.logger.warn(`Could not read WhatsApp number health: ${err.message}`);
      }
      // Monthly money limit: what's left, spread over the sending days left.
      const budget = this.waQueue.budget();
      let monthNote: string | undefined;
      if (budget.monthlyCap !== null) {
        const left = Math.max(0, budget.monthlyCap - (await this.waQueue.sentThisMonth()));
        const perDay = Math.floor(left / sendingDaysLeft((k) => this.config.get<string>(k)));
        if (perDay < whatsapp) {
          whatsapp = perDay;
          monthNote = `${left} of ${budget.monthlyCap} messages left this month (≈ ₹${budget.usableInr} budget)`;
        }
        if (left === 0) {
          brakes.push({ channel: 'whatsapp', reason: `This month's WhatsApp budget is used (${budget.monthlyCap} messages ≈ ₹${budget.usableInr}). Resumes on the 1st.` });
        }
      }
      monthBudget = { ...budget, note: monthNote };
      const [sent, optedOut] = await Promise.all([
        this.waRecipientModel.countDocuments({ sentAt: { $gte: since } }),
        this.waRecipientModel.countDocuments({ sentAt: { $gte: since }, status: 'OPTED_OUT' }),
      ]);
      if (sent >= MIN_VOLUME_FOR_BRAKES && optedOut / sent > WHATSAPP_MAX_OPT_OUT) {
        brakes.push({ channel: 'whatsapp', reason: `${pct(optedOut / sent)} of people opted out this week (limit ${pct(WHATSAPP_MAX_OPT_OUT)}). Paused — check the message.` });
        whatsapp = 0;
      }
    }

    // Email: warm-up grows only on healthy days
    const [sent, bounced, complained] = await Promise.all([
      this.emailRecipientModel.countDocuments({ sentAt: { $gte: since } }),
      this.emailRecipientModel.countDocuments({ sentAt: { $gte: since }, status: 'BOUNCED' }),
      this.emailRecipientModel.countDocuments({ sentAt: { $gte: since }, status: 'COMPLAINED' }),
    ]);
    const bounceRate = sent ? bounced / sent : 0;
    const complaintRate = sent ? complained / sent : 0;
    const healthy = sent < MIN_VOLUME_FOR_BRAKES || (bounceRate <= EMAIL_MAX_BOUNCE && complaintRate <= EMAIL_MAX_COMPLAINT);
    const prev = await this.dayModel
      .findOne({ dayKey: { $lt: dayKey }, 'caps.email': { $gt: 0 } })
      .sort({ dayKey: -1 })
      .exec();
    let email = prev?.caps?.email
      ? healthy
        ? Math.ceil(prev.caps.email * s.emailGrowth)
        : prev.caps.email
      : s.emailStartPerDay;
    email = Math.min(email, s.emailMaxPerDay, this.emailQueue.dailyLimit);
    if (!healthy) {
      brakes.push({
        channel: 'email',
        reason: `Bounces ${pct(bounceRate)} / spam reports ${pct(complaintRate, 2)} this week (limits ${pct(EMAIL_MAX_BOUNCE)} / ${pct(EMAIL_MAX_COMPLAINT, 2)}). Email paused — clean the list first.`,
      });
      email = 0;
    }
    return {
      whatsapp,
      email,
      whatsappQuality: quality,
      whatsappTier: tier,
      brakes,
      emailHealth: { sent, bounceRate, complaintRate },
      whatsappMonth: { ...monthBudget, sent: await this.waQueue.sentThisMonth() },
    };
  }

  // ------------------------------------------------------------ 3. the day's plan

  async buildPlan(dayKey = istDayKey(), rebuild = false) {
    const s = await this.settings();
    const day = await this.day(dayKey);
    if (day.status && ['APPROVED', 'LAUNCHED'].includes(day.status)) return day;
    if (day.plannedAt && !rebuild && day.status !== 'EXPIRED') return day;

    const regions = (await this.regions()).filter((r) => r.enabled);
    const lim = await this.limits(dayKey);
    const plans: RegionPlan[] = regions.map((r) => {
      const old = (day.regions ?? []).find((p: RegionPlan) => p.regionId === r.id);
      return { ...this.emptyPlan(r), searches: old?.searches ?? { planned: 0, jobIds: [], combos: [] } };
    });

    // Who has already been messaged (or is waiting in a queue) on each channel.
    const [waPhones, emailed] = await Promise.all([
      this.waRecipientModel.distinct('phone').exec(),
      this.emailRecipientModel.distinct('email').exec(),
    ]);
    const waDone = new Set(waPhones.map((p: string) => `+${p}`));
    const emailDone = new Set(emailed.map((e: string) => e.toLowerCase()));
    const waitBefore = new Date(Date.now() - s.emailAfterWhatsappDays * 86400_000);

    const pools = await Promise.all(
      regions.map(async (r) => {
        const base = { ...this.regionLeadMatch(r), status: { $nin: NOT_REACHABLE } };
        const wa = r.useWhatsapp
          ? (
              await this.leadModel
                .find({ ...base, status: { $in: ['NEW', 'REVIEWED'] }, phoneType: 'mobile', phoneNormalized: { $exists: true, $ne: '' }, isWhatsappOptedOut: { $ne: true }, lastWhatsappAt: { $exists: false } })
                .sort({ createdAt: 1 })
                .select('_id businessName city phoneNormalized')
                .limit(2000)
                .exec()
            ).filter((l) => !waDone.has(l.phoneNormalized!))
          : [];
        const em = r.useEmail
          ? (
              await this.leadModel
                .find(<Record<string, any>>{
                  ...base,
                  email: { $exists: true, $nin: [null, ''] },
                  isEmailUnsubscribed: { $ne: true },
                  emailBounceStatus: { $in: [null, 'NONE'] },
                  whatsappRepliedAt: { $exists: false },
                  $or: [
                    // Never contacted, and WhatsApp can't reach them.
                    { status: { $in: ['NEW', 'REVIEWED'] }, $or: [{ phoneType: { $ne: 'mobile' } }, { phoneNormalized: { $in: [null, ''] } }, { isWhatsappOptedOut: true }] },
                    // Got WhatsApp a few days ago and hasn't answered.
                    { lastWhatsappAt: { $lte: waitBefore }, status: { $in: ['NEW', 'REVIEWED', 'CONTACTED'] } },
                    // Region not on WhatsApp at all.
                    ...(r.useWhatsapp ? [] : [{ status: { $in: ['NEW', 'REVIEWED'] } }]),
                  ],
                })
                .sort({ createdAt: 1 })
                .select('_id businessName city email category')
                .limit(2000)
                .exec()
            ).filter((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email!) && !emailDone.has(l.email!.toLowerCase()))
          : [];
        return { wa, em };
      }),
    );

    const weights = regions.map((r) => r.weight);
    const waAlloc = allocate(lim.whatsapp, weights, pools.map((p) => p.wa.length));
    const emAlloc = allocate(lim.email, weights, pools.map((p) => p.em.length));

    plans.forEach((plan, i) => {
      const r = regions[i];
      const msg = this.messagesFor(s, r.language);
      const wa = pools[i].wa.slice(0, waAlloc[i]);
      const em = pools[i].em.slice(0, emAlloc[i]);
      plan.whatsapp = { count: wa.length, leadIds: wa.map((l) => l._id.toString()), sample: wa.slice(0, 5).map((l) => l.businessName), template: msg.whatsappTemplate, languageCode: msg.whatsappLanguage };
      const byKind: Partial<Record<TradeKind, string[]>> = {};
      for (const l of em) (byKind[kindOf(l.category)] ??= []).push(l._id.toString());
      plan.email = {
        count: em.length,
        leadIds: em.map((l) => l._id.toString()),
        sample: em.slice(0, 5).map((l) => l.businessName),
        language: r.language,
        byKind,
      };
      if (!r.useWhatsapp) plan.whatsapp.note = 'WhatsApp off for this region';
      else if (!pools[i].wa.length) plan.whatsapp.note = 'No fresh mobile numbers — searches will add more';
      if (!r.useEmail) plan.email.note = 'Email off for this region';
      else if (!pools[i].em.length) plan.email.note = 'No fresh email addresses yet';
    });

    const needsApproval = s.approvalMode === 'always' || (s.approvalMode === 'two_weeks' && (!s.autoApproveFrom || new Date() < s.autoApproveFrom));
    day.regions = plans as any;
    day.markModified('regions');
    day.caps = { whatsapp: lim.whatsapp, email: lim.email, whatsappQuality: lim.whatsappQuality, whatsappTier: lim.whatsappTier };
    day.markModified('caps');
    day.brakes = [...this.searchBrakes(await this.searchBudget()), ...lim.brakes];
    day.plannedAt = new Date();
    day.status = needsApproval ? 'PENDING_APPROVAL' : 'APPROVED';
    await day.save();

    if (needsApproval) {
      await this.notify(
        `Agla Kaam autopilot: today's plan is ready (${dayKey})`,
        `${plans.map((p) => `${p.name}: ${p.whatsapp.count} WhatsApp, ${p.email.count} email`).join('\n')}\n\nApprove it in the admin: Autopilot. Plans not approved by 17:00 are dropped.`,
      );
      return day;
    }
    return this.launch(dayKey, 'auto');
  }

  async approve(dayKey: string, by = 'admin') {
    const day = await this.dayModel.findOne({ dayKey }).exec();
    if (!day || day.status !== 'PENDING_APPROVAL') throw new BadRequestException('There is no plan waiting for approval for that day.');
    day.status = 'APPROVED';
    day.approvedAt = new Date();
    day.approvedBy = by;
    await day.save();
    return this.launch(dayKey, by);
  }

  async skip(dayKey: string) {
    const day = await this.dayModel.findOne({ dayKey }).exec();
    if (!day || day.status !== 'PENDING_APPROVAL') throw new BadRequestException('Only a plan waiting for approval can be skipped.');
    day.status = 'SKIPPED';
    day.notes = [...(day.notes ?? []), `Skipped by admin at ${new Date().toISOString()}`];
    return day.save();
  }

  /** Turns an approved plan into campaigns. The queues do the sending, inside hours and limits. */
  private async launch(dayKey: string, by: string) {
    const s = await this.settings();
    const day = await this.dayModel.findOne({ dayKey }).exec();
    if (!day || day.status !== 'APPROVED') return day;
    let approved: { name: string; language: string }[] = [];
    try {
      approved = (await this.waCampaigns.templates()).filter((t) => t.status === 'APPROVED');
    } catch {
      approved = [];
    }

    const plans = day.regions as RegionPlan[];
    for (const plan of plans) {
      const msg = this.messagesFor(s, plan.language);
      // WhatsApp
      if (plan.whatsapp.count > 0) {
        let template = msg.whatsappTemplate;
        let lang = msg.whatsappLanguage;
        let header = msg.headerImageUrl;
        if (approved.length && !approved.some((t) => t.name === template && t.language === lang)) {
          const en = this.messagesFor(s, 'en');
          plan.whatsapp.note = `No approved “${template}” in ${lang} yet — sent in English.`;
          template = en.whatsappTemplate;
          lang = en.whatsappLanguage;
          header = en.headerImageUrl;
        }
        try {
          const c = await this.waCampaigns.create(
            {
              name: `Autopilot · ${plan.name} · ${dayKey}`,
              templateName: template,
              languageCode: lang,
              headerImageUrl: header || undefined,
              bodyParams: ['businessName'],
              selectedLeadIds: plan.whatsapp.leadIds,
              skipAlreadyMessaged: true,
            } as any,
            `autopilot:${by}`,
          );
          await this.waCampaigns.start(c.id);
          plan.whatsapp.campaignId = c.id;
          plan.whatsapp.template = template;
          plan.whatsapp.languageCode = lang;
        } catch (err: any) {
          plan.whatsapp.note = `Not started: ${err.message}`;
        }
      }
      // Email
      if (plan.email.count > 0) {
        // One campaign per kind of work, each opening with its own question.
        const groups = Object.entries(plan.email.byKind ?? { service: plan.email.leadIds }) as [TradeKind, string[]][];
        plan.email.campaigns = [];
        const failures: string[] = [];
        for (const [kind, leadIds] of groups) {
          if (!leadIds.length) continue;
          const { subject, body } = tradeEmail(plan.language, kind, msg.emailBody, msg.emailSubject);
          try {
            const c = await this.emailCampaigns.createCampaign(
              {
                name: `Autopilot · ${plan.name} · ${kind} · ${dayKey}`,
                subject,
                emailContent: body,
                htmlContent: textToHtml(body),
                plainTextOnly: true,
                senderName: s.senderName,
                senderEmail: s.senderEmail,
                replyTo: s.replyTo || undefined,
                selectedLeadIds: leadIds,
                skipAlreadyEmailed: true,
                followUps: msg.emailFollowUp ? [{ delayDays: msg.followUpDays || 4, body: msg.emailFollowUp }] : [],
              } as any,
              `autopilot:${by}`,
            );
            await this.emailCampaigns.startCampaign(c._id.toString());
            plan.email.campaigns.push({ kind, id: c._id.toString(), count: leadIds.length });
          } catch (err: any) {
            failures.push(`${kind}: ${err.message}`);
          }
        }
        plan.email.campaignId = plan.email.campaigns[0]?.id;
        if (failures.length) plan.email.note = `Not started — ${failures.join('; ')}`;
      }
    }
    day.regions = plans as any;
    day.markModified('regions');
    day.status = 'LAUNCHED';
    day.launchedAt = new Date();
    await day.save();
    this.logger.log(`Autopilot ${dayKey} launched: ${plans.map((p) => `${p.name} ${p.whatsapp.count}wa/${p.email.count}em`).join(', ')}`);
    return day;
  }

  /** A plan nobody approved by the afternoon is dropped, so it can't pile onto tomorrow. */
  async expire(dayKey = istDayKey()) {
    await this.dayModel.updateOne(
      { dayKey, status: 'PENDING_APPROVAL' },
      { $set: { status: 'EXPIRED' }, $push: { notes: 'Not approved by 17:00 — dropped.' } },
    );
  }

  // ------------------------------------------------------------ 4. report

  async report(dayKey = istDayKey()) {
    const day = await this.dayModel.findOne({ dayKey }).exec();
    if (!day) return null;
    const regions = await this.regions();
    const start = istDayStart(dayKey);
    const end = new Date(start.getTime() + 86400_000);
    const rows = [];
    for (const plan of (day.regions ?? []) as RegionPlan[]) {
      const region = regions.find((r) => r.id === plan.regionId);
      const jobIds = (plan.searches?.jobIds ?? []).filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
      const jobs = jobIds.length ? await this.jobModel.find({ _id: { $in: jobIds } }).select('newLeads duplicateLeads apiRequestsCount').exec() : [];
      const wa = plan.whatsapp?.campaignId ? await this.waCampaignModel.findById(plan.whatsapp.campaignId).exec() : null;
      const emailIds = plan.email?.campaigns?.length ? plan.email.campaigns.map((c) => c.id) : plan.email?.campaignId ? [plan.email.campaignId] : [];
      const ems = emailIds.length ? await this.emailCampaignModel.find({ _id: { $in: emailIds } }).exec() : [];
      const em = {
        sentCount: ems.reduce((n, c) => n + (c.sentCount || 0), 0),
        queuedCount: ems.reduce((n, c) => n + (c.queuedCount || 0), 0),
        bouncedCount: ems.reduce((n, c) => n + (c.bouncedCount || 0), 0),
      };
      const installed = region
        ? await this.leadModel.countDocuments({ ...this.regionLeadMatch(region), installedAt: { $gte: start, $lt: end } })
        : 0;
      rows.push({
        regionId: plan.regionId,
        name: plan.name,
        searches: jobs.length,
        googleCalls: jobs.reduce((n, j) => n + (j.apiRequestsCount || 0), 0),
        newLeads: jobs.reduce((n, j) => n + (j.newLeads || 0), 0),
        whatsappSent: wa?.sentCount ?? 0,
        whatsappWaiting: wa?.queuedCount ?? 0,
        whatsappReplied: wa?.repliedCount ?? 0,
        whatsappOptedOut: wa?.optedOutCount ?? 0,
        emailSent: em?.sentCount ?? 0,
        emailWaiting: em?.queuedCount ?? 0,
        emailBounced: em?.bouncedCount ?? 0,
        installed,
      });
    }
    day.report = { at: new Date(), regions: rows };
    day.markModified('report');
    await day.save();
    return day;
  }

  async sendEveningReport(dayKey = istDayKey()) {
    const day = await this.report(dayKey);
    if (!day?.report) return;
    const lines = day.report.regions.map(
      (r: any) =>
        `${r.name}: +${r.newLeads} leads, WhatsApp ${r.whatsappSent} sent / ${r.whatsappReplied} replied, email ${r.emailSent} sent, ${r.installed} installed`,
    );
    const brakes = (day.brakes ?? []).map((b) => `! ${b.channel}: ${b.reason}`);
    await this.notify(`Agla Kaam autopilot: ${dayKey}`, [...lines, '', ...brakes].join('\n').trim());
  }

  private async notify(subject: string, text: string) {
    const s = await this.settings();
    if (!s.notifyEmail) return;
    try {
      await this.ses.sendEmail({ to: s.notifyEmail, fromName: 'Agla Kaam Autopilot', fromEmail: this.ses.getDefaultSender(), subject, html: text, text, textOnly: true });
    } catch (err: any) {
      this.logger.warn(`Autopilot notification failed: ${err.message}`);
    }
  }

  // ------------------------------------------------------------ overview for the admin page

  async overview() {
    const s = await this.settings();
    const dayKey = istDayKey();
    const [regions, today, history, budget, lim] = await Promise.all([
      this.regions(),
      this.dayModel.findOne({ dayKey }).exec(),
      this.dayModel.find({ dayKey: { $lt: dayKey } }).sort({ dayKey: -1 }).limit(14).select('-regions.whatsapp.leadIds -regions.email.leadIds').exec(),
      this.searchBudget(),
      this.limits(dayKey),
    ]);
    return {
      settings: s,
      regions,
      today: today ? stripLeadIds(today.toObject()) : { dayKey },
      history: history.map((d) => stripLeadIds(d.toObject())),
      budget,
      limits: lim,
      sendHours: this.emailQueue.sendWindow(),
      whatsappConnected: this.waCloud.isConfigured(),
    };
  }

  // ------------------------------------------------------------ the morning prep (06:40)

  async prepareLeads() {
    await this.installSync.sync().catch((err) => this.logger.warn(`Install sync: ${err.message}`));
    const regions = (await this.regions()).filter((r) => r.enabled);
    for (const r of regions) {
      for (const p of r.places) {
        await this.emailFinder.start({ city: p.city, limit: 50 }).catch(() => undefined);
        // One run at a time; wait for it before the next city.
        for (let i = 0; i < 60 && (await this.emailFinder.status()).running; i++) {
          await new Promise((res) => setTimeout(res, 5000));
        }
      }
    }
  }
}

function stripLeadIds(d: any) {
  for (const r of d.regions ?? []) {
    if (r.whatsapp) delete r.whatsapp.leadIds;
    if (r.email) delete r.email.leadIds;
  }
  return d;
}

function pct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
