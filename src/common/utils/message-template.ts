// Every WhatsApp message the app prepares is rendered here, on the server,
// from one of these templates — so wording is fixed in one place, can change
// without an app release, and a business's own override always goes through
// the same renderer.
//
// A person always presses send: these fill a preview the user can edit
// before WhatsApp opens. Nothing here is sent to a customer automatically.

export const REMINDER_TEMPLATE_VARIABLES = [
  'customerName',
  'businessName',
  'serviceType',
  'dueDate',
  'nextServiceDate',
] as const;

export type MessageLanguage = 'en' | 'hi';

export function messageLanguage(language?: string): MessageLanguage {
  return language === 'hi' ? 'hi' : 'en';
}

// --- Service due -----------------------------------------------------------
//
// {dueDate} is the date THIS visit is due. {nextServiceDate} is kept as an
// alias of it in a reminder, because custom templates written with the old
// "Next due date" chip meant exactly that — and were printing the visit after
// the due one (usually six months later) instead.

const REMINDER: Record<MessageLanguage, string> = {
  en: 'Hi {customerName}, this is a reminder from {businessName} that your {serviceType} is due on {dueDate}. Shall we book a visit? Just reply with a time that suits you.',
  hi: 'नमस्ते {customerName}, {businessName} की ओर से याद दिला रहे हैं कि आपकी {serviceType} {dueDate} को ड्यू है। क्या हम विज़िट बुक कर दें? अपनी सुविधा का समय बता दीजिए।',
};

// Sent instead of the first reminder when one was already prepared for this
// visit — a gentler nudge rather than the same words twice.
const REMINDER_FOLLOW_UP: Record<MessageLanguage, string> = {
  en: 'Hi {customerName}, just following up on your {serviceType} (due {dueDate}). Would you like us to come this week? Reply with a convenient day and time. — {businessName}',
  hi: 'नमस्ते {customerName}, आपकी {serviceType} ({dueDate} को ड्यू) के बारे में फिर से याद दिला रहे हैं। क्या हम इस हफ़्ते आ जाएँ? सुविधाजनक दिन और समय बता दीजिए। — {businessName}',
};

// A visit the customer already agreed to: confirm it, do not ask again
// whether they want one.
const VISIT_CONFIRM: Record<MessageLanguage, string> = {
  en: 'Hi {customerName}, your {serviceType} visit from {businessName} is booked for {dueDate}{slotText}. See you then — reply here if you need to change it.',
  hi: 'नमस्ते {customerName}, {businessName} की ओर से आपकी {serviceType} विज़िट {dueDate}{slotText} के लिए बुक है। तब मिलते हैं — बदलना हो तो यहीं जवाब दें।',
};

const SLOT_WORDS: Record<MessageLanguage, Record<string, string>> = {
  en: {
    morning: 'in the morning',
    afternoon: 'in the afternoon',
    evening: 'in the evening',
  },
  hi: { morning: 'सुबह', afternoon: 'दोपहर', evening: 'शाम' },
};

// ", in the morning" / " at 11:30" — empty when no time was agreed.
export function slotWording(
  lang: MessageLanguage,
  slot?: string | null,
): string {
  if (!slot) return '';
  const word = SLOT_WORDS[lang][slot];
  if (word) return lang === 'hi' ? ` ${word}` : `, ${word}`;
  return lang === 'hi' ? ` ${slot} बजे` : ` at ${slot}`;
}

// --- Service record --------------------------------------------------------
// {completedLine} carries its own trailing newline so the line disappears
// entirely on a service that is not completed yet.

const CARD: Record<MessageLanguage, string> = {
  en: [
    "Hi {customerName}, here's your service record from {businessName}:",
    '',
    'Service: {serviceType}',
    'Status: {status}',
    'Date: {serviceDate}',
    '{completedLine}{warranty}',
    'Next service due: {nextServiceDate}',
    '',
    '{businessContact}{invoiceLine}{recordLine}{reviewLine}',
  ].join('\n'),
  hi: [
    'नमस्ते {customerName}, {businessName} की ओर से आपकी सर्विस का रिकॉर्ड:',
    '',
    'सर्विस: {serviceType}',
    'स्थिति: {status}',
    'तारीख: {serviceDate}',
    '{completedLine}{warranty}',
    'अगली सर्विस: {nextServiceDate}',
    '',
    '{businessContact}{invoiceLine}{recordLine}{reviewLine}',
  ].join('\n'),
};

// --- Payment ---------------------------------------------------------------
// {dueLine} reads "is due on 1 Oct" before the due date and "was due on 1 Oct"
// after it — the old text said "was due" even when sent a week early.
// {paymentLine} and {invoiceLink} carry their own leading newlines, so they
// vanish when the business has no UPI/bank details or no link is available.

const PAYMENT: Record<MessageLanguage, string> = {
  en: 'Hi {customerName}, a gentle reminder that invoice {invoiceNumber} for {balanceDue} {dueLine}.{paymentLine}{invoiceLink}\n\nPlease let us know once paid. Thank you — {businessName}',
  hi: 'नमस्ते {customerName}, विनम्र याद दिलाना है कि इनवॉइस {invoiceNumber} की राशि {balanceDue} {dueLine}।{paymentLine}{invoiceLink}\n\nभुगतान होने पर कृपया बता दें। धन्यवाद — {businessName}',
};

const DUE_WORDS: Record<MessageLanguage, { future: string; past: string }> = {
  en: { future: 'is due on {date}', past: 'was due on {date}' },
  hi: { future: '{date} को देय है', past: '{date} को देय थी' },
};

// --- Job dispatch (to a technician) ----------------------------------------

const DISPATCH: Record<MessageLanguage, string> = {
  en: [
    '*🚨 Job Dispatch — {businessName}*',
    '',
    'Hi *{technicianName}*, you have a job:',
    '',
    '👤 *Customer:* {customerName}',
    '📞 *Phone:* {customerPhone}',
    '🛠️ *Service:* {serviceType}',
    '📅 *Date:* {dueDate}',
    '{addressLine}{mapLine}{notesLine}',
    'Please call the customer before you go, and mark the job complete in Agla Kaam when done.',
  ].join('\n'),
  hi: [
    '*🚨 नया काम — {businessName}*',
    '',
    'नमस्ते *{technicianName}*, आपके लिए एक काम है:',
    '',
    '👤 *ग्राहक:* {customerName}',
    '📞 *फ़ोन:* {customerPhone}',
    '🛠️ *सर्विस:* {serviceType}',
    '📅 *तारीख:* {dueDate}',
    '{addressLine}{mapLine}{notesLine}',
    'जाने से पहले ग्राहक को कॉल करें, और काम पूरा होने पर Agla Kaam में मार्क करें।',
  ].join('\n'),
};

// Kept for anything that still imports the old constant names.
export const DEFAULT_REMINDER_TEMPLATE = REMINDER.en;
export const DEFAULT_CARD_TEMPLATE = CARD.en;
export const DEFAULT_PAYMENT_REMINDER_TEMPLATE = PAYMENT.en;

export const DEFAULT_TEMPLATES = {
  reminder: REMINDER,
  reminderFollowUp: REMINDER_FOLLOW_UP,
  visitConfirm: VISIT_CONFIRM,
  card: CARD,
  payment: PAYMENT,
  dispatch: DISPATCH,
};

export function dueWording(
  lang: MessageLanguage,
  date: string,
  isPast: boolean,
): string {
  const words = DUE_WORDS[lang];
  return (isPast ? words.past : words.future).replace('{date}', date);
}

// Unknown {placeholders} are left as-is rather than blanked out, so a typo in
// a custom template degrades gracefully instead of silently dropping text.
export function renderMessageTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
