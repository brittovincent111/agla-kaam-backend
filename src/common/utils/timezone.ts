// The reminder cron has to fire at 8 AM in each business's *own* morning.
//
// Business.timezone has existed on the schema since the app went
// multi-country, but nothing ever read it: the daily sweep ran on one
// server-local schedule, so a Dubai business was pinged at 6:30 AM and a US
// one in the middle of the night. The fix is to run the job every hour and
// let each business through only when it is their send hour.

// The hour (0-23) it currently is in `timezone`. Falls back to the server's
// own hour for an unrecognised zone rather than throwing — a bad timezone
// string should degrade to "roughly right", never drop the reminder.
export function localHourIn(timezone: string | undefined, at: Date): number {
  if (!timezone) return at.getHours();
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(at);
    // Intl returns "24" rather than "0" for midnight in some environments.
    const parsed = Number(hour) % 24;
    return Number.isFinite(parsed) ? parsed : at.getHours();
  } catch {
    return at.getHours();
  }
}

// Whether `timezone` has just reached `sendHour`. Called once an hour, so
// each business matches exactly once per day.
export function isSendHourIn(
  timezone: string | undefined,
  at: Date,
  sendHour: number,
): boolean {
  return localHourIn(timezone, at) === sendHour;
}

// Start of the local day in `timezone`, expressed as the UTC instant that
// midnight corresponds to. The reminder queries compare against
// Service.nextServiceDate, which is stored as a date at UTC midnight, so
// "today" has to be resolved in the business's own calendar — otherwise a
// business in Dubai sees tomorrow's jobs as due, and a US one misses today's.
export function startOfLocalDay(timezone: string | undefined, at: Date): Date {
  if (!timezone) {
    const local = new Date(at);
    local.setHours(0, 0, 0, 0);
    return local;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    if (![year, month, day].every(Number.isFinite)) {
      throw new Error('unparsable');
    }
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  } catch {
    const local = new Date(at);
    local.setHours(0, 0, 0, 0);
    return local;
  }
}
