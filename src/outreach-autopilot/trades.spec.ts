import { AUTOPILOT_TRADES, TRADES, kindOf, searchQueryFor } from '../lead-finder/trades';
import { DEFAULT_CATEGORIES } from './autopilot-defaults';
import { TRADE_BODIES, TRADE_COPY, tradeEmail } from './trade-copy';
import { AutopilotService } from './autopilot.service';

describe('trades', () => {
  it('sends Google search words, not the internal code', () => {
    expect(searchQueryFor('ac_service')).toBe('AC service repair technician');
    expect(searchQueryFor('pest_control')).toBe('pest control service');
    expect(searchQueryFor('some_new_trade')).toBe('some new trade');
  });

  it('has 12 main and 19 secondary trades, no painting', () => {
    expect(TRADES.filter((t) => t.tier === 'primary')).toHaveLength(12);
    expect(TRADES.filter((t) => t.tier === 'secondary')).toHaveLength(19);
    expect(TRADES.some((t) => /paint/.test(t.value))).toBe(false);
    expect(new Set(TRADES.map((t) => t.value)).size).toBe(TRADES.length);
  });

  it('the autopilot defaults to the 3 core trades for now', () => {
    expect(DEFAULT_CATEGORIES).toEqual(AUTOPILOT_TRADES);
    expect(AUTOPILOT_TRADES).toEqual(['ac_service', 'ro_service', 'appliance_repair']);
    expect(AUTOPILOT_TRADES.every((v) => TRADES.some((t) => t.value === v))).toBe(true);
    expect(AUTOPILOT_TRADES).not.toContain('electrician');
  });

  it('groups trades by the kind of work the email talks about', () => {
    expect(kindOf('pest_control')).toBe('pest');
    expect(kindOf('fire_safety')).toBe('amc');
    expect(kindOf('car_wash')).toBe('vehicle');
    expect(kindOf(undefined)).toBe('service');
  });
});

describe('trade emails', () => {
  const kinds = Array.from(new Set(TRADES.map((t) => t.kind)));

  it.each(Object.keys(TRADE_COPY))('%s has a subject and opening line for every kind of work', (lang) => {
    for (const k of kinds) {
      expect(TRADE_COPY[lang][k].subject.length).toBeGreaterThan(10);
      expect(TRADE_COPY[lang][k].line.length).toBeGreaterThan(40);
    }
  });

  it('fills the opening line and the subject for the kind', () => {
    const e = tradeEmail('ml', 'pest', TRADE_BODIES.ml, 'fallback');
    expect(e.subject).toBe(TRADE_COPY.ml.pest.subject);
    expect(e.body).toContain(TRADE_COPY.ml.pest.line);
    expect(e.body).not.toContain('{{tradeLine}}');
    expect(e.body).toContain('{{unsubscribeUrl}}');
  });

  it('leaves an email someone wrote themselves alone', () => {
    expect(tradeEmail('en', 'amc', 'My own words', 'My subject')).toEqual({ subject: 'My subject', body: 'My own words' });
  });

  it('a language without its own lines uses English', () => {
    expect(tradeEmail('te', 'solar', TRADE_BODIES.en, 'x').subject).toBe(TRADE_COPY.en.solar.subject);
  });
});

describe('autopilot search order', () => {
  const nextCombos = (AutopilotService.prototype as any).nextCombos;
  const region: any = {
    places: [{ state: 'Kerala', city: 'Kochi', localities: ['Kakkanad', 'Edappally', 'Vyttila'] }],
    categories: ['ac_service', 'etp_stp', 'water_tank_cleaning'],
  };

  it('searches specialist trades once per city and main trades first', () => {
    const combos = nextCombos.call({}, region, new Map());
    const etp = combos.filter((c: any) => c.category === 'etp_stp');
    expect(etp).toHaveLength(1);
    expect(etp[0].area).toBe('');
    expect(combos.filter((c: any) => c.category === 'water_tank_cleaning')).toHaveLength(3);
    const firstSecondary = combos.findIndex((c: any) => c.secondary);
    expect(combos.slice(0, firstSecondary).every((c: any) => c.category === 'ac_service')).toBe(true);
    expect(firstSecondary).toBe(3);
  });
});
