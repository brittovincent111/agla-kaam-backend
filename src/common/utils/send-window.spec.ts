import { isWaitingNote, istWhen, sendWindow } from './send-window';

// IST is UTC+5:30, so 10:00 IST = 04:30 UTC.
const at = (iso: string) => new Date(iso);
const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('sendWindow', () => {
  it('is open on a Monday at 11:00 IST with the defaults', () => {
    const w = sendWindow(env({}), at('2026-10-05T05:30:00Z')); // Mon 11:00 IST
    expect(w.open).toBe(true);
    expect(w.label).toBe('10:00–19:00 IST, Mon–Sat');
  });

  it('is closed at 19:00 IST and reopens at 10:00 the next morning', () => {
    const w = sendWindow(env({}), at('2026-10-05T13:30:00Z')); // Mon 19:00 IST
    expect(w.open).toBe(false);
    expect(istWhen(w.nextOpenAt)).toBe('Tue 10:00');
  });

  it('skips Sunday: Saturday evening reopens on Monday', () => {
    const w = sendWindow(env({}), at('2026-10-10T15:00:00Z')); // Sat 20:30 IST
    expect(w.open).toBe(false);
    expect(istWhen(w.nextOpenAt)).toBe('Mon 10:00');
  });

  it('can be switched off', () => {
    const w = sendWindow(env({ OUTREACH_SEND_HOURS: '0-24', OUTREACH_SEND_DAYS: '0-6' }), at('2026-10-11T20:00:00Z'));
    expect(w.open).toBe(true);
    expect(w.label).toBe('any time, every day');
  });

  it('treats an empty hour range like "0-0" as a mistake, not "never send"', () => {
    expect(sendWindow(env({ OUTREACH_SEND_HOURS: '0-0' }), at('2026-10-05T05:30:00Z')).label).toBe('10:00–19:00 IST, Mon–Sat');
  });

  it('falls back to the defaults on a malformed setting', () => {
    expect(sendWindow(env({ OUTREACH_SEND_HOURS: 'evening' }), at('2026-10-05T05:30:00Z')).label).toBe(
      '10:00–19:00 IST, Mon–Sat',
    );
  });
});

describe('isWaitingNote', () => {
  it('recognises the notes the queues set themselves', () => {
    expect(isWaitingNote('Daily limit of 200 emails reached — …')).toBe(true);
    expect(isWaitingNote('Outside sending hours (10:00–19:00 IST, Mon–Sat) — continues Tue 10:00.')).toBe(true);
    expect(isWaitingNote('Paused by admin')).toBe(false);
    expect(isWaitingNote(undefined)).toBe(false);
  });
});
