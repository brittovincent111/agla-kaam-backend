import { resolveRange, zonedMidnight } from './report-range';

describe('report ranges', () => {
  it('starts "this month" at local midnight in the business time zone', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    const { from, to } = resolveRange('this_month', 'Asia/Kolkata', now);
    // 1 Sept 00:00 IST is 31 Aug 18:30 UTC.
    expect(from!.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(to!.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('uses the business zone, not the server one, near midnight', () => {
    // Already October in India while it is still September in UTC.
    const now = new Date('2026-09-30T19:00:00Z'); // 1 Oct 00:30 IST
    const { from } = resolveRange('this_month', 'Asia/Kolkata', now);
    expect(from!.toISOString()).toBe('2026-09-30T18:30:00.000Z'); // October
  });

  it('handles last month across a year boundary', () => {
    const now = new Date('2026-01-10T06:00:00Z');
    const { from, to } = resolveRange('last_month', 'Asia/Dubai', now);
    expect(from!.toISOString()).toBe('2025-11-30T20:00:00.000Z'); // 1 Dec 00:00 GST
    expect(to!.toISOString()).toBe('2025-12-31T20:00:00.000Z');
  });

  it('gives quarters and years, and nothing for all time', () => {
    const now = new Date('2026-08-15T06:00:00Z');
    expect(
      resolveRange('this_quarter', 'Asia/Kolkata', now).from!.toISOString(),
    ).toBe(zonedMidnight('Asia/Kolkata', 2026, 6).toISOString());
    expect(
      resolveRange('this_year', 'Asia/Kolkata', now).from!.toISOString(),
    ).toBe('2025-12-31T18:30:00.000Z');
    expect(resolveRange('all_time', 'Asia/Kolkata', now)).toEqual({});
  });
});
