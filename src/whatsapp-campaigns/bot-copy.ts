/**
 * What the WhatsApp assistant says, and the words it listens for. English,
 * Hindi and Malayalam; Tamil and Kannada leads get English until those are
 * written. Kept short: these are read on a phone between jobs.
 *
 * Button titles are at most 20 characters (WhatsApp's limit) and their ids
 * are what comes back when one is tapped.
 */

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
    demoBody: 'A 2-minute look at how it works:',
    callMeReply: 'Thanks! Someone from Agla Kaam will call you on this number soon (10 am – 7 pm).',
    price: 'Free for up to 25 customers. Paid plans start at ₹799 a year — no card needed to start.',
    notInterested: 'No problem, thank you for replying. We won’t message you again. If you ever need it, just send "Hi".',
    stopped: 'Done — you won’t get any more messages from us.',
    ack: 'Thanks for your message! Someone from Agla Kaam will reply here shortly.',
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
    demoBody: '2 मिनट में देखें यह कैसे काम करता है:',
    callMeReply: 'धन्यवाद! Agla Kaam से कोई जल्द ही इसी नंबर पर कॉल करेगा (सुबह 10 – शाम 7)।',
    price: '25 ग्राहकों तक बिल्कुल फ़्री। पेड प्लान ₹799 प्रति वर्ष से — शुरू करने के लिए कोई कार्ड नहीं चाहिए।',
    notInterested: 'कोई बात नहीं, जवाब देने के लिए धन्यवाद। हम आपको दोबारा मैसेज नहीं करेंगे। कभी ज़रूरत हो तो बस "Hi" भेजें।',
    stopped: 'ठीक है — अब आपको हमारी तरफ़ से कोई मैसेज नहीं आएगा।',
    ack: 'मैसेज के लिए धन्यवाद! Agla Kaam से कोई जल्द ही यहाँ जवाब देगा।',
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
    demoBody: '2 മിനിറ്റിൽ എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് കാണാം:',
    callMeReply: 'നന്ദി! Agla Kaam-ൽ നിന്ന് ഉടൻ ഈ നമ്പറിൽ വിളിക്കും (രാവിലെ 10 – വൈകിട്ട് 7).',
    price: '25 കസ്റ്റമർ വരെ പൂർണ്ണമായും ഫ്രീ. പെയ്ഡ് പ്ലാൻ വർഷം ₹799 മുതൽ — തുടങ്ങാൻ കാർഡ് വേണ്ട.',
    notInterested: 'കുഴപ്പമില്ല, മറുപടിക്ക് നന്ദി. ഇനി മെസ്സേജ് അയക്കില്ല. എപ്പോഴെങ്കിലും വേണമെങ്കിൽ "Hi" എന്ന് അയച്ചാൽ മതി.',
    stopped: 'ശരി — ഇനി ഞങ്ങളിൽ നിന്ന് മെസ്സേജുകൾ വരില്ല.',
    ack: 'മെസ്സേജിന് നന്ദി! Agla Kaam-ൽ നിന്ന് ഉടൻ ഇവിടെ മറുപടി ലഭിക്കും.',
    nudge: 'Agla Kaam ഒന്ന് നോക്കിയോ? ഒരു കസ്റ്റമറെയും അവസാന സർവീസും ചേർക്കൂ — അടുത്ത റിമൈൻഡർ സ്വയം പോകും. ഇതാ ആപ്പ്:',
    installWelcome:
      'Agla Kaam-ലേക്ക് സ്വാഗതം! 🎉 ആദ്യം ഒരു കാര്യം: ഒരു കസ്റ്റമറെ ചേർത്ത് അവസാന സർവീസ് രേഖപ്പെടുത്തുക. അടുത്ത സർവീസിന് ഞങ്ങൾ അവരെ ഓർമ്മിപ്പിക്കും.',
  },
};

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
