import { TemplateEngineService } from '../services/template-engine.service';

describe('TemplateEngineService', () => {
  let service: TemplateEngineService;

  beforeEach(() => {
    service = new TemplateEngineService();
  });

  describe('render', () => {
    it('replaces all supported lead variables correctly', () => {
      const template =
        'Hello {{name}} from {{city}}, welcome to Agla Kaam for {{category}}!';
      const context = {
        name: 'Cool Breeze AC',
        city: 'Bengaluru',
        category: 'AC Repair',
      };

      const result = service.render(template, context);
      expect(result).toBe(
        'Hello Cool Breeze AC from Bengaluru, welcome to Agla Kaam for AC Repair!',
      );
    });

    it('falls back to Business Owner when name is missing', () => {
      const template = 'Dear {{name}}, we have an offer.';
      const result = service.render(template, {});
      expect(result).toBe('Dear Business Owner, we have an offer.');
    });

    it('does not evaluate arbitrary javascript or code injection', () => {
      const template = 'Value: {{constructor}} {{__proto__}} {{toString}}';
      const result = service.render(template, { name: 'Safe' });
      expect(result).toBe('Value: {{constructor}} {{__proto__}} {{toString}}');
    });
  });

  describe('compileHtml', () => {
    it('automatically injects unsubscribe footer if not present', () => {
      const html =
        '<html><body><h1>Special Offer</h1><p>Grow your business</p></body></html>';
      const unsubUrl =
        'https://aglakaam.app/api/marketing/unsubscribe?token=abc';
      const result = service.compileHtml(
        html,
        { businessName: 'Test' },
        unsubUrl,
      );

      expect(result).toContain(unsubUrl);
      expect(result).toContain('unsubscribe here');
      expect(result).toContain('</body>');
    });

    it('does not duplicate unsubscribe footer if {{unsubscribeUrl}} is already in template', () => {
      const html =
        '<p>Click <a href="{{unsubscribeUrl}}">opt out</a> anytime.</p>';
      const unsubUrl =
        'https://aglakaam.app/api/marketing/unsubscribe?token=abc';
      const result = service.compileHtml(html, {}, unsubUrl);

      expect(result).toContain(unsubUrl);
      // Ensure only one occurrence of the link
      expect(result.split(unsubUrl).length - 1).toBe(1);
    });
  });

  describe('compileText', () => {
    it('strips HTML tags and appends plaintext unsubscribe link', () => {
      const html = '<h1>Welcome</h1><p>Visit us today.</p>';
      const unsubUrl =
        'https://aglakaam.app/api/marketing/unsubscribe?token=abc';
      const result = service.compileText(undefined, html, {}, unsubUrl);

      expect(result).toContain('Welcome Visit us today.');
      expect(result).toContain(
        `To unsubscribe from marketing emails, visit: ${unsubUrl}`,
      );
    });
  });
});
