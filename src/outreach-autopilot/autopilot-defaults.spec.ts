import { allocate, istDayKey, istDayStart, istDaysLeftInMonth, splitByWeight } from './autopilot-defaults';

describe('splitByWeight', () => {
  it('always adds up to the total', () => {
    expect(splitByWeight(33, [1, 1, 1, 1])).toEqual([9, 8, 8, 8]);
    expect(splitByWeight(10, [2, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('gives nothing to a region with weight 0', () => {
    expect(splitByWeight(9, [1, 0, 2])).toEqual([3, 0, 6]);
  });

  it('handles nothing to share', () => {
    expect(splitByWeight(0, [1, 1])).toEqual([0, 0]);
    expect(splitByWeight(5, [0, 0])).toEqual([0, 0]);
  });
});

describe('allocate', () => {
  it('passes a short region\'s unused share to the others', () => {
    // 250 WhatsApp across 4 equal regions; Kerala only has 20 fresh leads.
    const out = allocate(250, [1, 1, 1, 1], [20, 500, 500, 500]);
    expect(out[0]).toBe(20);
    expect(out.reduce((a, b) => a + b, 0)).toBe(250);
    expect(Math.max(...out.slice(1)) - Math.min(...out.slice(1))).toBeLessThanOrEqual(1);
  });

  it('never gives more than a region has', () => {
    expect(allocate(100, [1, 1], [10, 15])).toEqual([10, 15]);
  });
});

describe('India dates', () => {
  it('uses the India day, not UTC', () => {
    // 20:00 UTC on 4 Oct is 01:30 on 5 Oct in India.
    expect(istDayKey(new Date('2026-10-04T20:00:00Z'))).toBe('2026-10-05');
    expect(istDayStart('2026-10-05').toISOString()).toBe('2026-10-04T18:30:00.000Z');
  });

  it('counts the days left in the month, today included', () => {
    expect(istDaysLeftInMonth(new Date('2026-10-05T06:00:00Z'))).toBe(27);
    expect(istDaysLeftInMonth(new Date('2026-10-31T06:00:00Z'))).toBe(1);
  });
});
