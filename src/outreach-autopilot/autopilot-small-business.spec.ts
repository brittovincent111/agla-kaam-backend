import { AutopilotService } from './autopilot.service';

// WhatsApp outreach goes to small, owner-run businesses: big firms' listed
// numbers reach staff, and they reply a seventh as often.
function svc(env: Record<string, string> = {}) {
  const s: any = Object.create(AutopilotService.prototype);
  s.config = { get: (k: string) => env[k] };
  return s;
}
const region: any = { places: [{ city: 'Kochi' }], categories: [] };

// Evaluates the query's two size/name conditions the way MongoDB would.
function passes(q: any, lead: { businessName: string; reviewCount?: number | null }) {
  if (q.businessName.$not.test(lead.businessName)) return false;
  return q.$or.some((c: any) =>
    c.reviewCount?.$exists === false
      ? lead.reviewCount === undefined
      : c.reviewCount === null
        ? lead.reviewCount === null
        : (lead.reviewCount ?? Infinity) <= c.reviewCount.$lte,
  );
}

describe('WhatsApp outreach targets small businesses', () => {
  const q = () => svc().freshWhatsappQuery(region);

  it.each([
    ['Sharma Cooling', 4],
    ['RK Refrigeration', 99],
    ['Anand RO Service', undefined],
  ])('includes %s (%s reviews)', (businessName, reviewCount) => {
    expect(passes(q(), { businessName, reviewCount })).toBe(true);
  });

  it('skips businesses with 100 or more reviews', () => {
    expect(passes(q(), { businessName: 'City AC Care', reviewCount: 100 })).toBe(false);
    expect(passes(q(), { businessName: 'Mega Cool Services', reviewCount: 850 })).toBe(false);
  });

  it.each(['Blue Star Climate Pvt Ltd', 'Coolair Private Limited', 'Voltas Authorised Service Centre', 'Frost Engineering LLP'])(
    'skips the company %s',
    (businessName) => {
      expect(passes(q(), { businessName, reviewCount: 3 })).toBe(false);
    },
  );

  it('WHATSAPP_MAX_REVIEWS adjusts the limit, and 0 turns it off', () => {
    expect(svc({ WHATSAPP_MAX_REVIEWS: '49' }).maxWhatsappReviews()).toBe(49);
    expect(svc({ WHATSAPP_MAX_REVIEWS: '0' }).maxWhatsappReviews()).toBe(Number.MAX_SAFE_INTEGER);
    expect(svc({ WHATSAPP_MAX_REVIEWS: '' }).maxWhatsappReviews()).toBe(99);
    expect(svc({}).maxWhatsappReviews()).toBe(99);
  });
});
