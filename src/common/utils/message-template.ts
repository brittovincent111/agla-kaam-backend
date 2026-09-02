export const REMINDER_TEMPLATE_VARIABLES = [
  'customerName',
  'businessName',
  'serviceType',
  'nextServiceDate',
] as const;

export const DEFAULT_REMINDER_TEMPLATE =
  'Hi {customerName}, this is a reminder from {businessName} that your {serviceType} is due. Would you like to schedule a visit?';

// Unknown {placeholders} are left as-is rather than blanked out, so a typo in
// a custom template degrades gracefully instead of silently dropping text.
export function renderMessageTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
