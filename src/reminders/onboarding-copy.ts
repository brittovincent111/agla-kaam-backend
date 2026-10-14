/**
 * The nudges that bring a new owner back until Agla Kaam is actually working
 * for them: first a customer, then that customer's last service (which sets
 * the first automatic reminder). After that the 8 AM due-service push takes
 * over. Short, personal, one clear step each — and the push opens the screen
 * for that step.
 */

export type OnboardingStage = 'setup' | 'customer' | 'service';
type Lang = 'en' | 'hi';

export interface NudgeInput {
  businessName: string;
  tradeType?: string | null;
  language?: string | null;
  // The newest customer, for the "service" stage.
  customerName?: string | null;
}

export interface Nudge {
  title: string;
  body: string;
  data: Record<string, string>;
}

// Business.tradeType values (service-options.ts) → the word used in a sentence.
const TRADE: [RegExp, { en: string; hi: string }][] = [
  [/^ac\b/i, { en: 'AC', hi: 'AC' }],
  [/\bro\b|purifier/i, { en: 'RO', hi: 'RO' }],
  [/appliance/i, { en: 'appliance', hi: 'अप्लायंस' }],
  [/garage|vehicle/i, { en: 'vehicle', hi: 'गाड़ी' }],
  [/cctv/i, { en: 'CCTV', hi: 'CCTV' }],
  [/inverter|battery|solar/i, { en: 'inverter', hi: 'इन्वर्टर' }],
  [/pest/i, { en: 'pest control', hi: 'पेस्ट कंट्रोल' }],
];

function trade(t: string | null | undefined, lang: Lang): string {
  const hit = TRADE.find(([re]) => re.test(t || ''));
  return hit ? `${hit[1][lang]} ` : '';
}

const short = (s: string | null | undefined, n = 28) => {
  const v = (s || '').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

/** How many nudges a stage has; `nudge()` returns null past the last. */
export const NUDGES_PER_STAGE = 5;

export function onboardingNudge(stage: OnboardingStage, index: number, input: NudgeInput): Nudge | null {
  const lang: Lang = input.language === 'hi' ? 'hi' : 'en';
  const shop = short(input.businessName) || (lang === 'hi' ? 'आपकी दुकान' : 'your shop');
  const tr = trade(input.tradeType, lang);
  const cust = short(input.customerName, 24);

  if (stage === 'setup') {
    // Signed in, but the setup screen (phone + trade) isn't done: the app
    // opens straight onto it, so any screen key works.
    const data = { screen: 'Home' };
    const en: [string, string][] = [
      ['Your Agla Kaam account is ready 👋', '1 minute left — add your phone number and trade, then start reminding customers.'],
      ['Finish setup in 1 minute', 'Add your phone number and trade to unlock service reminders, GST bills and WhatsApp follow-ups.'],
      ['Don’t lose this month’s customers', 'Finish setup and add the customers you serviced — the app tells you when each is due again.'],
      ['Still want reminders for your customers?', 'Your account is waiting. Tap to finish setup — it takes a minute.'],
      ['Need help setting up? 🙏', 'Reply on our WhatsApp and we’ll finish it with you.'],
    ];
    const hi: [string, string][] = [
      ['आपका Agla Kaam अकाउंट तैयार है 👋', 'बस 1 मिनट — अपना फ़ोन नंबर और काम चुनिए, फिर कस्टमर को रिमाइंडर शुरू।'],
      ['1 मिनट में सेटअप पूरा कीजिए', 'फ़ोन नंबर और काम जोड़िए — सर्विस रिमाइंडर, GST बिल और WhatsApp फ़ॉलो-अप चालू।'],
      ['इस महीने के कस्टमर मत खोइए', 'सेटअप पूरा कीजिए और कस्टमर जोड़िए — किसकी सर्विस कब ड्यू है, ऐप बताएगा।'],
      ['कस्टमर के लिए रिमाइंडर चाहिए?', 'आपका अकाउंट इंतज़ार कर रहा है। टैप करके सेटअप पूरा कीजिए — 1 मिनट।'],
      ['सेटअप में मदद चाहिए? 🙏', 'हमें WhatsApp कीजिए — साथ में पूरा कर देंगे।'],
    ];
    const pick = (lang === 'hi' ? hi : en)[index];
    return pick ? { title: pick[0], body: pick[1], data } : null;
  }

  if (stage === 'customer') {
    const data = { screen: 'AddCustomer' };
    const en: [string, string][] = [
      ['Add your first customer 👋', `${shop}, it takes 30 seconds. Add one customer and we'll remind you when their next ${tr}service is due.`],
      ['Your customers forget. Agla Kaam won’t.', `Add the customers you serviced this month — you'll know exactly when each one is due again.`],
      ['Free reminders are waiting 🔔', `Add 5 customers today and stop losing repeat ${tr}jobs to someone else.`],
      ['Big companies call every customer back', `Now ${shop} can too. Add a customer → log the job → the reminder is set.`],
      ['Need a hand getting started? 🙏', `Add your first customer in 30 seconds. Stuck? Reply on our WhatsApp and we'll set it up with you.`],
    ];
    const hi: [string, string][] = [
      ['अपना पहला कस्टमर जोड़िए 👋', `${shop}, बस 30 सेकंड लगेंगे। एक कस्टमर जोड़िए — अगली ${tr}सर्विस का टाइम हम याद दिलाएँगे।`],
      ['कस्टमर भूल जाते हैं। Agla Kaam नहीं भूलता।', 'इस महीने जिनकी सर्विस की, उन्हें जोड़िए — किसकी सर्विस कब ड्यू है, ऐप बताएगा।'],
      ['फ़्री रिमाइंडर आपका इंतज़ार कर रहे हैं 🔔', `आज 5 कस्टमर जोड़िए — अगला ${tr}काम किसी और के पास नहीं जाएगा।`],
      ['बड़ी कंपनियाँ हर कस्टमर को वापस बुलाती हैं', `अब ${shop} भी। कस्टमर जोड़िए → काम लिखिए → रिमाइंडर सेट।`],
      ['शुरू करने में मदद चाहिए? 🙏', 'पहला कस्टमर 30 सेकंड में जोड़िए। कहीं अटके? हमें WhatsApp कीजिए, साथ में सेट कर देंगे।'],
    ];
    const pick = (lang === 'hi' ? hi : en)[index];
    return pick ? { title: pick[0], body: pick[1], data } : null;
  }

  const data = { screen: 'LogService' };
  const who = cust || (lang === 'hi' ? 'अपने कस्टमर' : 'your customer');
  const en: [string, string][] = [
    [`When is ${who}'s next service?`, `Log the last ${tr}service once — Agla Kaam reminds you on the right day.`],
    ['One step left ✅', `Log one service and your first automatic reminder is set.`],
    [`Be the one ${who} calls next time`, `Log their last service now. We'll tell you before it's due.`],
    ['Reminders only work for logged jobs', `You've added customers — now log their last ${tr}service and let the app do the remembering.`],
    ['Need a hand? 🙏', `Log a service in 30 seconds, or reply on our WhatsApp and we'll do the first one with you.`],
  ];
  const hi: [string, string][] = [
    [`${who} की अगली सर्विस कब है?`, `पिछली ${tr}सर्विस एक बार लिखिए — सही दिन पर ऐप याद दिलाएगा।`],
    ['बस एक स्टेप बाकी ✅', 'एक सर्विस लिखिए — आपका पहला ऑटोमैटिक रिमाइंडर सेट हो जाएगा।'],
    [`अगली बार ${who} आपको ही बुलाएँ`, 'उनकी पिछली सर्विस अभी लिखिए — ड्यू होने से पहले हम बताएँगे।'],
    ['रिमाइंडर सिर्फ़ लिखे गए काम के लिए आते हैं', `कस्टमर जुड़ गए — अब उनकी पिछली ${tr}सर्विस लिखिए, याद रखना ऐप का काम।`],
    ['मदद चाहिए? 🙏', 'एक सर्विस 30 सेकंड में लिखिए, या हमें WhatsApp कीजिए — पहली हम साथ में करेंगे।'],
  ];
  const pick = (lang === 'hi' ? hi : en)[index];
  return pick ? { title: pick[0], body: pick[1], data } : null;
}

/** The two "finish setup" emails (first and third nudge), plain and personal. */
export function setupEmail(index: number): { subject: string; text: string } | null {
  if (index === 0) {
    return {
      subject: 'Your Agla Kaam account is 1 minute from ready',
      text: `Hi,

Thanks for signing in to Agla Kaam! One quick step is left: add your phone number and your trade (AC, RO, appliance, CCTV…). It takes about a minute.

Then you can:
• add your customers and see whose service is due
• send WhatsApp reminders in one tap
• make GST bills and quotations from your phone

Open the app to finish: https://aglakaam.app/download

Need help? WhatsApp us on +91 95629 94337 and we'll set it up with you.

— Britto, Agla Kaam`,
    };
  }
  if (index === 2) {
    return {
      subject: 'Still want reminders for your customers?',
      text: `Hi,

Your Agla Kaam account is still waiting for your phone number and trade — the last step before you can add customers.

Customers you serviced this month will need you again. Agla Kaam tells you exactly when, so they call you and not someone else.

Finish setup (1 minute): https://aglakaam.app/download

Or just reply on WhatsApp: +91 95629 94337 — we'll do it with you.

— Britto, Agla Kaam`,
    };
  }
  return null;
}
