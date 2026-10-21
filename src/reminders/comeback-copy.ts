/**
 * The pushes that bring back an owner who set Agla Kaam up — a customer and
 * a service in — and then stopped opening it. Most of their customers are
 * not due for months, so the 8 AM due-service push stays silent and the app
 * is forgotten (2026-10-21: of ten owners who used it properly, one came
 * back on their own). Each push gives one useful thing to do, using their
 * own numbers, and opens the screen for it.
 */

import { Nudge } from './onboarding-copy';

type Lang = 'en' | 'hi' | 'ml';

export interface ComebackInput {
  businessName: string;
  tradeType?: string | null;
  language?: string | null;
  // Customers in the app, and booked visits in the next 30 days.
  customers: number;
  dueSoon: number;
}

/** Days without using the app before each push; four, then silence. */
export const COMEBACK_AFTER_DAYS = [3, 7, 14, 30];

const TRADE: [RegExp, Record<Lang, string>][] = [
  [/^ac\b/i, { en: 'AC', hi: 'AC', ml: 'AC' }],
  [/\bro\b|purifier/i, { en: 'RO', hi: 'RO', ml: 'RO' }],
  [/appliance/i, { en: 'appliance', hi: 'अप्लायंस', ml: 'അപ്ലയൻസ്' }],
  [/garage|vehicle/i, { en: 'vehicle', hi: 'गाड़ी', ml: 'വണ്ടി' }],
  [/cctv/i, { en: 'CCTV', hi: 'CCTV', ml: 'CCTV' }],
  [/inverter|battery|solar/i, { en: 'inverter', hi: 'इन्वर्टर', ml: 'ഇൻവെർട്ടർ' }],
  [/pest/i, { en: 'pest control', hi: 'पेस्ट कंट्रोल', ml: 'പെസ്റ്റ് കൺട്രോൾ' }],
];

function trade(t: string | null | undefined, lang: Lang): string {
  const hit = TRADE.find(([re]) => re.test(t || ''));
  return hit ? `${hit[1][lang]} ` : '';
}

const short = (s: string | null | undefined, n = 28) => {
  const v = (s || '').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

export function comebackNudge(index: number, input: ComebackInput): Nudge | null {
  const lang: Lang = input.language === 'hi' ? 'hi' : input.language === 'ml' ? 'ml' : 'en';
  const shop = short(input.businessName) || { en: 'your shop', hi: 'आपकी दुकान', ml: 'നിങ്ങളുടെ ഷോപ്പ്' }[lang];
  const tr = trade(input.tradeType, lang);
  const c = input.customers;
  const d = input.dueSoon;

  switch (index) {
    case 0:
      // Someone due soon is the best reason to open the app; otherwise grow the list.
      if (d > 0) {
        return {
          title: {
            en: `${d} customer${d === 1 ? '' : 's'} due in the next 30 days`,
            hi: `अगले 30 दिनों में ${d} कस्टमर की सर्विस ड्यू`,
            ml: `അടുത്ത 30 ദിവസത്തിൽ ${d} കസ്റ്റമറുടെ സർവീസ്`,
          }[lang],
          body: {
            en: 'Open Agla Kaam to see who — call them before someone else does.',
            hi: 'कौन-कौन, ऐप में देखिए — किसी और से पहले आप कॉल कीजिए।',
            ml: 'ആരൊക്കെ എന്ന് ആപ്പിൽ നോക്കൂ — മറ്റാരെങ്കിലും വിളിക്കും മുൻപ് നിങ്ങൾ വിളിക്കൂ.',
          }[lang],
          data: { screen: 'Services' },
        };
      }
      return {
        title: { en: 'Add the rest of your customers', hi: 'बाकी कस्टमर भी जोड़िए', ml: 'ബാക്കി കസ്റ്റമേഴ്സിനെയും ചേർക്കൂ' }[lang],
        body: {
          en: `${shop} has ${c} customer${c === 1 ? '' : 's'} in Agla Kaam. Add the others you served this year — each gets reminded on the right day.`,
          hi: `${shop} के ${c} कस्टमर Agla Kaam में हैं। इस साल जिनका काम किया, उन्हें भी जोड़िए — हर एक को सही दिन रिमाइंडर।`,
          ml: `${shop}-ന് Agla Kaam-ൽ ${c} കസ്റ്റമർ ഉണ്ട്. ഈ വർഷം സർവീസ് ചെയ്ത മറ്റുള്ളവരെയും ചേർക്കൂ — ഓരോരുത്തർക്കും ശരിയായ ദിവസം റിമൈൻഡർ.`,
        }[lang],
        data: { screen: 'AddCustomer' },
      };
    case 1:
      return {
        title: { en: 'Send your next bill on WhatsApp 🧾', hi: 'अगला बिल WhatsApp पर भेजिए 🧾', ml: 'അടുത്ത ബിൽ WhatsApp-ൽ അയയ്ക്കൂ 🧾' }[lang],
        body: {
          en: 'Make a proper bill in seconds and send it on WhatsApp — your customer keeps it, you keep the record.',
          hi: 'सेकंडों में पक्का बिल बनाइए और WhatsApp पर भेजिए — कस्टमर के पास बिल, आपके पास रिकॉर्ड।',
          ml: 'സെക്കൻഡുകൾക്കുള്ളിൽ ബിൽ ഉണ്ടാക്കി WhatsApp-ൽ അയയ്ക്കൂ — കസ്റ്റമർക്ക് ബിൽ, നിങ്ങൾക്ക് റെക്കോർഡ്.',
        }[lang],
        data: { screen: 'InvoiceList' },
      };
    case 2:
      return {
        title: { en: 'Log this week’s jobs ✅', hi: 'इस हफ़्ते के काम लिखिए ✅', ml: 'ഈ ആഴ്ചത്തെ ജോലികൾ ചേർക്കൂ ✅' }[lang],
        body: {
          en: `Each job you log sets that customer's next ${tr}service reminder — 10 seconds each.`,
          hi: `हर लिखा गया काम उस कस्टमर की अगली ${tr}सर्विस का रिमाइंडर सेट करता है — 10 सेकंड में।`,
          ml: `ചേർക്കുന്ന ഓരോ ജോലിയും ആ കസ്റ്റമറുടെ അടുത്ത ${tr}സർവീസ് റിമൈൻഡർ സെറ്റ് ചെയ്യും — 10 സെക്കൻഡ് മതി.`,
        }[lang],
        data: { screen: 'LogService' },
      };
    case 3:
      return {
        title: {
          en: `${c} customer${c === 1 ? '' : 's'} counting on ${shop}`,
          hi: `${c} कस्टमर ${shop} पर भरोसा करते हैं`,
          ml: `${c} കസ്റ്റമേഴ്സ് ${shop}-നെ ആശ്രയിക്കുന്നു`,
        }[lang],
        body: {
          en: `Keep adding jobs so no repeat ${tr}work goes to someone else. Agla Kaam remembers when each one is due.`,
          hi: `काम लिखते रहिए ताकि अगला ${tr}काम किसी और के पास न जाए। किसकी सर्विस कब ड्यू है, Agla Kaam याद रखता है।`,
          ml: `ജോലികൾ ചേർത്തുകൊണ്ടിരിക്കൂ, അടുത്ത ${tr}ജോലി മറ്റാർക്കും പോകില്ല. ഓരോരുത്തരുടെയും സർവീസ് തീയതി Agla Kaam ഓർക്കും.`,
        }[lang],
        data: { screen: 'Home' },
      };
    default:
      return null;
  }
}
