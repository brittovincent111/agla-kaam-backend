import { Injectable } from '@nestjs/common';

export interface LeadTemplateContext {
  name?: string;
  businessName?: string;
  displayName?: string;
  city?: string;
  state?: string;
  category?: string;
  area?: string;
  email?: string;
  phone?: string;
  unsubscribeUrl?: string;
}

@Injectable()
export class TemplateEngineService {
  /**
   * Safe string interpolation using known Lead model properties.
   * Prevents code evaluation, prototype pollution, or unsafe template executions.
   */
  render(content: string, context: LeadTemplateContext): string {
    if (!content) return '';

    const defaultName =
      context.name ||
      context.businessName ||
      context.displayName ||
      'Business Owner';
    const city = context.city || '';
    const state = context.state || '';
    const category = context.category || '';
    const area = context.area || '';
    const email = context.email || '';
    const phone = context.phone || '';
    const unsubscribeUrl = context.unsubscribeUrl || '#';

    const replacements: Record<string, string> = {
      name: defaultName,
      businessName: context.businessName || defaultName,
      displayName: context.displayName || defaultName,
      city,
      state,
      category,
      area,
      email,
      phone,
      unsubscribeUrl,
    };

    return content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(replacements, key)) {
        return replacements[key];
      }
      return match; // Keep unresolved tokens as is
    });
  }

  /**
   * Compiles HTML content with variable substitution and guarantees an unsubscribe link.
   */
  compileHtml(
    htmlTemplate: string,
    context: LeadTemplateContext,
    unsubscribeUrl: string,
  ): string {
    const rendered = this.render(htmlTemplate, {
      ...context,
      unsubscribeUrl,
    });

    // If the template author already placed {{unsubscribeUrl}}, we don't need a duplicate footer
    if (
      htmlTemplate.includes('{{unsubscribeUrl}}') ||
      rendered.includes(unsubscribeUrl)
    ) {
      return rendered;
    }

    // Otherwise, append a standard compliant unsubscribe footer
    const footer = `
<div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: #6b7280; text-align: center; line-height: 18px;">
  <p style="margin: 0 0 8px 0;">You received this email because your business was selected for Agla Kaam product updates.</p>
  <p style="margin: 0;">If you no longer wish to receive these emails, you can <a href="${unsubscribeUrl}" style="color: #2563eb; text-decoration: underline;">unsubscribe here</a>.</p>
</div>`;

    if (rendered.includes('</body>')) {
      return rendered.replace('</body>', `${footer}</body>`);
    }

    return `${rendered}\n${footer}`;
  }

  /**
   * Compiles plain-text content with variable substitution and unsubscribe URL.
   */
  compileText(
    textTemplate: string | undefined,
    htmlContent: string,
    context: LeadTemplateContext,
    unsubscribeUrl: string,
  ): string {
    let source = textTemplate;
    if (!source) {
      source = htmlContent
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const rendered = this.render(source, {
      ...context,
      unsubscribeUrl,
    });

    if (rendered.includes(unsubscribeUrl)) {
      return rendered;
    }

    return `${rendered}\n\n---\nTo unsubscribe from marketing emails, visit: ${unsubscribeUrl}`;
  }
}
