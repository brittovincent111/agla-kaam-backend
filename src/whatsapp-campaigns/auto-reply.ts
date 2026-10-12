/**
 * Spots the automatic greeting a business's own WhatsApp Business sends back
 * ("Thank you for contacting XYZ… we will get back to you"). Those are not a
 * person answering: counting them made the reply rate look high, and the
 * assistant read their "How can we help you?" as a request for a demo and
 * marked the business interested.
 */
const PHRASES = [
  // English
  'thank you for contacting',
  'thanks for contacting',
  'thank you for reaching',
  'thanks for reaching',
  'thank you for your message',
  'thanks for your message',
  'thank you for messaging',
  'thanks for messaging',
  'we have received your message',
  'we will get back',
  "we'll get back",
  'will get back to you',
  'get back to you shortly',
  'respond shortly',
  'reply shortly',
  'revert shortly',
  'our team will',
  'our executive will',
  'currently unavailable',
  'currently closed',
  'not available right now',
  'out of office',
  'business hours',
  'working hours',
  'office hours',
  'we are closed',
  'welcome to',
  'how can we help',
  'how may we help',
  'how can i help you',
  'how may i help you',
  'how can we assist',
  'how may we assist',
  'how can i assist',
  'greetings from',
  'for any queries',
  'for any enquiries',
  'for enquiries',
  'visit our website',
  'our catalog',
  'our catalogue',
  'this is an automated',
  'automated message',
  'auto-reply',
  'auto reply',
  'leave your message',
  'leave a message',
  'please share your requirement',
  // Hindi
  'संपर्क करने के लिए धन्यवाद',
  'हम जल्द ही आपसे',
  'जल्द ही संपर्क करेंगे',
  // Malayalam
  'ബന്ധപ്പെട്ടതിന് നന്ദി',
  'ഉടൻ ബന്ധപ്പെടും',
];

// Nobody reads a message and types this much back this fast.
const FAST_SECONDS = 20;
const LONG_CHARS = 60;

export function looksLikeAutoReply(
  text: string,
  secondsAfterOurMessage?: number | null,
): boolean {
  const said = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!said) return false;
  if (PHRASES.some((p) => said.includes(p))) return true;
  return (
    secondsAfterOurMessage != null &&
    secondsAfterOurMessage >= 0 &&
    secondsAfterOurMessage < FAST_SECONDS &&
    said.length > LONG_CHARS
  );
}
