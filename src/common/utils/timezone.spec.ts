import { isSendHourIn, localHourIn, startOfLocalDay } from './timezone';

describe('localHourIn', () => {
  // 2026-09-08T04:30:00Z — 10:00 IST, 08:30 GST, 00:30 EDT.
  const at = new Date('2026-09-08T04:30:00Z');

  it('reads the hour in each supported market', () => {
    expect(localHourIn('Asia/Kolkata', at)).toBe(10);
    expect(localHourIn('Asia/Dubai', at)).toBe(8);
    expect(localHourIn('America/New_York', at)).toBe(0);
    expect(localHourIn('UTC', at)).toBe(4);
  });

  it('reports midnight as 0, not 24', () => {
    // 18:30Z is 00:00 the next day in Asia/Dubai+... use an exact midnight.
    const midnightIST = new Date('2026-09-08T18:30:00Z');
    expect(localHourIn('Asia/Kolkata', midnightIST)).toBe(0);
  });

  it('falls back to server time for a nonsense timezone', () => {
    expect(localHourIn('Not/AZone', at)).toBe(at.getHours());
    expect(localHourIn(undefined, at)).toBe(at.getHours());
  });
});

describe('isSendHourIn', () => {
  it('matches exactly one hour of the day', () => {
    const hours = Array.from({ length: 24 }, (_, h) =>
      isSendHourIn('Asia/Kolkata', new Date(Date.UTC(2026, 8, 8, h, 15)), 8),
    );
    expect(hours.filter(Boolean)).toHaveLength(1);
  });

  it("fires for each timezone at its own 8 AM, not the server's", () => {
    // 02:30Z = 08:00 IST but 06:30 GST — only India should fire.
    const at = new Date('2026-09-08T02:30:00Z');
    expect(isSendHourIn('Asia/Kolkata', at, 8)).toBe(true);
    expect(isSendHourIn('Asia/Dubai', at, 8)).toBe(false);

    // 04:30Z = 08:30 GST but 10:00 IST — only the UAE should fire.
    const later = new Date('2026-09-08T04:30:00Z');
    expect(isSendHourIn('Asia/Dubai', later, 8)).toBe(true);
    expect(isSendHourIn('Asia/Kolkata', later, 8)).toBe(false);
  });
});

describe('startOfLocalDay', () => {
  it('resolves the local calendar day, not the server one', () => {
    // 20:00Z on the 8th is already the 9th in India; its window opens at
    // local midnight, 18:30Z on the 8th.
    const at = new Date('2026-09-08T20:00:00Z');
    expect(startOfLocalDay('Asia/Kolkata', at).toISOString()).toBe(
      '2026-09-08T18:30:00.000Z',
    );
    // ...but still the 8th in New York.
    expect(startOfLocalDay('America/New_York', at).toISOString()).toBe(
      '2026-09-08T00:00:00.000Z',
    );
  });

  it('is stable across the whole local day', () => {
    const morning = startOfLocalDay(
      'Asia/Dubai',
      new Date('2026-09-08T04:00:00Z'),
    );
    const evening = startOfLocalDay(
      'Asia/Dubai',
      new Date('2026-09-08T15:00:00Z'),
    );
    expect(morning.toISOString()).toBe(evening.toISOString());
  });

  // A date is saved either as UTC midnight (server) or local midnight (app
  // screens). "Today" must hold both, and neither may spill into another day.
  it.each([
    ['Asia/Kolkata', '2026-10-07T00:00:00Z', '2026-10-06T18:30:00Z', '2026-10-08T00:00:00Z', '2026-10-07T18:30:00Z'],
    ['Asia/Dubai', '2026-10-07T00:00:00Z', '2026-10-06T20:00:00Z', '2026-10-08T00:00:00Z', '2026-10-07T20:00:00Z'],
    ['America/New_York', '2026-10-07T00:00:00Z', '2026-10-07T04:00:00Z', '2026-10-08T00:00:00Z', '2026-10-08T04:00:00Z'],
  ])('%s: both ways of saving 7 Oct fall on 7 Oct, and 8 Oct does not', (tz, utcMid, localMid, nextUtcMid, nextLocalMid) => {
    // 10:00 local on 7 Oct.
    const noonish = new Date(new Date(localMid).getTime() + 10 * 3600_000);
    const start = startOfLocalDay(tz, noonish).getTime();
    const end = start + 86_400_000;
    const inToday = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= start && t < end;
    };
    expect(inToday(utcMid)).toBe(true);
    expect(inToday(localMid)).toBe(true);
    expect(inToday(nextUtcMid)).toBe(false);
    expect(inToday(nextLocalMid)).toBe(false);
  });

  it('with no timezone uses India, not the server clock', () => {
    const at = new Date('2026-10-06T20:00:00Z'); // 01:30 on the 7th in India
    expect(startOfLocalDay(undefined, at).toISOString()).toBe('2026-10-06T18:30:00.000Z');
  });
});
