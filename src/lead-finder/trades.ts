/**
 * The trades lead search covers, matched to the trades the app offers at
 * sign-up (mobile/src/trades.ts), with the words actually sent to Google.
 *
 * `kind` groups trades whose outreach says the same thing (see the
 * autopilot's per-kind email lines): repeat-service shops, vehicle service,
 * AMC contracts, pest treatments, solar upkeep, and one-off job work.
 */
export type TradeKind = 'service' | 'vehicle' | 'amc' | 'pest' | 'solar' | 'job';

export interface Trade {
  value: string;
  label: string;
  query: string;
  kind: TradeKind;
  // primary: the trades the app is built around, searched first.
  // secondary: repeat/AMC trades searched once the primary ones are covered.
  tier: 'primary' | 'secondary';
  // locality: searched area by area. city: specialist B2B trades with few
  // businesses per area, searched once per city to save Google calls.
  scope: 'locality' | 'city';
}

export const TRADES: Trade[] = [
  { value: 'ac_service', label: 'AC Service & Repair', query: 'AC service repair technician', kind: 'service', tier: 'primary', scope: 'locality' },
  { value: 'ro_service', label: 'Water Purifier / RO', query: 'water purifier RO service', kind: 'service', tier: 'primary', scope: 'locality' },
  { value: 'appliance_repair', label: 'Appliance Repair', query: 'washing machine refrigerator repair service', kind: 'service', tier: 'primary', scope: 'locality' },
  { value: 'car_repair', label: 'Auto Garage & Bike Workshop', query: 'car bike service workshop mechanic', kind: 'vehicle', tier: 'primary', scope: 'locality' },
  { value: 'cctv_installation', label: 'CCTV & Security', query: 'CCTV camera installation service', kind: 'amc', tier: 'primary', scope: 'locality' },
  { value: 'solar_inverter', label: 'Solar, Inverter & Battery', query: 'solar panel inverter battery service', kind: 'solar', tier: 'primary', scope: 'locality' },
  { value: 'pest_control', label: 'Pest Control', query: 'pest control service', kind: 'pest', tier: 'primary', scope: 'locality' },
  { value: 'facility_amc', label: 'Facility Management & AMC', query: 'facility management AMC maintenance services', kind: 'amc', tier: 'primary', scope: 'locality' },
  { value: 'fire_safety', label: 'Fire Safety & Extinguishers', query: 'fire extinguisher refilling fire safety services', kind: 'amc', tier: 'primary', scope: 'locality' },
  { value: 'lift_amc', label: 'Lift / Elevator Maintenance', query: 'lift elevator maintenance AMC service', kind: 'amc', tier: 'primary', scope: 'locality' },
  { value: 'electrician', label: 'Electrician', query: 'electrician electrical contractor', kind: 'job', tier: 'primary', scope: 'locality' },
  { value: 'plumbing', label: 'Plumber', query: 'plumber plumbing service', kind: 'job', tier: 'primary', scope: 'locality' },
  // Secondary: repeat-visit and AMC trades beyond the app's core list.
  { value: 'generator_service', label: 'Generator / Genset', query: 'generator genset service AMC', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'water_tank_cleaning', label: 'Water Tank Cleaning', query: 'water tank cleaning service', kind: 'service', tier: 'secondary', scope: 'locality' },
  { value: 'etp_stp', label: 'ETP / STP Water Treatment', query: 'ETP STP water treatment plant maintenance', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'commercial_refrigeration', label: 'Commercial Refrigeration & Cold Room', query: 'commercial refrigeration cold room service', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'kitchen_equipment', label: 'Commercial Kitchen & Restaurant Equipment', query: 'commercial kitchen equipment service', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'gym_equipment', label: 'Gym Equipment', query: 'gym equipment service repair', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'medical_equipment', label: 'Medical, Dental & Lab Equipment', query: 'medical equipment service maintenance', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'printer_copier', label: 'Printer / Photocopier', query: 'printer photocopier service AMC', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'it_support', label: 'Computer / IT Support & Networking', query: 'computer laptop repair IT AMC networking', kind: 'amc', tier: 'secondary', scope: 'locality' },
  { value: 'pump_motor', label: 'Pump / Motor / Borewell', query: 'water pump motor borewell service', kind: 'service', tier: 'secondary', scope: 'locality' },
  { value: 'compressor_service', label: 'Compressor', query: 'air compressor service', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'industrial_hvac', label: 'Industrial HVAC / Chiller', query: 'industrial HVAC chiller maintenance', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'swimming_pool', label: 'Swimming Pool Maintenance', query: 'swimming pool maintenance service', kind: 'service', tier: 'secondary', scope: 'city' },
  { value: 'cleaning_service', label: 'Home / Office Cleaning', query: 'home office deep cleaning service', kind: 'service', tier: 'secondary', scope: 'locality' },
  { value: 'chimney_service', label: 'Kitchen Chimney / Exhaust', query: 'kitchen chimney service cleaning', kind: 'service', tier: 'secondary', scope: 'locality' },
  { value: 'access_control', label: 'Access Control / Biometric', query: 'biometric access control installation service', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'car_wash', label: 'Car Wash / Detailing', query: 'car wash detailing', kind: 'vehicle', tier: 'secondary', scope: 'locality' },
  { value: 'ev_charger', label: 'EV Charger', query: 'EV charger installation service', kind: 'amc', tier: 'secondary', scope: 'city' },
  { value: 'landscaping', label: 'Gardening / Landscaping', query: 'gardening landscaping maintenance service', kind: 'service', tier: 'secondary', scope: 'city' },
];

/**
 * Trades the autopilot searches and messages by default — for now only the
 * three Agla Kaam is built around (AC, RO, appliance repair). Pest control,
 * solar, CCTV, garages, water tanks and fire safety are the next to add once
 * the per-trade results show these three converting. Every trade stays
 * available for manual searches and per-region opt-in.
 */
export const AUTOPILOT_TRADES = ['ac_service', 'ro_service', 'appliance_repair'];

const BY_VALUE = new Map(TRADES.map((t) => [t.value, t]));

export function tradeOf(category?: string): Trade | undefined {
  return category ? BY_VALUE.get(category) : undefined;
}

/** What to type into Google for a trade; an unknown slug loses its underscores. */
export function searchQueryFor(category?: string): string {
  return tradeOf(category)?.query ?? (category ?? '').replace(/_/g, ' ').trim();
}

export function kindOf(category?: string): TradeKind {
  return tradeOf(category)?.kind ?? 'service';
}
