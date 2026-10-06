// Date ranges for Reports, resolved in the BUSINESS's time zone. The app
// used to decide "this month" on the phone's clock, so a travelling owner
// (or a phone set to the wrong zone) saw a different month.

export const REPORT_RANGES = [
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'all_time',
] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

// Year / month (0-based) / day it currently is in `timezone`.
function localDate(
  timezone: string | undefined,
  at: Date,
): { y: number; m: number; d: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get('year');
    const m = get('month') - 1;
    const d = get('day');
    if ([y, m, d].every(Number.isFinite)) return { y, m, d };
  } catch {
    // fall through
  }
  return { y: at.getFullYear(), m: at.getMonth(), d: at.getDate() };
}

// The instant local midnight falls on for y/m/d in `timezone`.
export function zonedMidnight(
  timezone: string | undefined,
  y: number,
  m: number,
  d = 1,
): Date {
  const guess = new Date(Date.UTC(y, m, d));
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(guess);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asLocal = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
    );
    // asLocal − guess is the zone's offset at that moment.
    return new Date(guess.getTime() - (asLocal - guess.getTime()));
  } catch {
    return guess;
  }
}

/** [from, to) for the range; both undefined for all time. */
export function resolveRange(
  range: ReportRange,
  timezone: string | undefined,
  now = new Date(),
): { from?: Date; to?: Date } {
  const { y, m } = localDate(timezone, now);
  switch (range) {
    case 'this_month':
      return {
        from: zonedMidnight(timezone, y, m),
        to: zonedMidnight(timezone, y, m + 1),
      };
    case 'last_month':
      return {
        from: zonedMidnight(timezone, y, m - 1),
        to: zonedMidnight(timezone, y, m),
      };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return {
        from: zonedMidnight(timezone, y, q),
        to: zonedMidnight(timezone, y, q + 3),
      };
    }
    case 'this_year':
      return {
        from: zonedMidnight(timezone, y, 0),
        to: zonedMidnight(timezone, y + 1, 0),
      };
    default:
      return {};
  }
}
