/**
 * What the WhatsApp assistant says, and the words it listens for. English,
 * Hindi and Malayalam; Tamil and Kannada leads get English until those are
 * written. Kept short: these are read on a phone between jobs.
 *
 * Button titles are at most 20 characters (WhatsApp's limit) and their ids
 * are what comes back when one is tapped.
 */

import { isUaePhone } from '../lead-finder/countries';

export type BotLang = 'en' | 'hi' | 'ml';

export const BUTTON_IDS = {
  getApp: 'bot_get_app',
  demo: 'bot_demo',
  callMe: 'bot_call_me',
} as const;

export function botLang(code: string | undefined | null): BotLang {
  const c = (code || '').toLowerCase();
  if (c.startsWith('hi')) return 'hi';
  if (c.startsWith('ml')) return 'ml';
  return 'en';
}

interface Copy {
  welcome: string;
  buttons: { getApp: string; demo: string; callMe: string };
  getAppBody: string;
  getAppCta: string;
  demoBody: string;
  callMeReply: string;
  price: string;
  notInterested: string;
  stopped: string;
  ack: string;
  nudge: string;
  installWelcome: string;
}

export const COPY: Record<BotLang, Copy> = {
  en: {
    welcome:
      'Great! Agla Kaam reminds your customers on WhatsApp when their next service is due, so they call you again. Setup takes 2 minutes and it is free to start.',
    buttons: { getApp: '📲 Get the app', demo: '🎥 Watch demo', callMe: '📞 Call me' },
    getAppBody: 'Here is the app. Sign up with this same number, add a customer, and log their last service — the reminders start on their own.',
    getAppCta: 'Download app',
    demoBody: 'Short videos of how Agla Kaam works — each under a minute:',
    callMeReply: 'Thanks! Someone from Agla Kaam will call you on this number soon (10 am – 7 pm).',
    price: 'Free for up to 25 customers. Paid plans start at ₹799 a year — no card needed to start.',
    notInterested: 'No problem, thank you for replying. We won’t message you again. If you ever need it, just send "Hi".',
    stopped: 'Done — you won’t get any more messages from us.',
    ack: 'Thanks for your message! Someone from Agla Kaam will reply here shortly. Meanwhile, you can start free with the app:',
    nudge:
      'Did you get a chance to try Agla Kaam? Add one customer and their last service — the next reminder goes out on its own. Here is the app:',
    installWelcome:
      'Welcome to Agla Kaam! 🎉 Start with one thing: add a customer and log their last service. We’ll remind them when the next one is due.',
  },
  hi: {
    welcome:
      'बढ़िया! Agla Kaam आपके ग्राहकों को अगली सर्विस की तारीख पर WhatsApp पर याद दिलाता है, ताकि वे फिर आपको ही बुलाएँ। सेटअप 2 मिनट में, शुरुआत फ़्री।',
    buttons: { getApp: '📲 ऐप पाएँ', demo: '🎥 डेमो देखें', callMe: '📞 कॉल करें' },
    getAppBody: 'यह रहा ऐप। इसी नंबर से साइन अप करें, एक ग्राहक जोड़ें और उसकी पिछली सर्विस लिखें — रिमाइंडर अपने-आप शुरू हो जाएँगे।',
    getAppCta: 'ऐप डाउनलोड करें',
    demoBody: 'Agla Kaam कैसे काम करता है — एक-एक मिनट के छोटे वीडियो:',
    callMeReply: 'धन्यवाद! Agla Kaam से कोई जल्द ही इसी नंबर पर कॉल करेगा (सुबह 10 – शाम 7)।',
    price: '25 ग्राहकों तक बिल्कुल फ़्री। पेड प्लान ₹799 प्रति वर्ष से — शुरू करने के लिए कोई कार्ड नहीं चाहिए।',
    notInterested: 'कोई बात नहीं, जवाब देने के लिए धन्यवाद। हम आपको दोबारा मैसेज नहीं करेंगे। कभी ज़रूरत हो तो बस "Hi" भेजें।',
    stopped: 'ठीक है — अब आपको हमारी तरफ़ से कोई मैसेज नहीं आएगा।',
    ack: 'मैसेज के लिए धन्यवाद! Agla Kaam से कोई जल्द ही यहाँ जवाब देगा। तब तक ऐप फ़्री में शुरू करें:',
    nudge: 'क्या आपने Agla Kaam आज़माया? एक ग्राहक और उसकी पिछली सर्विस जोड़ें — अगला रिमाइंडर अपने-आप जाएगा। यह रहा ऐप:',
    installWelcome:
      'Agla Kaam में आपका स्वागत है! 🎉 शुरुआत एक काम से करें: एक ग्राहक जोड़ें और उसकी पिछली सर्विस लिखें। अगली सर्विस पर हम उसे याद दिला देंगे।',
  },
  ml: {
    welcome:
      'നന്നായി! കസ്റ്റമറുടെ അടുത്ത സർവീസ് ഡേറ്റ് ആകുമ്പോൾ Agla Kaam അവരെ WhatsApp-ൽ ഓർമ്മിപ്പിക്കും, അവർ വീണ്ടും നിങ്ങളെ വിളിക്കും. സെറ്റപ്പ് 2 മിനിറ്റ്, ഫ്രീ ആയി തുടങ്ങാം.',
    buttons: { getApp: '📲 ആപ്പ് എടുക്കാം', demo: '🎥 ഡെമോ കാണാം', callMe: '📞 വിളിക്കൂ' },
    getAppBody: 'ഇതാ ആപ്പ്. ഇതേ നമ്പറിൽ സൈൻ അപ്പ് ചെയ്യുക, ഒരു കസ്റ്റമറെ ചേർത്ത് അവസാന സർവീസ് രേഖപ്പെടുത്തുക — റിമൈൻഡറുകൾ സ്വയം തുടങ്ങും.',
    getAppCta: 'ആപ്പ് ഡൗൺലോഡ്',
    demoBody: 'Agla Kaam എങ്ങനെ പ്രവർത്തിക്കുന്നു — ഓരോന്നും ഒരു മിനിറ്റിൽ താഴെയുള്ള വീഡിയോകൾ:',
    callMeReply: 'നന്ദി! Agla Kaam-ൽ നിന്ന് ഉടൻ ഈ നമ്പറിൽ വിളിക്കും (രാവിലെ 10 – വൈകിട്ട് 7).',
    price: '25 കസ്റ്റമർ വരെ പൂർണ്ണമായും ഫ്രീ. പെയ്ഡ് പ്ലാൻ വർഷം ₹799 മുതൽ — തുടങ്ങാൻ കാർഡ് വേണ്ട.',
    notInterested: 'കുഴപ്പമില്ല, മറുപടിക്ക് നന്ദി. ഇനി മെസ്സേജ് അയക്കില്ല. എപ്പോഴെങ്കിലും വേണമെങ്കിൽ "Hi" എന്ന് അയച്ചാൽ മതി.',
    stopped: 'ശരി — ഇനി ഞങ്ങളിൽ നിന്ന് മെസ്സേജുകൾ വരില്ല.',
    ack: 'മെസ്സേജിന് നന്ദി! Agla Kaam-ൽ നിന്ന് ഉടൻ ഇവിടെ മറുപടി ലഭിക്കും. അതുവരെ ആപ്പ് ഫ്രീ ആയി തുടങ്ങാം:',
    nudge: 'Agla Kaam ഒന്ന് നോക്കിയോ? ഒരു കസ്റ്റമറെയും അവസാന സർവീസും ചേർക്കൂ — അടുത്ത റിമൈൻഡർ സ്വയം പോകും. ഇതാ ആപ്പ്:',
    installWelcome:
      'Agla Kaam-ലേക്ക് സ്വാഗതം! 🎉 ആദ്യം ഒരു കാര്യം: ഒരു കസ്റ്റമറെ ചേർത്ത് അവസാന സർവീസ് രേഖപ്പെടുത്തുക. അടുത്ത സർവീസിന് ഞങ്ങൾ അവരെ ഓർമ്മിപ്പിക്കും.',
  },
};

// The same price for a UAE number (common/constants/subscription-options: AED 49).
const PRICE_AED: Record<BotLang, string> = {
  en: 'Free for up to 25 customers. Paid plans start at AED 49 a year — no card needed to start.',
  hi: '25 ग्राहकों तक बिल्कुल फ़्री। पेड प्लान AED 49 प्रति वर्ष से — शुरू करने के लिए कोई कार्ड नहीं चाहिए।',
  ml: '25 കസ്റ്റമർ വരെ പൂർണ്ണമായും ഫ്രീ. പെയ്ഡ് പ്ലാൻ വർഷം AED 49 മുതൽ — തുടങ്ങാൻ കാർഡ് വേണ്ട.',
};

/** The price reply, in dirhams for a UAE number and rupees otherwise. */
export function priceLine(lang: BotLang, phone: string): string {
  return isUaePhone(phone) ? PRICE_AED[lang] : COPY[lang].price;
}

// Words people type, by meaning, in English, Hindi (both scripts) and
// Malayalam (both scripts). Matched as whole words or phrases after
// lowercasing, so "no" does not fire inside "know".
export const KEYWORDS = {
  price: ['price', 'cost', 'charges', 'charge', 'fees', 'fee', 'rate', 'how much', 'kitna', 'kitne', 'paisa', 'कीमत', 'कितना', 'कितने', 'चार्ज', 'फीस', 'വില', 'എത്ര', 'ചാർജ്', 'rupees', 'free'],
  demo: ['demo', 'video', 'how', 'how it works', 'details', 'detail', 'kaise', 'डेमो', 'वीडियो', 'कैसे', 'ഡെമോ', 'വീഡിയോ', 'എങ്ങനെ'],
  callMe: ['call', 'call me', 'phone', 'baat', 'talk', 'contact', 'कॉल', 'फोन', 'बात', 'വിളിക്കൂ', 'വിളിക്കുക', 'ഫോൺ', 'വിളി'],
  getApp: ['app', 'download', 'link', 'install', 'yes', 'ok', 'okay', 'sure', 'interested', 'haan', 'ha', 'हाँ', 'हां', 'ठीक', 'ऐप', 'ലിങ്ക്', 'ആപ്പ്', 'ശരി', 'അതെ'],
  no: ['no', 'not interested', 'nahi', 'nahin', 'नहीं', 'नही', 'വേണ്ട', 'താല്പര്യമില്ല'],
} as const;

export type Intent = keyof typeof KEYWORDS;

/** The first meaning found in what they wrote, checked most specific first. */
export function intentOf(text: string): Intent | null {
  const said = ` ${text.toLowerCase().replace(/[!?.,।]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const order: Intent[] = ['no', 'callMe', 'price', 'demo', 'getApp'];
  for (const intent of order) {
    for (const word of KEYWORDS[intent]) {
      if (said.includes(` ${word} `)) return intent;
    }
  }
  return null;
}

/**
 * The demo videos "Watch demo" sends, in the order a new owner meets them.
 * YouTube Shorts, each under a minute.
 */
export const DEMO_VIDEOS: { url: string; title: Record<BotLang, string> }[] = [
  {
    url: 'https://youtube.com/shorts/o9ko2AmHVE4',
    title: {
      en: 'Create a quick note reminder',
      hi: 'क्विक नोट रिमाइंडर बनाएँ',
      ml: 'ക്വിക്ക് നോട്ട് റിമൈൻഡർ ഉണ്ടാക്കാം',
    },
  },
  {
    url: 'https://youtube.com/shorts/oiRVjI9eoPM',
    title: {
      en: 'Book services and set follow-up reminders',
      hi: 'सर्विस बुक करें और फॉलो-अप रिमाइंडर लगाएँ',
      ml: 'സർവീസ് ബുക്ക് ചെയ്ത് ഫോളോ-അപ്പ് റിമൈൻഡർ വെക്കാം',
    },
  },
  {
    url: 'https://youtube.com/shorts/g3mWslYrsEQ',
    title: {
      en: 'Add technicians and assign jobs',
      hi: 'टेक्नीशियन जोड़ें और काम सौंपें',
      ml: 'ടെക്നീഷ്യനെ ചേർത്ത് ജോലി ഏൽപ്പിക്കാം',
    },
  },
  {
    url: 'https://youtube.com/shorts/dX76fYjlj_Q',
    title: {
      en: 'Complete jobs, create invoices and set reminders',
      hi: 'काम पूरा करें, बिल बनाएँ और रिमाइंडर लगाएँ',
      ml: 'ജോലി പൂർത്തിയാക്കി ബിൽ ഉണ്ടാക്കി റിമൈൻഡർ വെക്കാം',
    },
  },
];

/** "Watch demo": the intro, then each video numbered with its title. */
export function demoMessage(lang: BotLang): string {
  const lines = DEMO_VIDEOS.map((v, i) => `${i + 1}. ${v.title[lang]}\n${v.url}`);
  return [COPY[lang].demoBody, ...lines].join('\n\n');
}

// Lead categories are free text from the search ("AC repair service",
// "RO water purifier service"); the trade word shown in the owner note.
const TRADE_WORDS: [RegExp, string][] = [
  [/\b(ac|a\.c\.?|air ?condition\w*|hvac)\b/i, 'AC'],
  [/\b(ro|water purifier)\b/i, 'RO'],
  [/\b(fridge|refrigerat\w*)\b/i, 'fridge'],
  [/\bwashing machine\b/i, 'washing machine'],
  [/\bpest\b/i, 'pest control'],
  [/\b(inverter|ups|batter\w*)\b/i, 'inverter'],
  [/\b(car|bike|two wheeler|vehicle)\b/i, 'vehicle'],
];

export function tradeWord(category: string | undefined | null): string | null {
  const c = category || '';
  return TRADE_WORDS.find(([re]) => re.test(c))?.[1] ?? null;
}

/**
 * Sent once when a business's WhatsApp Business answers our first message
 * automatically: their greeting opens the free 24-hour window, and the owner
 * reads the chat later — so this is written to them, not to their bot.
 */
export function ownerNote(lang: BotLang, trade: string | null, demoUrl: string): string {
  const t = trade ? `${trade} ` : '';
  if (lang === 'hi') {
    return `नमस्ते! यह मैसेज मालिक के लिए है 🙂 Agla Kaam आपके ग्राहकों को अगली ${t}सर्विस की तारीख पर WhatsApp पर याद दिलाता है, ताकि वे फिर आपको ही बुलाएँ।\n\n1 मिनट का डेमो: ${demoUrl}\n\nनीचे टैप करके ऐप डाउनलोड करें, या YES लिखें।`;
  }
  if (lang === 'ml') {
    return `നമസ്കാരം! ഈ മെസ്സേജ് ഉടമയ്ക്കുള്ളതാണ് 🙂 കസ്റ്റമറുടെ അടുത്ത ${t}സർവീസ് ഡേറ്റ് ആകുമ്പോൾ Agla Kaam അവരെ WhatsApp-ൽ ഓർമ്മിപ്പിക്കും, അവർ വീണ്ടും നിങ്ങളെ വിളിക്കും.\n\n1 മിനിറ്റ് ഡെമോ: ${demoUrl}\n\nതാഴെ ടാപ്പ് ചെയ്ത് ആപ്പ് ഡൗൺലോഡ് ചെയ്യൂ, അല്ലെങ്കിൽ YES എന്ന് മറുപടി അയക്കൂ.`;
  }
  return `Hi! This message is for the owner 🙂 Agla Kaam reminds your customers on WhatsApp when their next ${t}service is due, so they call you again.\n\n1-minute demo: ${demoUrl}\n\nTap below to download the app, or reply YES.`;
}

/** The demo that shows the reminder itself: booking a service with a follow-up. */
export const OWNER_NOTE_DEMO = DEMO_VIDEOS[1].url;
