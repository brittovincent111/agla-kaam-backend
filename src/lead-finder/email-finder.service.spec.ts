import { extractEmails, isPrivate, pickBest } from './email-finder.service';

describe('extractEmails', () => {
  it('finds plain, mailto and obfuscated addresses', () => {
    const html = `
      <a href="mailto:Info@CoolCare.in">Mail us</a>
      sales [at] coolcare [dot] in
      owner&#64;gmail.com`;
    expect(extractEmails(html).sort()).toEqual(['info@coolcare.in', 'owner@gmail.com', 'sales@coolcare.in']);
  });

  it('drops image names, template junk and no-reply addresses', () => {
    const html = 'logo@2x.png user@example.com 1234@sentry.wixpress.com noreply@coolcare.in';
    expect(extractEmails(html)).toEqual([]);
  });
});

describe('pickBest', () => {
  it("prefers the site's own domain, then a role address", () => {
    expect(pickBest(['ravi@gmail.com', 'ravi@coolcare.in', 'info@coolcare.in'], 'coolcare.in')).toBe('info@coolcare.in');
  });

  it('accepts a free-mail inbox when the site has no own-domain email', () => {
    expect(pickBest(['coolcare.kochi@gmail.com'], 'coolcare.in')).toBe('coolcare.kochi@gmail.com');
  });

  it("refuses someone else's domain (the web designer's, say)", () => {
    expect(pickBest(['hello@webagency.com'], 'coolcare.in')).toBeNull();
  });
});

describe('isPrivate', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1'])(
    'blocks %s',
    (ip) => expect(isPrivate(ip)).toBe(true),
  );

  it.each(['8.8.8.8', '142.250.183.14', '2606:4700::1111'])('allows %s', (ip) => expect(isPrivate(ip)).toBe(false));
});
