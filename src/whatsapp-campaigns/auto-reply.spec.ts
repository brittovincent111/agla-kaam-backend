import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { looksLikeAutoReply } from './auto-reply';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';

describe('looksLikeAutoReply', () => {
  it.each([
    'Thank you for contacting Cool Air Services! We will get back to you shortly.',
    'Hello! Welcome to Sharma Electricals. How can we help you?',
    'We are currently closed. Our business hours are 9am to 7pm.',
    'संपर्क करने के लिए धन्यवाद। हम जल्द ही आपसे संपर्क करेंगे।',
  ])('spots a business greeting: %s', (text) => {
    expect(looksLikeAutoReply(text)).toBe(true);
  });

  it.each([
    'Yes',
    'Price kitna hai?',
    'Call me tomorrow',
    'How does it work?',
    'STOP',
    'Interested, send details',
  ])('leaves a person alone: %s', (text) => {
    expect(looksLikeAutoReply(text, 3600)).toBe(false);
  });

  it('treats a long answer within seconds as automatic, a short one as a person', () => {
    const long =
      'Hi, this is Ravi from RK Refrigeration, AC and fridge repairs across Kochi, any day.';
    expect(looksLikeAutoReply(long, 4)).toBe(true);
    expect(looksLikeAutoReply(long, 300)).toBe(false);
    expect(looksLikeAutoReply('Yes tell me', 4)).toBe(false);
  });
});

describe('WhatsApp webhook with an auto-reply', () => {
  const sentAt = new Date('2026-10-12T05:00:00Z');
  const leadId = new Types.ObjectId();
  const campaignId = new Types.ObjectId();

  function build() {
    const recipient: any = { leadId, campaignId, sentAt, save: jest.fn() };
    const lead: any = { _id: leadId, status: 'CONTACTED', save: jest.fn() };
    const exec = (v: unknown) => ({ exec: jest.fn().mockResolvedValue(v) });
    const recipientModel: any = {
      findOne: jest.fn(() => ({ sort: () => exec(recipient) })),
    };
    const messageModel: any = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const leadModel: any = {
      findById: jest.fn(() => exec(lead)),
      updateOne: jest.fn(() => exec({})),
    };
    const queue: any = { syncCounters: jest.fn() };
    const bot: any = { onInbound: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new WhatsappWebhookService(
      recipientModel,
      messageModel,
      leadModel,
      queue,
      bot,
    );
    return { service, recipient, lead, messageModel, leadModel, bot };
  }

  const inbound = (message: Record<string, unknown>) => ({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: '919000000001',
                  id: 'wamid.IN',
                  timestamp: String(sentAt.getTime() / 1000 + 5),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps it in the inbox but counts no reply, changes no status and sends nothing back', async () => {
    const { service, recipient, lead, messageModel, leadModel, bot } = build();
    await service.handle(
      inbound({
        type: 'text',
        text: { body: 'Thank you for contacting us! How can we help you?' },
      }),
    );

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ autoReply: true, handled: true }),
    );
    expect(recipient.repliedAt).toBeUndefined();
    expect(recipient.save).not.toHaveBeenCalled();
    expect(lead.status).toBe('CONTACTED');
    expect(lead.save).not.toHaveBeenCalled();
    expect(leadModel.updateOne).toHaveBeenCalledWith(
      { _id: leadId },
      { $set: { whatsappAutoReplyAt: expect.any(Date) } },
    );
    expect(bot.onInbound).not.toHaveBeenCalled();
  });

  it('still counts a tapped button even if it arrives within seconds', async () => {
    const { service, recipient, lead, messageModel, bot } = build();
    await service.handle(
      inbound({ type: 'button', button: { text: 'Yes, show me' } }),
    );

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ autoReply: true }),
    );
    expect(recipient.repliedAt).toBeInstanceOf(Date);
    expect(lead.status).toBe('INTERESTED');
    expect(bot.onInbound).toHaveBeenCalled();
  });

  it('still counts a person typing a question', async () => {
    const { service, lead, bot } = build();
    await service.handle(
      inbound({ type: 'text', text: { body: 'how much per month?' } }),
    );

    expect(lead.status).toBe('REPLIED');
    expect(bot.onInbound).toHaveBeenCalled();
  });
});
