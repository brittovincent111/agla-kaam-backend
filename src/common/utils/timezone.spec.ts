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

  it('fires for each timezone at its own 8 AM, not the server\'s', () => {
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
    // 20:00Z on the 8th is already the 9th in India.
    const at = new Date('2026-09-08T20:00:00Z');
    expect(startOfLocalDay('Asia/Kolkata', at).toISOString()).toBe(
      '2026-09-09T00:00:00.000Z',
    );
    // ...but still the 8th in New York.
    expect(startOfLocalDay('America/New_York', at).toISOString()).toBe(
      '2026-09-08T00:00:00.000Z',
    );
  });

  it('is stable across the whole local day', () => {
    const morning = startOfLocalDay('Asia/Dubai', new Date('2026-09-08T04:00:00Z'));
    const evening = startOfLocalDay('Asia/Dubai', new Date('2026-09-08T15:00:00Z'));
    expect(morning.toISOString()).toBe(evening.toISOString());
  });
});
