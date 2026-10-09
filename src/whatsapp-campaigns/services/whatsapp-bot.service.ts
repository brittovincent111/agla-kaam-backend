import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import { WhatsappMessage, WhatsappMessageDocument } from '../schemas/whatsapp-message.schema';
import { WhatsappRecipient, WhatsappRecipientDocument } from '../schemas/whatsapp-recipient.schema';
import { WhatsappCampaign, WhatsappCampaignDocument } from '../schemas/whatsapp-campaign.schema';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { EmailService } from '../../common/email/email.service';
import { istMonthStart, whatsappBudget } from '../../common/utils/outreach-budget';
import { BUTTON_IDS, COPY, botLang, intentOf, type BotLang, type Intent } from '../bot-copy';

const HOUR = 3600_000;
// WhatsApp lets us write freely for 24 hours after their last message; the
// nudge goes out a little before that closes.
const WINDOW_MS = 24 * HOUR;
const NUDGE_AFTER_MS = 18 * HOUR;
const NUDGE_BEFORE_MS = 23 * HOUR;
// The one paid follow-up, for an interested lead who has gone quiet.
const FOLLOW_UP_AFTER_MS = 3 * 24 * HOUR;
const FOLLOW_UP_UNTIL_MS = 7 * 24 * HOUR;
// "Yes" tapped twice in a row gets one welcome, not two.
const WELCOME_REPEAT_MS = 12 * HOUR;

export interface InboundEvent {
  phone: string;
  lead: LeadDocument | null;
  recipient: WhatsappRecipientDocument | null;
  // A tap on one of our buttons: its id. Otherwise null.
  buttonId: string | null;
  text: string;
  // What the webhook already decided from the words.
  wasStop: boolean;
  wasYes: boolean;
}

/**
 * The automatic first reply to people who answer a campaign — so a lead who
 * says "yes" gets the app, a demo or a call within seconds instead of
 * waiting for someone to open the inbox. Rules, not AI: every reply is one
 * of a few fixed messages (bot-copy.ts).
 *
 * It only writes inside WhatsApp's 24-hour window (free service messages);
 * the one paid follow-up is a template, inside the outreach budget. It goes
 * quiet for good on a person the moment anyone replies to them by hand, or
 * when it is asked something it has no answer for.
 */
@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(WhatsappMessage.name) private readonly messageModel: Model<WhatsappMessageDocument>,
    @InjectModel(WhatsappRecipient.name) private readonly recipientModel: Model<WhatsappRecipientDocument>,
    @InjectModel(WhatsappCampaign.name) private readonly campaignModel: Model<WhatsappCampaignDocument>,
    private readonly cloud: WhatsappCloudService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  enabled(): boolean {
    return this.config.get<string>('WHATSAPP_BOT') !== 'off' && this.cloud.isConfigured();
  }

  // ---- Replies -----------------------------------------------------------

  async onInbound(e: InboundEvent): Promise<void> {
    if (!this.enabled()) return;
    if (!e.lead) return this.replyToStranger(e);
    const lead = e.lead;
    const lang = await this.languageFor(lead, e.recipient);
    const copy = COPY[lang];

    // Stop is honoured even when a person has taken over.
    if (e.wasStop) {
      await this.say(e.phone, lead, copy.stopped);
      return;
    }
    if (lead.whatsappBotPausedAt) return;

    const intent: Intent | 'yes' | null = this.buttonIntent(e.buttonId) ?? (e.wasYes ? 'yes' : intentOf(e.text));
    // Asking for the app, a demo, a call or the price is interest.
    if (intent === 'getApp' || intent === 'demo' || intent === 'callMe' || intent === 'price') {
      await this.leadModel.updateOne(
        { _id: lead._id, status: { $in: ['NEW', 'REVIEWED', 'CONTACTED', 'REPLIED'] } },
        { $set: { status: 'INTERESTED' } },
      ).exec();
    }
    switch (intent) {
      case 'yes':
        return this.welcome(e.phone, lead, lang);
      case 'getApp':
        return this.sendApp(e.phone, lead, lang);
      case 'demo':
        return this.sendDemo(e.phone, lead, lang);
      case 'callMe':
        return this.callRequested(e.phone, lead, lang);
      case 'price':
        await this.sayButtons(e.phone, lead, copy.price, lang);
        return;
      case 'no':
        await this.leadModel.updateOne(
          { _id: lead._id, status: { $nin: ['INSTALLED'] } },
          { $set: { status: 'NOT_INTERESTED', isWhatsappOptedOut: true, whatsappOptedOutAt: new Date() } },
        ).exec();
        await this.say(e.phone, lead, copy.notInterested);
        return;
      default:
        // Something it cannot answer: say a person will reply, once, and
        // leave the conversation to that person.
        await this.say(e.phone, lead, copy.ack);
        await this.pause(lead._id);
    }
  }

  /**
   * Someone not among the leads — the admin's own test send, a forwarded
   * message, a new number. Same answers, in the language they wrote in, with
   * nothing to track or pause; an unknown question is acknowledged once a
   * day rather than every message.
   */
  private async replyToStranger(e: InboundEvent): Promise<void> {
    const lang = scriptLang(e.text);
    const copy = COPY[lang];
    if (e.wasStop) {
      await this.say(e.phone, null, copy.stopped);
      return;
    }
    const intent: Intent | 'yes' | null = this.buttonIntent(e.buttonId) ?? (e.wasYes ? 'yes' : intentOf(e.text));
    const download = this.config.get<string>('WHATSAPP_DOWNLOAD_URL') || 'https://aglakaam.app/download';
    switch (intent) {
      case 'yes':
        await this.sayButtons(e.phone, null, copy.welcome, lang);
        return;
      case 'getApp':
        await this.sayLink(e.phone, null, copy.getAppBody, copy.getAppCta, download);
        return;
      case 'demo': {
        const video = this.demoVideo(lang);
        if (video) await this.say(e.phone, null, `${copy.demoBody}\n${video}`);
        await this.sayLink(e.phone, null, copy.getAppBody, copy.getAppCta, download);
        return;
      }
      case 'callMe':
        await this.say(e.phone, null, copy.callMeReply);
        await this.alertCallRequest(e.phone, null);
        return;
      case 'price':
        await this.sayButtons(e.phone, null, copy.price, lang);
        return;
      case 'no':
        await this.say(e.phone, null, copy.notInterested);
        return;
      default: {
        const acked = await this.messageModel
          .exists({ phone: e.phone, auto: true, at: { $gte: new Date(Date.now() - WINDOW_MS) } })
          .exec();
        if (!acked) await this.say(e.phone, null, copy.ack);
      }
    }
  }

  private buttonIntent(id: string | null): Intent | null {
    if (id === BUTTON_IDS.getApp) return 'getApp';
    if (id === BUTTON_IDS.demo) return 'demo';
    if (id === BUTTON_IDS.callMe) return 'callMe';
    return null;
  }

  private async welcome(phone: string, lead: LeadDocument, lang: BotLang): Promise<void> {
    if (lead.whatsappBotWelcomedAt && Date.now() - lead.whatsappBotWelcomedAt.getTime() < WELCOME_REPEAT_MS) return;
    await this.sayButtons(phone, lead, COPY[lang].welcome, lang);
    await this.leadModel.updateOne({ _id: lead._id }, { $set: { whatsappBotWelcomedAt: new Date() } }).exec();
  }

  private async sendApp(phone: string, lead: LeadDocument, lang: BotLang): Promise<void> {
    const copy = COPY[lang];
    await this.sayLink(phone, lead, copy.getAppBody, copy.getAppCta, this.downloadLink(lead._id));
  }

  private async sendDemo(phone: string, lead: LeadDocument, lang: BotLang): Promise<void> {
    const copy = COPY[lang];
    const video = this.demoVideo(lang);
    if (video) await this.say(phone, lead, `${copy.demoBody}\n${video}`);
    await this.sayLink(phone, lead, copy.getAppBody, copy.getAppCta, this.downloadLink(lead._id));
  }

  private async callRequested(phone: string, lead: LeadDocument, lang: BotLang): Promise<void> {
    const first = !lead.callRequestedAt;
    await this.leadModel.updateOne({ _id: lead._id }, { $set: { callRequestedAt: new Date() } }).exec();
    await this.say(phone, lead, COPY[lang].callMeReply);
    // Asked twice: one alert is enough.
    if (first) await this.alertCallRequest(phone, lead);
  }

  /** Email the admin and WhatsApp the alert number: a lead wants a call. */
  private async alertCallRequest(phone: string, lead: LeadDocument | null): Promise<void> {
    const who = lead?.displayName || lead?.businessName || 'Someone (not in your leads)';
    const where = [lead?.area, lead?.city].filter(Boolean).join(', ');
    const line = `📞 ${who}${where ? ` (${where})` : ''} wants a call: +${phone}`;
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    if (adminEmail) {
      await this.email
        .sendPlain(adminEmail, `Call request: ${who}`, `${line}\n\nCategory: ${lead?.category ?? '—'}\nThey tapped "Call me" on WhatsApp.`)
        .catch((err) => this.logger.warn(`Call alert email failed: ${(err as Error).message}`));
    }
    const alertTo = this.config.get<string>('WHATSAPP_ALERT_TO')?.replace(/\D/g, '');
    if (alertTo) {
      // Free text reaches this number only if it messaged the business number
      // in the last 24 hours; otherwise WhatsApp refuses and the email above
      // is the alert.
      await this.cloud
        .sendText(alertTo, line)
        .catch((err) => this.logger.warn(`Call alert WhatsApp to ${alertTo} not delivered: ${(err as Error).message}`));
    }
  }

  // ---- Follow-ups (every half hour) --------------------------------------

  @Cron(CronExpression.EVERY_30_MINUTES)
  async followUps(): Promise<void> {
    if (!this.enabled()) return;
    await this.sendNudges().catch((err) => this.logger.error(`Nudges failed: ${(err as Error).message}`));
    await this.sendTemplateFollowUps().catch((err) => this.logger.error(`Follow-ups failed: ${(err as Error).message}`));
    await this.welcomeInstalls().catch((err) => this.logger.error(`Install welcomes failed: ${(err as Error).message}`));
  }

  /** Interested, not installed, about to fall out of the free window. */
  async sendNudges(now = Date.now()): Promise<number> {
    const leads = await this.leadModel
      .find({
        status: 'INTERESTED',
        isWhatsappOptedOut: { $ne: true },
        whatsappBotPausedAt: { $exists: false },
        whatsappNudgedAt: { $exists: false },
        whatsappRepliedAt: { $gte: new Date(now - NUDGE_BEFORE_MS), $lte: new Date(now - NUDGE_AFTER_MS) },
      })
      .limit(50)
      .exec();
    let sent = 0;
    for (const lead of leads) {
      const phone = await this.phoneOf(lead);
      if (!phone) continue;
      const lang = await this.languageFor(lead, null);
      // Claimed first, so two runs cannot both nudge.
      const claimed = await this.leadModel.updateOne(
        { _id: lead._id, whatsappNudgedAt: { $exists: false } },
        { $set: { whatsappNudgedAt: new Date(now) } },
      ).exec();
      if (!claimed.modifiedCount) continue;
      if (await this.sayLink(phone, lead, COPY[lang].nudge, COPY[lang].getAppCta, this.downloadLink(lead._id))) sent++;
    }
    return sent;
  }

  /**
   * Interested three days ago and still not installed: one approved template
   * (the free window has closed), counted against the monthly budget. Only
   * when WHATSAPP_FOLLOWUP_TEMPLATE names an approved template.
   */
  async sendTemplateFollowUps(now = Date.now()): Promise<number> {
    const template = this.config.get<string>('WHATSAPP_FOLLOWUP_TEMPLATE')?.trim();
    if (!template) return 0;
    let room = await this.budgetLeft();
    if (room <= 0) return 0;
    const leads = await this.leadModel
      .find({
        status: 'INTERESTED',
        isWhatsappOptedOut: { $ne: true },
        whatsappBotPausedAt: { $exists: false },
        whatsappFollowUpAt: { $exists: false },
        whatsappRepliedAt: { $gte: new Date(now - FOLLOW_UP_UNTIL_MS), $lte: new Date(now - FOLLOW_UP_AFTER_MS) },
      })
      .limit(Math.min(50, room))
      .exec();
    let sent = 0;
    for (const lead of leads) {
      if (room <= 0) break;
      const phone = await this.phoneOf(lead);
      if (!phone) continue;
      const claimed = await this.leadModel.updateOne(
        { _id: lead._id, whatsappFollowUpAt: { $exists: false } },
        { $set: { whatsappFollowUpAt: new Date(now) } },
      ).exec();
      if (!claimed.modifiedCount) continue;
      const lang = await this.languageFor(lead, null);
      try {
        const wamid = await this.cloud.sendTemplate({
          to: phone,
          templateName: template,
          languageCode: lang,
          bodyParams: [(lead.displayName || lead.businessName || 'there').slice(0, 60)],
        });
        await this.record(phone, lead, `[template ${template}]`, wamid, 'template', 'bot-followup');
        sent++;
        room--;
      } catch (err) {
        this.logger.warn(`Follow-up to ${phone} failed: ${(err as Error).message}`);
      }
    }
    return sent;
  }

  /** Installed while the conversation is still open: say how to begin. */
  async welcomeInstalls(now = Date.now()): Promise<number> {
    const leads = await this.leadModel
      .find({
        status: 'INSTALLED',
        isWhatsappOptedOut: { $ne: true },
        whatsappInstallWelcomedAt: { $exists: false },
        installedAt: { $gte: new Date(now - 2 * 24 * HOUR) },
        whatsappRepliedAt: { $gte: new Date(now - WINDOW_MS + HOUR) },
      })
      .limit(50)
      .exec();
    let sent = 0;
    for (const lead of leads) {
      const phone = await this.phoneOf(lead);
      if (!phone) continue;
      const claimed = await this.leadModel.updateOne(
        { _id: lead._id, whatsappInstallWelcomedAt: { $exists: false } },
        { $set: { whatsappInstallWelcomedAt: new Date(now) } },
      ).exec();
      if (!claimed.modifiedCount) continue;
      const lang = await this.languageFor(lead, null);
      if (await this.say(phone, lead, COPY[lang].installWelcome)) sent++;
    }
    return sent;
  }

  // ---- Helpers -------------------------------------------------------------

  /** A person has taken this conversation: the assistant stays out of it. */
  async pause(leadId: Types.ObjectId | string | undefined | null): Promise<void> {
    if (!leadId) return;
    await this.leadModel.updateOne(
      { _id: leadId, whatsappBotPausedAt: { $exists: false } },
      { $set: { whatsappBotPausedAt: new Date() } },
    ).exec();
  }

  /** The link the "Get the app" button opens: counts the click, then the store page. */
  downloadLink(leadId: Types.ObjectId | string): string {
    const api = (this.config.get<string>('PUBLIC_API_URL') || 'https://agla-kaam-api.velocrew.in').replace(/\/+$/, '');
    return `${api}/api/whatsapp/go/${String(leadId)}`;
  }

  /** Records the click and returns where to send them. */
  async clicked(leadId: string): Promise<string> {
    const target = this.config.get<string>('WHATSAPP_DOWNLOAD_URL') || 'https://aglakaam.app/download';
    if (Types.ObjectId.isValid(leadId)) {
      await this.leadModel
        .updateOne({ _id: leadId, whatsappClickedAt: { $exists: false } }, { $set: { whatsappClickedAt: new Date() } })
        .exec()
        .catch(() => undefined);
    }
    return target;
  }

  private demoVideo(lang: BotLang): string | undefined {
    const key = lang === 'en' ? 'WHATSAPP_DEMO_VIDEO_URL' : `WHATSAPP_DEMO_VIDEO_URL_${lang.toUpperCase()}`;
    return this.config.get<string>(key) || this.config.get<string>('WHATSAPP_DEMO_VIDEO_URL') || undefined;
  }

  /** The campaign's language for this lead, remembered on the lead. */
  private async languageFor(lead: LeadDocument, recipient: WhatsappRecipientDocument | null): Promise<BotLang> {
    if (lead.whatsappLanguage) return botLang(lead.whatsappLanguage);
    const rec =
      recipient ??
      (await this.recipientModel.findOne({ leadId: lead._id, sentAt: { $exists: true } }).sort({ sentAt: -1 }).exec());
    let code = 'en';
    if (rec) {
      const campaign = await this.campaignModel.findById(rec.campaignId).select('languageCode').lean().exec();
      code = campaign?.languageCode || 'en';
    }
    await this.leadModel.updateOne({ _id: lead._id }, { $set: { whatsappLanguage: code } }).exec().catch(() => undefined);
    return botLang(code);
  }

  /** The number the conversation is on: the latest message with this lead. */
  private async phoneOf(lead: LeadDocument): Promise<string | null> {
    const last = await this.messageModel.findOne({ leadId: lead._id }).sort({ at: -1 }).select('phone').lean().exec();
    return last?.phone ?? lead.phoneNormalized?.replace(/\D/g, '') ?? null;
  }

  private async budgetLeft(): Promise<number> {
    const { monthlyCap } = whatsappBudget((k) => this.config.get<string>(k));
    if (monthlyCap === null) return Number.MAX_SAFE_INTEGER;
    const since = istMonthStart();
    const [campaignSends, followUps] = await Promise.all([
      this.recipientModel.countDocuments({ sentAt: { $gte: since } }).exec(),
      this.messageModel.countDocuments({ sentBy: 'bot-followup', at: { $gte: since } }).exec(),
    ]);
    return monthlyCap - campaignSends - followUps;
  }

  private async say(phone: string, lead: LeadDocument | null, text: string): Promise<boolean> {
    try {
      const wamid = await this.cloud.sendText(phone, text);
      await this.record(phone, lead, text, wamid, 'text');
      return true;
    } catch (err) {
      this.logger.warn(`Assistant reply to ${phone} failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async sayButtons(phone: string, lead: LeadDocument | null, text: string, lang: BotLang): Promise<boolean> {
    const b = COPY[lang].buttons;
    try {
      const wamid = await this.cloud.sendButtons(phone, text, [
        { id: BUTTON_IDS.getApp, title: b.getApp },
        { id: BUTTON_IDS.demo, title: b.demo },
        { id: BUTTON_IDS.callMe, title: b.callMe },
      ]);
      await this.record(phone, lead, `${text}\n[${b.getApp} · ${b.demo} · ${b.callMe}]`, wamid, 'interactive');
      return true;
    } catch (err) {
      this.logger.warn(`Assistant buttons to ${phone} failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async sayLink(
    phone: string,
    lead: LeadDocument | null,
    text: string,
    label: string,
    url: string,
  ): Promise<boolean> {
    try {
      const wamid = await this.cloud.sendLinkButton(phone, text, label, url);
      await this.record(phone, lead, `${text}\n[${label} → ${url}]`, wamid, 'interactive');
      return true;
    } catch (err) {
      // Some older WhatsApp versions refuse link buttons: plain text with the link.
      this.logger.warn(`Link button to ${phone} failed, sending text: ${(err as Error).message}`);
      return this.say(phone, lead, `${text}\n${url}`);
    }
  }

  private async record(
    phone: string,
    lead: LeadDocument | null,
    text: string,
    waMessageId: string,
    type: string,
    sentBy = 'bot',
  ): Promise<void> {
    await this.messageModel
      .create({
        direction: 'out',
        phone,
        leadId: lead?._id,
        type,
        text,
        waMessageId,
        at: new Date(),
        handled: true,
        sentBy,
        auto: true,
      })
      .catch((err) => this.logger.warn(`Could not record assistant message: ${(err as Error).message}`));
  }
}

// The language of what a stranger wrote, from its script: Devanagari is
// Hindi, Malayalam script is Malayalam, anything else English.
function scriptLang(text: string): BotLang {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  return 'en';
}
