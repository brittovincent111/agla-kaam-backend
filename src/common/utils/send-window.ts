/**
 * When outreach may go out: a message that lands at 11pm is ignored or
 * reported, so campaigns only send inside business hours, India time.
 *
 *   OUTREACH_SEND_HOURS  "10-19"  start hour inclusive, end hour exclusive (IST)
 *   OUTREACH_SEND_DAYS   "1-6"    weekdays allowed, 0 = Sunday … 6 = Saturday
 *
 * "0-24" and "0-6" switch the window off. Test sends ignore it.
 */

const IST_OFFSET_MS = 330 * 60_000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface SendWindow {
  open: boolean;
  // e.g. "10:00–19:00 IST, Mon–Sat"
  label: string;
  // When sending can next start; now if open.
  nextOpenAt: Date;
}

function range(raw: string | undefined, fallback: [number, number], max: number): [number, number] {
  const m = (raw ?? '').trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return fallback;
  const a = Math.min(max, Number(m[1]));
  const b = Math.min(max, Number(m[2]));
  // Hours are [start, end) so need start < end; days are inclusive, "1-1" is Monday only.
  const valid = max === 24 ? a < b : a <= b;
  return valid ? [a, b] : fallback;
}

export function sendWindow(
  get: (key: string) => string | undefined,
  now: Date = new Date(),
): SendWindow {
  const [startH, endH] = range(get('OUTREACH_SEND_HOURS'), [10, 19], 24);
  const [firstDay, lastDay] = range(get('OUTREACH_SEND_DAYS'), [1, 6], 6);

  const allowed = (t: number) => {
    const ist = new Date(t + IST_OFFSET_MS);
    const day = ist.getUTCDay();
    const hour = ist.getUTCHours();
    return day >= firstDay && day <= lastDay && hour >= startH && hour < endH;
  };

  const hours = startH === 0 && endH === 24 ? 'any time' : `${String(startH).padStart(2, '0')}:00–${String(endH).padStart(2, '0')}:00 IST`;
  const days = firstDay === 0 && lastDay === 6 ? 'every day' : `${DAY_NAMES[firstDay]}–${DAY_NAMES[lastDay]}`;
  const label = `${hours}, ${days}`;

  if (allowed(now.getTime())) return { open: true, label, nextOpenAt: now };

  // Next whole hour, India time, that is inside the window (at most a week away).
  const hour = 3600_000;
  let t = Math.ceil((now.getTime() + IST_OFFSET_MS) / hour) * hour - IST_OFFSET_MS;
  for (let i = 0; i < 24 * 8 && !allowed(t); i++) t += hour;
  return { open: false, label, nextOpenAt: new Date(t) };
}

/** "Mon 10:00" in India time, for status notes. */
export function istWhen(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${DAY_NAMES[ist.getUTCDay()]} ${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

/** Notes the queues set themselves, cleared once sending resumes. */
export function isWaitingNote(note?: string | null): boolean {
  return !!note && (note.startsWith('Daily limit') || note.startsWith('Outside sending hours') || note.startsWith('Monthly budget'));
}
