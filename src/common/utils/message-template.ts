export const REMINDER_TEMPLATE_VARIABLES = [
  'customerName',
  'businessName',
  'serviceType',
  'nextServiceDate',
] as const;

export const DEFAULT_REMINDER_TEMPLATE =
  'Hi {customerName}, this is a reminder from {businessName} that your {serviceType} is due. Would you like to schedule a visit?';

// The service card share — a record of the work done, where the reminder
// above is a nudge about work that is due. It used to be assembled on the
// device in ServiceCardScreen, which meant it ignored the business's own
// template, could not change without an app release, and drifted from the
// reminder it sits next to.
//
// {completedLine} carries its own trailing newline so the line disappears
// entirely on a service that is not completed yet.
// Chasing money, not work. The service reminders above nudge about a job
// that is due; this one asks for payment on an invoice that is outstanding,
// which the app previously had no way to send at all.
export const DEFAULT_PAYMENT_REMINDER_TEMPLATE =
  'Hi {customerName}, a gentle reminder that invoice {invoiceNumber} for {balanceDue} was due on {dueDate}. Please let us know once paid. Thank you — {businessName}';

export const DEFAULT_CARD_TEMPLATE = [
  "Hi {customerName}, here's your service record from {businessName}:",
  '',
  'Service: {serviceType}',
  'Status: {status}',
  'Date: {serviceDate}',
  '{completedLine}{warranty}',
  'Next service due: {nextServiceDate}',
  '',
  '{businessContact}{reviewLine}',
].join('\n');

// Unknown {placeholders} are left as-is rather than blanked out, so a typo in
// a custom template degrades gracefully instead of silently dropping text.
export function renderMessageTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
