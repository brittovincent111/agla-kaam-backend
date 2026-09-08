export const DEFAULT_SERVICE_PRESETS = [
  'AC Gas Refill',
  'AC General Service',
  'AC Installation',
];

export const TRADE_TYPES = [
  'AC repair',
  'RO / water purifier',
  'Appliance repair',
  'Garage / vehicle service',
  'Other',
] as const;

export const SERVICE_PRESETS_BY_TRADE: Record<string, string[]> = {
  'AC repair': ['AC Gas Refill', 'AC General Service', 'AC Installation'],
  'RO / water purifier': [
    'RO Filter Change',
    'RO General Service',
    'RO Installation',
  ],
  'Appliance repair': [
    'Diagnosis & Repair',
    'General Service',
    'Installation',
  ],
  'Garage / vehicle service': [
    'General Service',
    'Oil Change',
    'Brake Service',
  ],
};

export function presetsForTrade(tradeType?: string): string[] {
  return SERVICE_PRESETS_BY_TRADE[tradeType ?? ''] ?? DEFAULT_SERVICE_PRESETS;
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

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
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
