import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WhatsappRecipient, WhatsappRecipientDocument } from '../schemas/whatsapp-recipient.schema';
import { WhatsappMessage, WhatsappMessageDocument } from '../schemas/whatsapp-message.schema';
import { Lead, LeadDocument } from '../../lead-finder/schemas/lead.schema';
import { WhatsappQueueService } from './whatsapp-queue.service';
import { WhatsappBotService } from './whatsapp-bot.service';

// Replies that mean "stop" — the template's opt-out button in English and
// Hindi, and the words people type.
const STOP_WORDS = [
  'stop promotions', 'stop', 'unsubscribe', 'प्रमोशन बंद करें', 'बंद करें', 'band karo',
  'പ്രൊമോഷൻ നിർത്തുക', 'നിർത്തുക', 'ഇനി മെസ്സേജ് വേണ്ട', 'മെസ്സേജ് വേണ്ട', 'വേണ്ട', 'விளம்பரங்களை நிறுத்து', 'நிறுத்து', 'ಪ್ರಚಾರ ನಿಲ್ಲಿಸಿ', 'ನಿಲ್ಲಿಸಿ',
];
// Replies that mean "tell me more".
const YES_WORDS = [
  'yes, show me', 'yes', 'tell me more', 'हाँ, दिखाइए', 'हाँ', 'haan', 'interested',
  'അതെ, കാണിക്കൂ', 'അതെ', 'ശരി', 'ശരി, കാണിക്കൂ', 'ஆம், காட்டுங்கள்', 'ஆம்', 'சரி', 'ಹೌದು, ತೋರಿಸಿ', 'ಹೌದು', 'ಸರಿ',
];

const RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * What Meta tells us after a send: delivery status of each campaign message,
 * and what people write or tap back. A reply links back to the campaign
 * message through `context.id`, or to the lead through the phone number.
 */
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    @InjectModel(WhatsappRecipient.name) private readonly recipientModel: Model<WhatsappRecipientDocument>,
    @InjectModel(WhatsappMessage.name) private readonly messageModel: Model<WhatsappMessageDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly queue: WhatsappQueueService,
    private readonly bot: WhatsappBotService,
  ) {}

  async handle(payload: any): Promise<void> {
    const touched = new Set<string>();
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const names = new Map<string, string>(
          (value.contacts ?? []).map((c: any) => [String(c.wa_id), c.profile?.name]),
        );
        for (const status of value.statuses ?? []) {
          const id = await this.onStatus(status);
          if (id) touched.add(id);
        }
        for (const message of value.messages ?? []) {
          const id = await this.onMessage(message, names.get(String(message.from)));
          if (id) touched.add(id);
        }
      }
    }
    for (const id of touched) await this.queue.syncCounters(new Types.ObjectId(id));
  }

  private async onStatus(s: any): Promise<string | null> {
    const recipient = await this.recipientModel.findOne({ waMessageId: s.id }).exec();
    if (!recipient) {
      // A test send, a manual API call, or a message from the other app on
      // this number: logged by the controller, nothing to update here.
      this.logger.debug(`[WA status] ${s.status} for ${s.id}: not a campaign message`);
      return null;
    }
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    const next = String(s.status || '').toUpperCase();
    if (next === 'FAILED') {
      const err = s.errors?.[0];
      recipient.status = err?.code === 131050 ? 'OPTED_OUT' : 'FAILED';
      recipient.failedAt = at;
      recipient.errorCode = err?.code;
      // Title and details together: "Re-engagement message" alone does not
      // say that the 24-hour window had closed.
      recipient.failureReason =
        [err?.title || err?.message, err?.error_data?.details].filter(Boolean).join(' — ').slice(0, 500) ||
        'Delivery failed';
      if (err?.code === 131050) await this.optOut(recipient.leadId, at);
    } else if (RANK[next] && (RANK[next] > (RANK[recipient.status] ?? 0))) {
      // Webhooks can arrive out of order: never step back from read to delivered.
      recipient.status = next as 'SENT' | 'DELIVERED' | 'READ';
      if (next === 'DELIVERED') recipient.deliveredAt = at;
      if (next === 'READ') {
        recipient.readAt = at;
        recipient.deliveredAt = recipient.deliveredAt ?? at;
      }
    } else {
      return null;
    }
    await recipient.save();
    return recipient.campaignId.toString();
  }

  private async onMessage(m: any, contactName?: string): Promise<string | null> {
    const phone = String(m.from || '').replace(/\D/g, '');
    if (!phone) return null;
    const text: string =
      m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type}]`;
    const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();

    // Same message twice (Meta retries until it gets a 200): record once.
    if (m.id && (await this.messageModel.exists({ waMessageId: m.id }))) return null;

    let recipient = m.context?.id ? await this.recipientModel.findOne({ waMessageId: m.context.id }).exec() : null;
    if (!recipient) {
      recipient = await this.recipientModel.findOne({ phone, sentAt: { $exists: true } }).sort({ sentAt: -1 }).exec();
    }
    const leadId =
      recipient?.leadId ?? (await this.leadModel.findOne({ phoneNormalized: `+${phone}` }).select('_id').exec())?._id;

    await this.messageModel.create({
      direction: 'in',
      phone,
      contactName,
      leadId,
      campaignId: recipient?.campaignId,
      type: m.type,
      text,
      waMessageId: m.id,
      at,
      handled: false,
    });

    const said = text.trim().toLowerCase();
    const wasStop = STOP_WORDS.includes(said);
    const wasYes = !wasStop && YES_WORDS.includes(said);
    if (recipient && !recipient.repliedAt) {
      recipient.repliedAt = at;
      recipient.replyText = text.slice(0, 500);
      await recipient.save();
    }

    let leadDoc: LeadDocument | null = null;
    if (leadId) {
      const lead = await this.leadModel.findById(leadId).exec();
      leadDoc = lead;
      if (lead) {
        lead.whatsappRepliedAt = at;
        if (wasStop) {
          lead.isWhatsappOptedOut = true;
          lead.whatsappOptedOutAt = at;
          if (recipient) {
            recipient.status = 'OPTED_OUT';
            await recipient.save();
          }
        } else if (wasYes) {
          if (lead.status !== 'INSTALLED') lead.status = 'INTERESTED';
        } else if (['NEW', 'REVIEWED', 'CONTACTED'].includes(lead.status)) {
          lead.status = 'REPLIED';
        }
        await lead.save();
      }
    }
    // The automatic reply, after the lead is up to date. Never lets a
    // failure there lose the message itself.
    await this.bot
      .onInbound({
        phone,
        lead: leadDoc,
        recipient,
        buttonId: m.interactive?.button_reply?.id ?? null,
        text,
        wasStop,
        wasYes,
      })
      .catch((err) => this.logger.error(`Assistant failed for ${phone}: ${(err as Error).message}`));

    return recipient ? recipient.campaignId.toString() : null;
  }

  private async optOut(leadId: Types.ObjectId, at: Date): Promise<void> {
    await this.leadModel.updateOne({ _id: leadId }, { $set: { isWhatsappOptedOut: true, whatsappOptedOutAt: at } });
  }
}
