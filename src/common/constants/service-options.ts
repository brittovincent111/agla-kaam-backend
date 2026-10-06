// Starter service types per trade. Keys are the trade values the app saves
// (mobile/src/trades.ts); a saved trade can carry a specialty after " • ",
// which presetsForTrade strips before looking it up.
//
// Each comes with a warranty and a next-service interval that are sensible
// starting points for that kind of work — the owner changes them in Service
// Presets. They are what Log Service fills in when the type is picked, in
// place of "no warranty, back in 6 months" for every trade alike.

export interface StarterPreset {
  name: string;
  warrantyPeriod: 'none' | '30d' | '90d' | '6m' | '1y';
  nextServiceInterval: 'none' | '1m' | '3m' | '6m' | '1y';
}

const p = (
  name: string,
  warrantyPeriod: StarterPreset['warrantyPeriod'],
  nextServiceInterval: StarterPreset['nextServiceInterval'],
): StarterPreset => ({ name, warrantyPeriod, nextServiceInterval });

export const SERVICE_PRESETS_BY_TRADE: Record<string, StarterPreset[]> = {
  'AC repair': [
    p('AC General Service', '30d', '6m'),
    p('AC Gas Refill', '90d', '1y'),
    p('AC Installation', '1y', '6m'),
    p('AC Uninstallation', 'none', 'none'),
    p('AC PCB Repair', '90d', 'none'),
  ],
  'RO / water purifier': [
    p('RO Filter Change', '30d', '3m'),
    p('RO General Service', '30d', '3m'),
    p('RO Installation', '1y', '3m'),
    p('RO Membrane Replacement', '6m', '1y'),
  ],
  'Appliance repair': [
    p('Washing Machine Repair', '90d', 'none'),
    p('Refrigerator Repair', '90d', 'none'),
    p('Microwave Repair', '90d', 'none'),
    p('Appliance Installation', '30d', 'none'),
  ],
  'Garage / vehicle service': [
    p('General Service', '30d', '6m'),
    p('Oil Change', 'none', '6m'),
    p('Brake Service', '90d', '1y'),
    p('Battery Replacement', '1y', 'none'),
  ],
  'CCTV & security': [
    p('CCTV Installation', '1y', '6m'),
    p('DVR / NVR Service', '90d', '6m'),
    p('CCTV Annual Maintenance', 'none', '6m'),
    p('Camera Repair', '90d', 'none'),
  ],
  'Inverter / battery / solar': [
    p('Battery Water Top-up', 'none', '3m'),
    p('Inverter Service', '90d', '6m'),
    p('Solar Panel Cleaning', 'none', '3m'),
    p('Inverter / Solar Installation', '1y', '6m'),
  ],
  'Pest control': [
    p('General Pest Control', '90d', '3m'),
    p('Termite Treatment', '1y', '1y'),
    p('Cockroach Gel Treatment', '90d', '3m'),
    p('Bed Bug Treatment', '30d', '3m'),
  ],
  'Electrical & plumbing': [
    p('Electrical Wiring Repair', '30d', 'none'),
    p('Plumbing Leak Repair', '30d', 'none'),
    p('Fixture Installation', '30d', 'none'),
    p('Motor / Pump Service', '90d', '6m'),
  ],
  'Facility management': [
    p('AMC Visit', 'none', '1m'),
    p('Deep Cleaning', 'none', '3m'),
    p('Preventive Maintenance', 'none', '1m'),
    p('Breakdown Call', '30d', 'none'),
  ],
  // "Other" and anything unrecognised: neutral names. This used to hand
  // every non-AC business "AC Gas Refill" and friends.
  Other: [
    p('General Service', 'none', 'none'),
    p('Repair', '30d', 'none'),
    p('Installation', '90d', 'none'),
    p('Inspection', 'none', 'none'),
  ],
};

// A business registered before choosing a trade gets these until it does.
export const DEFAULT_SERVICE_PRESETS: StarterPreset[] =
  SERVICE_PRESETS_BY_TRADE.Other;

export const TRADE_TYPES = Object.keys(SERVICE_PRESETS_BY_TRADE);

export function presetsForTrade(tradeType?: string): StarterPreset[] {
  const category = (tradeType ?? '')
    .split(' • ')[0]
    .split(' - ')[0]
    .trim()
    .toLowerCase();
  const key = Object.keys(SERVICE_PRESETS_BY_TRADE).find(
    (k) => k.toLowerCase() === category,
  );
  return SERVICE_PRESETS_BY_TRADE[key ?? 'Other'];
}

export const WARRANTY_PERIODS = [
  'none',
  '30d',
  '90d',
  '6m',
  '1y',
  'custom',
] as const;

export type WarrantyPeriod = (typeof WARRANTY_PERIODS)[number];

export const NEXT_SERVICE_INTERVALS = [
  'none',
  '1m',
  '3m',
  '6m',
  '1y',
  'custom',
] as const;

export type NextServiceInterval = (typeof NEXT_SERVICE_INTERVALS)[number];

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Clamped to the last day of the target month. A plain setMonth rolls the
// overflow into the next month, so 31 Jan + 1 month came out as 3 Mar (2 Mar
// in a leap year) and a "monthly" reminder skipped February entirely.
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function resolveWarrantyExpiry(
  serviceDate: Date,
  period: WarrantyPeriod,
  customDate?: Date,
): Date | null {
  switch (period) {
    case 'none':
      return null;
    case '30d':
      return addDays(serviceDate, 30);
    case '90d':
      return addDays(serviceDate, 90);
    case '6m':
      return addMonths(serviceDate, 6);
    case '1y':
      return addMonths(serviceDate, 12);
    case 'custom':
      if (!customDate) {
        throw new Error(
          'customWarrantyDate is required when warrantyPeriod is "custom"',
        );
      }
      return customDate;
  }
}

export function resolveNextServiceDate(
  serviceDate: Date,
  interval: NextServiceInterval,
  customDate?: Date,
): Date {
  switch (interval) {
    case 'none':
      return serviceDate;
    case '1m':
      return addMonths(serviceDate, 1);
    case '3m':
      return addMonths(serviceDate, 3);
    case '6m':
      return addMonths(serviceDate, 6);
    case '1y':
      return addMonths(serviceDate, 12);
    case 'custom':
      if (!customDate) {
        throw new Error(
          'customNextServiceDate is required when nextServiceInterval is "custom"',
        );
      }
      return customDate;
  }
}
