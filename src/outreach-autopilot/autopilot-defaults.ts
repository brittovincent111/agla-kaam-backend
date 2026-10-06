/**
 * Starting regions and per-language messages for the outreach autopilot.
 * Everything here is copied into the database on first use and edited from
 * the admin page afterwards; changing this file does not touch saved copies.
 */

export const AUTOPILOT_LANGUAGES = ['en', 'hi', 'ml', 'ta', 'kn', 'te', 'mr'] as const;
export type AutopilotLanguage = (typeof AUTOPILOT_LANGUAGES)[number];

import { AUTOPILOT_TRADES } from '../lead-finder/trades';
import { TRADE_BODIES } from './trade-copy';

// The trades likeliest to install (lead-finder/trades.ts AUTOPILOT_TRADES).
export const DEFAULT_CATEGORIES = [...AUTOPILOT_TRADES];

export interface RegionSeed {
  name: string;
  language: AutopilotLanguage;
  // Share of the daily limits against the other regions (default 1).
  weight?: number;
  places: { state: string; city: string; localities: string[] }[];
}

export const DEFAULT_REGIONS: RegionSeed[] = [
  {
    name: 'Kerala',
    language: 'ml',
    // Main focus for now: about 70% of every daily limit (7 against 1 each).
    weight: 7,
    places: [
      { state: 'Kerala', city: 'Kochi', localities: ['Kakkanad', 'Edappally', 'Vyttila', 'Kaloor', 'Aluva', 'Palarivattom', 'Kalamassery', 'Thrippunithura', 'Kadavanthra', 'Maradu', 'Angamaly', 'Perumbavoor', 'Fort Kochi', 'Panampilly Nagar'] },
      { state: 'Kerala', city: 'Thiruvananthapuram', localities: ['Kazhakoottam', 'Pattom', 'Vazhuthacaud', 'Kowdiar', 'Sreekaryam', 'Peroorkada', 'Kesavadasapuram', 'Neyyattinkara', 'Attingal'] },
      { state: 'Kerala', city: 'Kozhikode', localities: ['Nadakkavu', 'Mavoor Road', 'Feroke', 'Kunnamangalam', 'Ramanattukara', 'Vadakara', 'Koyilandy'] },
      { state: 'Kerala', city: 'Thrissur', localities: ['Punkunnam', 'Ayyanthole', 'Ollur', 'Chalakudy', 'Irinjalakuda', 'Kunnamkulam', 'Guruvayur'] },
      { state: 'Kerala', city: 'Kollam', localities: ['Chinnakada', 'Kottiyam', 'Karunagappally', 'Kundara'] },
      { state: 'Kerala', city: 'Kottayam', localities: ['Nagampadam', 'Ettumanoor', 'Changanassery', 'Pala'] },
      { state: 'Kerala', city: 'Alappuzha', localities: ['Mullakkal', 'Cherthala', 'Kayamkulam'] },
      { state: 'Kerala', city: 'Palakkad', localities: ['Olavakkode', 'Chandranagar', 'Ottapalam'] },
      { state: 'Kerala', city: 'Malappuram', localities: ['Manjeri', 'Perinthalmanna', 'Tirur', 'Kottakkal'] },
      { state: 'Kerala', city: 'Kannur', localities: ['Thavakkara', 'Thalassery', 'Payyannur', 'Taliparamba'] },
      { state: 'Kerala', city: 'Pathanamthitta', localities: ['Thiruvalla', 'Adoor'] },
      { state: 'Kerala', city: 'Kasaragod', localities: ['Kanhangad'] },
      { state: 'Kerala', city: 'Thodupuzha', localities: [] },
      { state: 'Kerala', city: 'Kalpetta', localities: [] },
    ],
  },
  {
    name: 'Tamil Nadu',
    language: 'ta',
    places: [
      { state: 'Tamil Nadu', city: 'Chennai', localities: ['Anna Nagar', 'T Nagar', 'Velachery', 'Tambaram', 'Porur', 'Adyar'] },
      { state: 'Tamil Nadu', city: 'Coimbatore', localities: ['Gandhipuram', 'RS Puram', 'Peelamedu', 'Saravanampatti'] },
      { state: 'Tamil Nadu', city: 'Madurai', localities: ['KK Nagar', 'Tallakulam', 'Thirunagar'] },
    ],
  },
  {
    name: 'Karnataka',
    language: 'kn',
    places: [
      { state: 'Karnataka', city: 'Bengaluru', localities: ['Whitefield', 'Koramangala', 'Jayanagar', 'Indiranagar', 'Electronic City', 'Yelahanka', 'Rajajinagar'] },
      { state: 'Karnataka', city: 'Mysuru', localities: ['Vijayanagar', 'Kuvempunagar', 'Saraswathipuram'] },
    ],
  },
  {
    name: 'Hindi belt',
    language: 'hi',
    places: [
      { state: 'Delhi', city: 'Delhi', localities: ['Rohini', 'Dwarka', 'Laxmi Nagar', 'Saket'] },
      { state: 'Uttar Pradesh', city: 'Noida', localities: ['Sector 62', 'Sector 18'] },
      { state: 'Haryana', city: 'Gurugram', localities: ['Sohna Road', 'DLF Phase 3'] },
      { state: 'Rajasthan', city: 'Jaipur', localities: ['Malviya Nagar', 'Vaishali Nagar', 'Mansarovar'] },
      { state: 'Uttar Pradesh', city: 'Lucknow', localities: ['Gomti Nagar', 'Aliganj', 'Indira Nagar'] },
    ],
  },
];

export interface LanguageMessages {
  emailSubject: string;
  emailBody: string;
  emailFollowUp: string;
  followUpDays: number;
  // Approved WhatsApp template for this language. Until Meta approves one,
  // the region falls back to the English template.
  whatsappTemplate: string;
  whatsappLanguage: string;
  headerImageUrl: string;
}

const HEADER_EN = 'https://aglakaam.app/whatsapp/aglakaam-header.jpg';
const HEADER_HI = 'https://aglakaam.app/whatsapp/aglakaam-header-hi.jpg';

export const DEFAULT_MESSAGES: Record<string, LanguageMessages> = {
  en: {
    emailSubject: 'Quick question about your repeat service customers',
    emailBody: `Hi Team,

I noticed your team handles repair and maintenance services.

Quick question: how do you currently track when a client is due for repeat service after 3 or 6 months?

Many service businesses we speak with lose repeat jobs simply because clients forget to call back.

We built Agla Kaam to automate this. It sends a polite WhatsApp reminder to your customer right before their service date so they rebook with you.

Along with reminders, you can generate GST invoices and view customer history from your phone. It's free to start: https://aglakaam.app/download

Would this be helpful for your team?

Rajeev
Agla Kaam
support@aglakaam.app

If you'd rather not get these emails, unsubscribe here: {{unsubscribeUrl}}`,
    emailFollowUp: `Hi Team,

Just following up on my note from last week.

If keeping track of repeat service dates is something your team handles by memory or a notebook today, Agla Kaam can send each customer a WhatsApp reminder before their next service, so they rebook with you.

Would a quick look be useful? A one-word reply is enough.

Rajeev
Agla Kaam

Unsubscribe: {{unsubscribeUrl}}`,
    followUpDays: 4,
    whatsappTemplate: 'aglakaam_first_hello',
    whatsappLanguage: 'en',
    headerImageUrl: HEADER_EN,
  },
  hi: {
    emailSubject: 'ग्राहकों की अगली सर्विस याद रखने का आसान तरीका',
    emailBody: `नमस्ते,

मैं राजीव, Agla Kaam से। आपकी टीम रिपेयर और मेंटेनेंस का काम करती है, इसलिए एक छोटा-सा सवाल:

3 या 6 महीने बाद किस ग्राहक की सर्विस ड्यू है, यह आप अभी कैसे याद रखते हैं?

कई ग्राहक तारीख भूल जाते हैं और किसी और को बुला लेते हैं। Agla Kaam सर्विस की तारीख से पहले आपके ग्राहक को WhatsApp पर याद दिलाता है, ताकि वह दोबारा आपको ही बुलाए। साथ में GST बिल और ग्राहक की पूरी हिस्ट्री भी फ़ोन पर।

शुरुआत मुफ़्त है: https://aglakaam.app/download

क्या यह आपकी टीम के काम आएगा? बस इस ईमेल का जवाब दें।

राजीव
Agla Kaam
support@aglakaam.app

ये ईमेल नहीं चाहिए? यहाँ से बंद करें: {{unsubscribeUrl}}`,
    emailFollowUp: `नमस्ते,

पिछले हफ़्ते के मेरे ईमेल की बस एक बार याद दिला रहा हूँ। अगर ग्राहकों की अगली सर्विस की तारीख अभी डायरी या याददाश्त से चलती है, तो Agla Kaam यह अपने-आप कर देता है।

एक बार देखना चाहें तो सिर्फ़ "हाँ" लिखकर जवाब दें।

राजीव
Agla Kaam

बंद करें: {{unsubscribeUrl}}`,
    followUpDays: 4,
    whatsappTemplate: 'aglakaam_first_hello',
    whatsappLanguage: 'hi',
    headerImageUrl: HEADER_HI,
  },
  ml: {
    emailSubject: 'കസ്റ്റമേഴ്സിന്റെ അടുത്ത സർവീസ് ഓർമ്മിപ്പിക്കാൻ ഒരു എളുപ്പ വഴി',
    emailBody: `നമസ്കാരം,

ഞാൻ രാജീവ്, Agla Kaam-ൽ നിന്ന്. നിങ്ങൾ റിപ്പയർ, മെയിന്റനൻസ് ജോലികൾ ചെയ്യുന്നവരാണല്ലോ, അതുകൊണ്ട് ഒരു ചെറിയ ചോദ്യം:

3 അല്ലെങ്കിൽ 6 മാസം കഴിഞ്ഞ് ഏത് കസ്റ്റമറുടെ സർവീസ് ആണ് വരാനുള്ളതെന്ന് ഇപ്പോൾ എങ്ങനെയാണ് ഓർത്തുവയ്ക്കുന്നത്?

പല കസ്റ്റമേഴ്സും തീയതി മറന്നുപോകും, പിന്നെ വേറെ ആരെയെങ്കിലും വിളിക്കും. Agla Kaam സർവീസ് തീയതിക്ക് മുൻപ് നിങ്ങളുടെ കസ്റ്റമർക്ക് WhatsApp-ൽ ഓർമ്മപ്പെടുത്തൽ അയയ്ക്കും, അവർ വീണ്ടും നിങ്ങളെത്തന്നെ വിളിക്കാൻ. GST ബില്ലും കസ്റ്റമർ ഹിസ്റ്ററിയും ഫോണിൽ തന്നെ.

തുടങ്ങാൻ സൗജന്യമാണ്: https://aglakaam.app/download

ഇത് നിങ്ങളുടെ ടീമിന് ഉപകാരപ്പെടുമോ? ഈ ഇമെയിലിന് മറുപടി അയച്ചാൽ മതി.

രാജീവ്
Agla Kaam
support@aglakaam.app

ഈ ഇമെയിലുകൾ വേണ്ടെങ്കിൽ: {{unsubscribeUrl}}`,
    emailFollowUp: `നമസ്കാരം,

കഴിഞ്ഞ ആഴ്ചത്തെ എന്റെ ഇമെയിലിനെക്കുറിച്ച് ഒന്ന് ഓർമ്മിപ്പിക്കുന്നു. കസ്റ്റമേഴ്സിന്റെ അടുത്ത സർവീസ് തീയതി ഇപ്പോൾ ഡയറിയിലോ ഓർമ്മയിലോ ആണെങ്കിൽ, Agla Kaam അത് തനിയെ ചെയ്യും.

ഒന്ന് നോക്കണമെങ്കിൽ "ശരി" എന്ന് മറുപടി അയച്ചാൽ മതി.

രാജീവ്
Agla Kaam

വേണ്ടെങ്കിൽ: {{unsubscribeUrl}}`,
    followUpDays: 4,
    whatsappTemplate: 'aglakaam_first_hello',
    whatsappLanguage: 'ml',
    headerImageUrl: HEADER_EN,
  },
  ta: {
    emailSubject: 'வாடிக்கையாளர்களின் அடுத்த சர்வீஸை நினைவில் வைக்க ஒரு எளிய வழி',
    emailBody: `வணக்கம்,

நான் ராஜீவ், Agla Kaam-இலிருந்து. நீங்கள் ரிப்பேர் மற்றும் மெயின்டனன்ஸ் வேலைகள் செய்கிறீர்கள் என்பதால் ஒரு சிறிய கேள்வி:

3 அல்லது 6 மாதங்களுக்குப் பிறகு எந்த வாடிக்கையாளருக்கு சர்வீஸ் வர வேண்டும் என்பதை இப்போது எப்படி நினைவில் வைக்கிறீர்கள்?

பல வாடிக்கையாளர்கள் தேதியை மறந்து வேறு ஒருவரை அழைத்துவிடுகிறார்கள். Agla Kaam சர்வீஸ் தேதிக்கு முன் உங்கள் வாடிக்கையாளருக்கு WhatsApp-இல் நினைவூட்டல் அனுப்பும், அதனால் அவர்கள் மீண்டும் உங்களையே அழைப்பார்கள். GST பில் மற்றும் வாடிக்கையாளர் வரலாறும் போனிலேயே.

தொடங்குவது இலவசம்: https://aglakaam.app/download

இது உங்கள் குழுவுக்கு உதவுமா? இந்த மின்னஞ்சலுக்கு பதில் அனுப்பினால் போதும்.

ராஜீவ்
Agla Kaam
support@aglakaam.app

இந்த மின்னஞ்சல்கள் வேண்டாமெனில்: {{unsubscribeUrl}}`,
    emailFollowUp: `வணக்கம்,

கடந்த வாரம் அனுப்பிய என் மின்னஞ்சலை ஒருமுறை நினைவூட்டுகிறேன். வாடிக்கையாளர்களின் அடுத்த சர்வீஸ் தேதியை இப்போது டைரியிலோ நினைவிலோ வைத்திருந்தால், Agla Kaam அதை தானாகவே செய்யும்.

ஒருமுறை பார்க்க விரும்பினால் "சரி" என்று பதில் அனுப்புங்கள்.

ராஜீவ்
Agla Kaam

வேண்டாமெனில்: {{unsubscribeUrl}}`,
    followUpDays: 4,
    whatsappTemplate: 'aglakaam_first_hello',
    whatsappLanguage: 'ta',
    headerImageUrl: HEADER_EN,
  },
  kn: {
    emailSubject: 'ಗ್ರಾಹಕರ ಮುಂದಿನ ಸರ್ವೀಸ್ ನೆನಪಿಡಲು ಸುಲಭ ದಾರಿ',
    emailBody: `ನಮಸ್ಕಾರ,

ನಾನು ರಾಜೀವ್, Agla Kaam-ನಿಂದ. ನೀವು ರಿಪೇರಿ ಮತ್ತು ಮೇಂಟೆನೆನ್ಸ್ ಕೆಲಸ ಮಾಡುತ್ತೀರಿ, ಹಾಗಾಗಿ ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ:

3 ಅಥವಾ 6 ತಿಂಗಳ ನಂತರ ಯಾವ ಗ್ರಾಹಕರ ಸರ್ವೀಸ್ ಬರಬೇಕು ಎಂಬುದನ್ನು ಈಗ ಹೇಗೆ ನೆನಪಿಡುತ್ತೀರಿ?

ಅನೇಕ ಗ್ರಾಹಕರು ದಿನಾಂಕ ಮರೆತು ಬೇರೆಯವರನ್ನು ಕರೆಯುತ್ತಾರೆ. Agla Kaam ಸರ್ವೀಸ್ ದಿನಾಂಕಕ್ಕೂ ಮುನ್ನ ನಿಮ್ಮ ಗ್ರಾಹಕರಿಗೆ WhatsApp-ನಲ್ಲಿ ನೆನಪಿನ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತದೆ, ಆದ್ದರಿಂದ ಅವರು ಮತ್ತೆ ನಿಮ್ಮನ್ನೇ ಕರೆಯುತ್ತಾರೆ. GST ಬಿಲ್ ಮತ್ತು ಗ್ರಾಹಕರ ಇತಿಹಾಸ ಕೂಡ ಫೋನ್‌ನಲ್ಲೇ.

ಆರಂಭಿಸಲು ಉಚಿತ: https://aglakaam.app/download

ಇದು ನಿಮ್ಮ ತಂಡಕ್ಕೆ ಉಪಯೋಗವಾಗಬಹುದೇ? ಈ ಇಮೇಲ್‌ಗೆ ಉತ್ತರಿಸಿದರೆ ಸಾಕು.

ರಾಜೀವ್
Agla Kaam
support@aglakaam.app

ಈ ಇಮೇಲ್‌ಗಳು ಬೇಡವಾದರೆ: {{unsubscribeUrl}}`,
    emailFollowUp: `ನಮಸ್ಕಾರ,

ಕಳೆದ ವಾರದ ನನ್ನ ಇಮೇಲ್ ಬಗ್ಗೆ ಒಮ್ಮೆ ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ. ಗ್ರಾಹಕರ ಮುಂದಿನ ಸರ್ವೀಸ್ ದಿನಾಂಕವನ್ನು ಈಗ ಡೈರಿಯಲ್ಲೋ ನೆನಪಿನಲ್ಲೋ ಇಟ್ಟುಕೊಂಡಿದ್ದರೆ, Agla Kaam ಅದನ್ನು ತಾನಾಗಿಯೇ ಮಾಡುತ್ತದೆ.

ಒಮ್ಮೆ ನೋಡಲು ಬಯಸಿದರೆ "ಸರಿ" ಎಂದು ಉತ್ತರಿಸಿ.

ರಾಜೀವ್
Agla Kaam

ಬೇಡವಾದರೆ: {{unsubscribeUrl}}`,
    followUpDays: 4,
    whatsappTemplate: 'aglakaam_first_hello',
    whatsappLanguage: 'kn',
    headerImageUrl: HEADER_EN,
  },
};

// Per-trade bodies: the opening line is filled in for each kind of work (trade-copy.ts).
for (const [lang, body] of Object.entries(TRADE_BODIES)) {
  if (DEFAULT_MESSAGES[lang]) DEFAULT_MESSAGES[lang].emailBody = body;
}

/** The HTML part for a plain-text email: same words, links clickable. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\{\{unsubscribeUrl\}\}/g, '<a href="{{unsubscribeUrl}}">{{unsubscribeUrl}}</a>');
  const paras = linked
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">\n${paras}\n</div>`;
}

const IST_OFFSET_MS = 330 * 60_000;

/** "2026-10-05" for the India date of `d`. */
export function istDayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Days left in the India calendar month, today included. */
export function istDaysLeftInMonth(d: Date = new Date()): number {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const last = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).getUTCDate();
  return last - ist.getUTCDate() + 1;
}

/** Midnight at the start of the India day `dayKey`, as a UTC instant. */
export function istDayStart(dayKey: string): Date {
  return new Date(new Date(`${dayKey}T00:00:00Z`).getTime() - IST_OFFSET_MS);
}

/**
 * Splits `total` across shares by weight, whole numbers, largest remainders
 * first, so the parts always add up to the total.
 */
export function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * Math.max(0, w)) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      parts[i]++;
      left--;
    }
  }
  return parts;
}

/**
 * Like splitByWeight, but a region that can't use its whole share (not
 * enough fresh leads) hands the rest to regions that can.
 */
export function allocate(total: number, weights: number[], available: number[]): number[] {
  const out = weights.map(() => 0);
  let open = weights.map((w, i) => i).filter((i) => weights[i] > 0 && available[i] > 0);
  let remaining = total;
  // Regions that can't fill their share take everything they have first;
  // what's left is split evenly (by weight) among the rest.
  for (;;) {
    if (remaining <= 0 || !open.length) return out;
    const sumW = open.reduce((n, i) => n + weights[i], 0);
    const short = open.filter((i) => available[i] <= (remaining * weights[i]) / sumW);
    if (!short.length) break;
    for (const i of short) {
      out[i] = available[i];
      remaining -= available[i];
    }
    open = open.filter((i) => !short.includes(i));
  }
  const shares = splitByWeight(remaining, open.map((i) => weights[i]));
  open.forEach((i, k) => (out[i] = Math.min(available[i], shares[k])));
  return out;
}
