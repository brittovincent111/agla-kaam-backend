import { Types } from 'mongoose';
import { WhatsappBotService } from './whatsapp-bot.service';
import { BUTTON_IDS, COPY, intentOf } from '../bot-copy';

// The WhatsApp assistant: what it answers, when it stays quiet, and its
// follow-ups. Models are small fakes; the cloud service records what would
// have been sent.

const PHONE = '919876543210';
const LEAD_ID = new Types.ObjectId();

const execOf = (v: unknown) => ({ exec: jest.fn().mockResolvedValue(v) });

function build(opts: { config?: Record<string, string>; leads?: any[]; budgetUsed?: number } = {}) {
  const lead: any = {
    _id: LEAD_ID,
    businessName: 'Sharma AC',
    city: 'Kochi',
    status: 'INTERESTED',
    whatsappLanguage: 'en',
  };
  const updates: any[] = [];
  const leadModel: any = {
    updateOne: jest.fn((filter: any, update: any) => {
      updates.push({ filter, update });
      return execOf({ modifiedCount: 1 });
    }),
    find: jest.fn(() => ({ limit: () => execOf(opts.leads ?? []) })),
  };
  const created: any[] = [];
  const messageModel: any = {
    create: jest.fn(async (doc: any) => {
      created.push(doc);
      return doc;
    }),
    findOne: jest.fn(() => ({ sort: () => ({ select: () => ({ lean: () => execOf({ phone: PHONE }) }) }) })),
    countDocuments: jest.fn(() => execOf(0)),
    exists: jest.fn(() => execOf(null)),
  };
  const recipientModel: any = {
    findOne: jest.fn(() => ({ sort: () => execOf(null) })),
    countDocuments: jest.fn(() => execOf(opts.budgetUsed ?? 0)),
  };
  const campaignModel: any = { findById: jest.fn(() => ({ select: () => ({ lean: () => execOf(null) }) })) };
  const cloud: any = {
    isConfigured: () => true,
    sendText: jest.fn(async () => 'wamid.text'),
    sendButtons: jest.fn(async () => 'wamid.buttons'),
    sendLinkButton: jest.fn(async () => 'wamid.link'),
    sendTemplate: jest.fn(async () => 'wamid.template'),
  };
  const config: any = { get: (k: string) => (opts.config ?? {})[k] };
  const email: any = { sendPlain: jest.fn(async () => undefined) };
  const bot = new WhatsappBotService(leadModel, messageModel, recipientModel, campaignModel, cloud, config, email);
  return { bot, lead, leadModel, cloud, email, created, updates };
}

const event = (lead: any, fields: Partial<Parameters<WhatsappBotService['onInbound']>[0]> = {}) => ({
  phone: PHONE,
  lead,
  recipient: null,
  buttonId: null,
  text: '',
  wasStop: false,
  wasYes: false,
  ...fields,
});

describe('reading what people write', () => {
  it.each([
    ['How much does it cost?', 'price'],
    ['kitna hai', 'price'],
    ['വില എത്ര', 'price'],
    ['please call me', 'callMe'],
    ['send demo video', 'demo'],
    ['ok send the link', 'getApp'],
    ['no thanks', 'no'],
    ['नहीं चाहिए', 'no'],
    ['I know this already', null],
    ['what is your address', null],
  ])('%s → %s', (text, intent) => {
    expect(intentOf(text)).toBe(intent);
  });
});

describe('replies', () => {
  it('"Yes, show me" gets the welcome with three buttons, once', async () => {
    const { bot, lead, cloud, updates } = build();
    await bot.onInbound(event(lead, { wasYes: true, text: 'Yes, show me' }));
    expect(cloud.sendButtons).toHaveBeenCalledWith(PHONE, COPY.en.welcome, [
      { id: BUTTON_IDS.getApp, title: COPY.en.buttons.getApp },
      { id: BUTTON_IDS.demo, title: COPY.en.buttons.demo },
      { id: BUTTON_IDS.callMe, title: COPY.en.buttons.callMe },
    ]);
    expect(updates.some((u) => u.update.$set?.whatsappBotWelcomedAt)).toBe(true);

    lead.whatsappBotWelcomedAt = new Date();
    cloud.sendButtons.mockClear();
    await bot.onInbound(event(lead, { wasYes: true }));
    expect(cloud.sendButtons).not.toHaveBeenCalled();
  });

  it('"Get the app" sends the tracked download link', async () => {
    const { bot, lead, cloud } = build({ config: { PUBLIC_API_URL: 'https://api.example.com' } });
    await bot.onInbound(event(lead, { buttonId: BUTTON_IDS.getApp }));
    expect(cloud.sendLinkButton).toHaveBeenCalledWith(
      PHONE,
      COPY.en.getAppBody,
      COPY.en.getAppCta,
      `https://api.example.com/api/whatsapp/go/${LEAD_ID}`,
    );
  });

  it('"Watch demo" sends the video in their language, then the app', async () => {
    const { bot, lead, cloud } = build({ config: { WHATSAPP_DEMO_VIDEO_URL_HI: 'https://youtu.be/hindi' } });
    lead.whatsappLanguage = 'hi';
    await bot.onInbound(event(lead, { buttonId: BUTTON_IDS.demo }));
    expect(cloud.sendText).toHaveBeenCalledWith(PHONE, `${COPY.hi.demoBody}\nhttps://youtu.be/hindi`);
    expect(cloud.sendLinkButton).toHaveBeenCalled();
  });

  it('"Call me" thanks them and alerts the admin by email and WhatsApp, once', async () => {
    const { bot, lead, cloud, email } = build({ config: { ADMIN_EMAIL: 'admin@x.in', WHATSAPP_ALERT_TO: '+91 90000 00000' } });
    await bot.onInbound(event(lead, { buttonId: BUTTON_IDS.callMe }));
    expect(cloud.sendText).toHaveBeenCalledWith(PHONE, COPY.en.callMeReply);
    expect(email.sendPlain).toHaveBeenCalledWith('admin@x.in', expect.stringContaining('Sharma AC'), expect.any(String));
    expect(cloud.sendText).toHaveBeenCalledWith('919000000000', expect.stringContaining(`+${PHONE}`));

    lead.callRequestedAt = new Date();
    email.sendPlain.mockClear();
    await bot.onInbound(event(lead, { buttonId: BUTTON_IDS.callMe }));
    expect(email.sendPlain).not.toHaveBeenCalled();
  });

  it('a WhatsApp alert that cannot be delivered does not stop the reply', async () => {
    const { bot, lead, cloud } = build({ config: { WHATSAPP_ALERT_TO: '919000000000' } });
    cloud.sendText.mockImplementation(async (to: string) => {
      if (to === '919000000000') throw new Error('re-engagement required');
      return 'wamid.ok';
    });
    await expect(bot.onInbound(event(lead, { buttonId: BUTTON_IDS.callMe }))).resolves.toBeUndefined();
  });

  it('a price question gets the price with the buttons, and counts as interest', async () => {
    const { bot, lead, cloud, updates } = build();
    lead.status = 'CONTACTED';
    await bot.onInbound(event(lead, { text: 'how much?' }));
    expect(cloud.sendButtons).toHaveBeenCalledWith(PHONE, COPY.en.price, expect.any(Array));
    expect(updates.some((u) => u.update.$set?.status === 'INTERESTED')).toBe(true);
  });

  it('"no" is thanked, marked not interested, and opted out', async () => {
    const { bot, lead, cloud, updates } = build();
    await bot.onInbound(event(lead, { text: 'not interested' }));
    expect(cloud.sendText).toHaveBeenCalledWith(PHONE, COPY.en.notInterested);
    const set = updates.find((u) => u.update.$set?.status === 'NOT_INTERESTED')?.update.$set;
    expect(set).toMatchObject({ isWhatsappOptedOut: true });
  });

  it('anything else: says a person will reply, then stays out of the chat', async () => {
    const { bot, lead, cloud, updates } = build();
    await bot.onInbound(event(lead, { text: 'do you also service fridges in Aluva' }));
    expect(cloud.sendText).toHaveBeenCalledWith(PHONE, COPY.en.ack);
    expect(updates.some((u) => u.update.$set?.whatsappBotPausedAt)).toBe(true);
  });

  it('says nothing once a person has taken over — except to confirm a stop', async () => {
    const { bot, lead, cloud } = build();
    lead.whatsappBotPausedAt = new Date();
    await bot.onInbound(event(lead, { wasYes: true }));
    expect(cloud.sendButtons).not.toHaveBeenCalled();
    expect(cloud.sendText).not.toHaveBeenCalled();
    await bot.onInbound(event(lead, { wasStop: true }));
    expect(cloud.sendText).toHaveBeenCalledWith(PHONE, COPY.en.stopped);
  });

  it('every reply is recorded in the inbox as automatic', async () => {
    const { bot, lead, created } = build();
    await bot.onInbound(event(lead, { buttonId: BUTTON_IDS.getApp }));
    expect(created[0]).toMatchObject({ direction: 'out', phone: PHONE, auto: true, sentBy: 'bot' });
  });

  it('can be turned off', async () => {
    const { bot, lead, cloud } = build({ config: { WHATSAPP_BOT: 'off' } });
    await bot.onInbound(event(lead, { wasYes: true }));
    expect(cloud.sendButtons).not.toHaveBeenCalled();
  });

  it('"Yes, show me" from someone not in the leads (a test send) still gets the welcome', async () => {
    const { bot, cloud } = build();
    await bot.onInbound(event(null, { wasYes: true, text: 'Yes, show me' }));
    expect(cloud.sendButtons).toHaveBeenCalledWith(PHONE, COPY.en.welcome, expect.any(Array));
  });

  it('a stranger answering in Malayalam gets Malayalam', async () => {
    const { bot, cloud } = build();
    await bot.onInbound(event(null, { wasYes: true, text: 'ശരി, കാണിക്കൂ' }));
    expect(cloud.sendButtons).toHaveBeenCalledWith(PHONE, COPY.ml.welcome, expect.any(Array));
  });

  it("a stranger's \"Call me\" still alerts the admin", async () => {
    const { bot, email } = build({ config: { ADMIN_EMAIL: 'admin@x.in' } });
    await bot.onInbound(event(null, { buttonId: BUTTON_IDS.callMe }));
    expect(email.sendPlain).toHaveBeenCalledWith('admin@x.in', expect.stringContaining('not in your leads'), expect.any(String));
  });
});

describe('follow-ups', () => {
  const quietLead = () => ({ _id: new Types.ObjectId(), businessName: 'Kerala Cool', status: 'INTERESTED', whatsappLanguage: 'ml' });

  it('nudges an interested lead before the free window closes', async () => {
    const lead = quietLead();
    const { bot, cloud } = build({ leads: [lead] });
    expect(await bot.sendNudges()).toBe(1);
    expect(cloud.sendLinkButton).toHaveBeenCalledWith(PHONE, COPY.ml.nudge, COPY.ml.getAppCta, expect.stringContaining(String(lead._id)));
  });

  it('sends no paid follow-up without an approved template set', async () => {
    const { bot, cloud } = build({ leads: [quietLead()] });
    expect(await bot.sendTemplateFollowUps()).toBe(0);
    expect(cloud.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends the day-3 template, recorded so it counts against the budget', async () => {
    const lead = quietLead();
    const { bot, cloud, created } = build({ leads: [lead], config: { WHATSAPP_FOLLOWUP_TEMPLATE: 'aglakaam_follow_up' } });
    expect(await bot.sendTemplateFollowUps()).toBe(1);
    expect(cloud.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'aglakaam_follow_up', languageCode: 'ml', bodyParams: ['Kerala Cool'] }),
    );
    expect(created[0]).toMatchObject({ sentBy: 'bot-followup', auto: true });
  });

  it('sends no paid follow-up once the monthly budget is used', async () => {
    const { bot, cloud } = build({
      leads: [quietLead()],
      budgetUsed: 10_000,
      config: { WHATSAPP_FOLLOWUP_TEMPLATE: 'aglakaam_follow_up', OUTREACH_MONTHLY_BUDGET_INR: '3000' },
    });
    expect(await bot.sendTemplateFollowUps()).toBe(0);
    expect(cloud.sendTemplate).not.toHaveBeenCalled();
  });

  it('welcomes a lead who installed while the chat was open', async () => {
    const lead = { ...quietLead(), status: 'INSTALLED' };
    const { bot, cloud } = build({ leads: [lead] });
    expect(await bot.welcomeInstalls()).toBe(1);
    expect(cloud.sendText).toHaveBeenCalledWith(PHONE, COPY.ml.installWelcome);
  });
});

describe('the download link', () => {
  it('records the click and sends them on to the download page', async () => {
    const { bot, updates } = build({ config: { WHATSAPP_DOWNLOAD_URL: 'https://aglakaam.app/download' } });
    await expect(bot.clicked(String(LEAD_ID))).resolves.toBe('https://aglakaam.app/download');
    expect(updates[0].update.$set.whatsappClickedAt).toBeInstanceOf(Date);
  });

  it('a made-up id still goes to the download page', async () => {
    const { bot, updates } = build();
    await expect(bot.clicked('nonsense')).resolves.toBe('https://aglakaam.app/download');
    expect(updates).toHaveLength(0);
  });
});
