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

// Most businesses are in India; with no timezone on hand, assume theirs —
// never the server's own clock (EC2 runs in UTC).
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

// Start of the local day in `timezone`, as the instant the day's window opens.
//
// A date-only value (a service or reminder date) reaches the database two
// ways: the server saves UTC midnight of the day, while some app screens
// save local midnight (2026-10-07 in India is 2026-10-06T18:30Z). The window
// for "today" has to hold both, or a visit booked for tomorrow shows under
// today and moves to overdue the next morning. So the day opens at the
// earlier of the two: local midnight for zones ahead of UTC (India, the
// Gulf), UTC midnight for zones behind it. Later boundaries are this plus
// whole days.
export function startOfLocalDay(timezone: string | undefined, at: Date): Date {
  const zone = timezone || DEFAULT_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour') % 24;
    const minute = get('minute');
    const second = get('second');
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
      throw new Error('unparsable');
    }
    // How far the zone's clock is ahead of UTC right now, to the minute.
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const offsetMs = Math.round((wallAsUtc - at.getTime()) / 60_000) * 60_000;
    const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    const localMidnight = utcMidnight - offsetMs;
    return new Date(Math.min(utcMidnight, localMidnight));
  } catch {
    // An unknown zone string falls back to the default, not the server clock.
    return zone === DEFAULT_TIMEZONE
      ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
      : startOfLocalDay(DEFAULT_TIMEZONE, at);
  }
}
