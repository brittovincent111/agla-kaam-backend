import { EmailFinderService, PageResponse } from './email-finder.service';

// Every host resolves to a public address unless the test says otherwise.
const lookup = jest.fn(async (host: string) =>
  host === 'internal.test' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }],
);
jest.mock('dns/promises', () => ({ lookup: (h: string) => lookup(h) }));

const pages: Record<string, PageResponse> = {};
const fetched: { url: string; address: string }[] = [];

// The finder's own GET, replaced with canned pages; records where it would connect.
class TestFinder extends EmailFinderService {
  protected async httpGet(url: URL, addr: { address: string }) {
    fetched.push({ url: url.toString(), address: addr.address });
    return pages[url.toString()] ?? { status: 404, contentType: 'text/html', body: 'not found' };
  }
}

const html = (body: string): PageResponse => ({ status: 200, contentType: 'text/html; charset=utf-8', body });
const redirect = (location: string): PageResponse => ({ status: 301, location });

beforeEach(() => {
  for (const k of Object.keys(pages)) delete pages[k];
  fetched.length = 0;
});

const finder = new TestFinder({} as any, {} as any);

describe('EmailFinderService.findForWebsite', () => {
  it('follows the contact link and returns the own-domain address', async () => {
    pages['http://coolcare.in/'] = redirect('https://www.coolcare.in/');
    pages['https://www.coolcare.in/'] = html('<a href="/reach-us">Contact</a> designed by hello@webagency.com');
    pages['https://www.coolcare.in/reach-us'] = html('Write to <a href="mailto:info@coolcare.in">info@coolcare.in</a>');
    await expect(finder.findForWebsite('coolcare.in')).resolves.toBe('info@coolcare.in');
  });

  it('connects to the address it checked', async () => {
    pages['https://ravi-ac.in/'] = html('Call or mail ravi.ac.kochi@gmail.com');
    await expect(finder.findForWebsite('https://ravi-ac.in')).resolves.toBe('ravi.ac.kochi@gmail.com');
    expect(fetched[0]).toEqual({ url: 'https://ravi-ac.in/', address: '93.184.216.34' });
  });

  it('does not open listing sites like Facebook or Justdial', async () => {
    await expect(finder.findForWebsite('https://www.facebook.com/coolcare')).resolves.toBeNull();
    await expect(finder.findForWebsite('https://www.justdial.com/Kochi/cool')).resolves.toBeNull();
    expect(fetched).toEqual([]);
  });

  it('refuses a redirect into a private network', async () => {
    pages['https://sneaky.in/'] = redirect('http://internal.test/admin');
    await expect(finder.findForWebsite('https://sneaky.in')).resolves.toBeNull();
    expect(fetched.map((f) => f.url)).toEqual(['https://sneaky.in/']);
  });

  it('refuses an IP address on a private range outright', async () => {
    await expect(finder.findForWebsite('http://169.254.169.254/latest/meta-data')).resolves.toBeNull();
    expect(fetched).toEqual([]);
  });

  it('skips non-HTML responses', async () => {
    pages['https://pdfonly.in/'] = { status: 200, contentType: 'application/pdf', body: 'owner@pdfonly.in' };
    await expect(finder.findForWebsite('https://pdfonly.in')).resolves.toBeNull();
  });
});
