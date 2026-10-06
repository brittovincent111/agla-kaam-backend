// Place of supply for Indian GST, and whether a supply is inter-state.
//
// GST on a supply within one state is split into CGST + SGST; on a supply
// across states it is charged as IGST. Printing CGST + SGST on an invoice to
// a customer in another state is simply wrong, and every invoice used to do
// exactly that, because nothing knew which state either party was in.
//
// Neither a business nor a customer stores a state as its own field, so it is
// worked out from what IS stored, most reliable first:
//   1. The GSTIN. Its first two digits are the state code — authoritative.
//   2. The address. A state name (or one of the few common alternative
//      spellings) written in it, then a short list of cities that name their
//      state unambiguously.
// When either side cannot be placed the supply is treated as intra-state,
// which is what every invoice printed before this existed, so an unknown
// never changes a document for the worse.

// GST state codes, as the first two digits of a GSTIN.
const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

const CODE_BY_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(GST_STATE_CODES).map(([code, name]) => [name, code]),
);

// Written forms that name a state, matched as whole words, case-insensitive.
// Longest first so "Andhra Pradesh" wins over a bare "Pradesh"-style partial.
const STATE_ALIASES: [string, string][] = [
  ...Object.values(GST_STATE_CODES).map(
    (name) => [name, name] as [string, string],
  ),
  ['Jammu & Kashmir', 'Jammu and Kashmir'],
  ['J&K', 'Jammu and Kashmir'],
  ['New Delhi', 'Delhi'],
  ['NCT of Delhi', 'Delhi'],
  ['Orissa', 'Odisha'],
  ['Pondicherry', 'Puducherry'],
  ['Uttaranchal', 'Uttarakhand'],
  ['Andaman & Nicobar', 'Andaman and Nicobar Islands'],
  ['Daman and Diu', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['Dadra and Nagar Haveli', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['Tamilnadu', 'Tamil Nadu'],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

// Cities that are commonly written without their state and belong to exactly
// one. Kept short on purpose: a city is only here when the name cannot mean
// anywhere else.
const CITY_STATE: [string, string][] = [
  ['Bengaluru', 'Karnataka'],
  ['Bangalore', 'Karnataka'],
  ['Mysuru', 'Karnataka'],
  ['Mysore', 'Karnataka'],
  ['Mangaluru', 'Karnataka'],
  ['Mangalore', 'Karnataka'],
  ['Mumbai', 'Maharashtra'],
  ['Pune', 'Maharashtra'],
  ['Nagpur', 'Maharashtra'],
  ['Thane', 'Maharashtra'],
  ['Chennai', 'Tamil Nadu'],
  ['Coimbatore', 'Tamil Nadu'],
  ['Madurai', 'Tamil Nadu'],
  ['Hyderabad', 'Telangana'],
  ['Secunderabad', 'Telangana'],
  ['Visakhapatnam', 'Andhra Pradesh'],
  ['Vijayawada', 'Andhra Pradesh'],
  ['Kolkata', 'West Bengal'],
  ['Ahmedabad', 'Gujarat'],
  ['Surat', 'Gujarat'],
  ['Vadodara', 'Gujarat'],
  ['Jaipur', 'Rajasthan'],
  ['Lucknow', 'Uttar Pradesh'],
  ['Noida', 'Uttar Pradesh'],
  ['Ghaziabad', 'Uttar Pradesh'],
  ['Gurugram', 'Haryana'],
  ['Gurgaon', 'Haryana'],
  ['Faridabad', 'Haryana'],
  ['Bhopal', 'Madhya Pradesh'],
  ['Indore', 'Madhya Pradesh'],
  ['Patna', 'Bihar'],
  ['Bhubaneswar', 'Odisha'],
  ['Guwahati', 'Assam'],
  ['Ludhiana', 'Punjab'],
  ['Amritsar', 'Punjab'],
  ['Dehradun', 'Uttarakhand'],
  ['Kochi', 'Kerala'],
  ['Cochin', 'Kerala'],
  ['Ernakulam', 'Kerala'],
  ['Thiruvananthapuram', 'Kerala'],
  ['Trivandrum', 'Kerala'],
  ['Thrissur', 'Kerala'],
  ['Kozhikode', 'Kerala'],
  ['Calicut', 'Kerala'],
  ['Panaji', 'Goa'],
  ['Ranchi', 'Jharkhand'],
  ['Raipur', 'Chhattisgarh'],
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findIn(
  address: string,
  table: [string, string][],
): string | undefined {
  for (const [written, state] of table) {
    if (
      new RegExp(
        `(^|[^A-Za-z])${escapeRegExp(written)}([^A-Za-z]|$)`,
        'i',
      ).test(address)
    ) {
      return state;
    }
  }
  return undefined;
}

export function stateFromGstin(gstin?: string): string | undefined {
  const code = gstin?.trim().slice(0, 2);
  return code ? GST_STATE_CODES[code] : undefined;
}

export function stateFromAddress(address?: string): string | undefined {
  if (!address?.trim()) return undefined;
  return findIn(address, STATE_ALIASES) ?? findIn(address, CITY_STATE);
}

export function gstStateCode(state?: string): string | undefined {
  return state ? CODE_BY_STATE[state] : undefined;
}

export interface SupplyParty {
  address?: string;
  gstin?: string;
  taxRegistrationNumber?: string;
}

export interface GstSupply {
  businessState?: string;
  customerState?: string;
  // The customer's state when known; otherwise the business's own, which is
  // the intra-state assumption made explicit.
  placeOfSupply?: string;
  interState: boolean;
}

/**
 * Where an Indian GST supply takes place. Returns undefined for any document
 * that is not Indian GST, so callers can pass the result straight through
 * without checking the tax type themselves.
 */
export function resolveGstSupply(
  taxType: string,
  country: string,
  business: SupplyParty,
  customer: SupplyParty,
): GstSupply | undefined {
  if (taxType !== 'gst' || (country && country !== 'IN')) return undefined;
  const businessState =
    stateFromGstin(business.gstin || business.taxRegistrationNumber) ??
    stateFromAddress(business.address);
  const customerState =
    stateFromGstin(customer.gstin || customer.taxRegistrationNumber) ??
    stateFromAddress(customer.address);
  return {
    businessState,
    customerState,
    placeOfSupply: customerState ?? businessState,
    interState:
      !!businessState && !!customerState && businessState !== customerState,
  };
}
