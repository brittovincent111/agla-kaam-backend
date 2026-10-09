import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/** A refusal from the Cloud API, with Meta's error code kept for decisions. */
export class WhatsappApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface WhatsappTemplateSummary {
  name: string;
  language: string;
  status: string;
  category: string;
  // How many {{n}} variables the body has, and whether the header is an image.
  bodyVariables: number;
  headerFormat?: string;
  bodyText?: string;
}

/**
 * Talks to the WhatsApp Cloud API for the business number.
 *
 * Configured from the environment:
 *   WHATSAPP_ACCESS_TOKEN     permanent System User token (whatsapp_business_messaging,
 *                             whatsapp_business_management)
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (1131160980085092)
 *   WHATSAPP_WABA_ID          the WhatsApp Business Account id, to list templates
 *   WHATSAPP_APP_SECRET       Meta app secret, to verify webhook signatures
 *   WHATSAPP_GRAPH_VERSION    default v23.0
 *   WHATSAPP_OVERRIDE_TO      testing: every send goes to this number instead
 */
@Injectable()
export class WhatsappCloudService {
  private readonly logger = new Logger(WhatsappCloudService.name);

  constructor(private readonly config: ConfigService) {}

  private get token(): string | undefined {
    return this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim() || undefined;
  }
  get phoneNumberId(): string | undefined {
    return this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim() || undefined;
  }
  private get wabaId(): string | undefined {
    return this.config.get<string>('WHATSAPP_WABA_ID')?.trim() || undefined;
  }
  private get base(): string {
    const root = (this.config.get<string>('WHATSAPP_GRAPH_BASE_URL') || 'https://graph.facebook.com').replace(/\/+$/, '');
    const version = this.config.get<string>('WHATSAPP_GRAPH_VERSION') || 'v23.0';
    return `${root}/${version}`;
  }
  get overrideTo(): string | undefined {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      return undefined;
    }
    const v = this.config.get<string>('WHATSAPP_OVERRIDE_TO')?.replace(/\D/g, '');
    return v || undefined;
  }

  isConfigured(): boolean {
    return !!this.token && !!this.phoneNumberId;
  }

  private async graph<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new WhatsappApiError('WHATSAPP_ACCESS_TOKEN is not set.');
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || json?.error) {
      const err = json?.error ?? {};
      const detail = err.error_data?.details ? ` (${err.error_data.details})` : '';
      throw new WhatsappApiError(
        `${err.message || `WhatsApp API error ${res.status}`}${detail}`,
        typeof err.code === 'number' ? err.code : undefined,
        res.status,
      );
    }
    return json as T;
  }

  private destination(to: string): string {
    const digits = to.replace(/\D/g, '');
    const override = this.overrideTo;
    if (override && override !== digits) {
      this.logger.debug(`[WHATSAPP_OVERRIDE] ${digits} → ${override}`);
      return override;
    }
    return digits;
  }

  /** Sends an approved template. Returns Meta's message id (wamid). */
  async sendTemplate(input: {
    to: string;
    templateName: string;
    languageCode: string;
    bodyParams?: string[];
    headerImageUrl?: string;
  }): Promise<string> {
    if (!this.phoneNumberId) throw new WhatsappApiError('WHATSAPP_PHONE_NUMBER_ID is not set.');
    const components: unknown[] = [];
    if (input.headerImageUrl) {
      components.push({ type: 'header', parameters: [{ type: 'image', image: { link: input.headerImageUrl } }] });
    }
    if (input.bodyParams?.length) {
      components.push({
        type: 'body',
        parameters: input.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }
    const res = await this.graph<{ messages?: { id: string }[] }>('POST', `/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: this.destination(input.to),
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        ...(components.length ? { components } : {}),
      },
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new WhatsappApiError('WhatsApp accepted the request but returned no message id.');
    return id;
  }

  /** Free-form text — only allowed within 24 hours of the person's last message. */
  async sendText(to: string, text: string): Promise<string> {
    if (!this.phoneNumberId) throw new WhatsappApiError('WHATSAPP_PHONE_NUMBER_ID is not set.');
    const res = await this.graph<{ messages?: { id: string }[] }>('POST', `/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: this.destination(to),
      type: 'text',
      text: { body: text, preview_url: true },
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new WhatsappApiError('WhatsApp accepted the request but returned no message id.');
    return id;
  }

  /**
   * A message with up to three tap buttons (titles at most 20 characters).
   * Inside the 24-hour window only, like sendText; a tap comes back as an
   * interactive button_reply carrying the button's id.
   */
  async sendButtons(to: string, body: string, buttons: { id: string; title: string }[]): Promise<string> {
    if (!this.phoneNumberId) throw new WhatsappApiError('WHATSAPP_PHONE_NUMBER_ID is not set.');
    const res = await this.graph<{ messages?: { id: string }[] }>('POST', `/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: this.destination(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new WhatsappApiError('WhatsApp accepted the request but returned no message id.');
    return id;
  }

  /** A message with one link button ("Download app" → url). 24-hour window only. */
  async sendLinkButton(to: string, body: string, label: string, url: string): Promise<string> {
    if (!this.phoneNumberId) throw new WhatsappApiError('WHATSAPP_PHONE_NUMBER_ID is not set.');
    const res = await this.graph<{ messages?: { id: string }[] }>('POST', `/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: this.destination(to),
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: body },
        action: { name: 'cta_url', parameters: { display_text: label.slice(0, 20), url } },
      },
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new WhatsappApiError('WhatsApp accepted the request but returned no message id.');
    return id;
  }

  /**
   * Meta's view of the sending number: quality rating (GREEN / YELLOW / RED)
   * and messaging tier (how many people a day it may start conversations with).
   */
  async phoneHealth(): Promise<{ qualityRating?: string; messagingLimitTier?: string; dailyCap?: number }> {
    if (!this.phoneNumberId) throw new WhatsappApiError('WHATSAPP_PHONE_NUMBER_ID is not set.');
    const res = await this.graph<{ quality_rating?: string; messaging_limit_tier?: string }>(
      'GET',
      `/${this.phoneNumberId}?fields=quality_rating,messaging_limit_tier`,
    );
    const tiers: Record<string, number> = {
      TIER_50: 50,
      TIER_250: 250,
      TIER_1K: 1000,
      TIER_10K: 10000,
      TIER_100K: 100000,
      TIER_UNLIMITED: Number.MAX_SAFE_INTEGER,
    };
    return {
      qualityRating: res.quality_rating,
      messagingLimitTier: res.messaging_limit_tier,
      dailyCap: res.messaging_limit_tier ? tiers[res.messaging_limit_tier] : undefined,
    };
  }

  /** The templates in WhatsApp Manager, with how many body variables each needs. */
  async listTemplates(): Promise<WhatsappTemplateSummary[]> {
    if (!this.wabaId) throw new WhatsappApiError('WHATSAPP_WABA_ID is not set — needed to list templates.');
    const res = await this.graph<{ data: any[] }>(
      'GET',
      `/${this.wabaId}/message_templates?fields=name,status,category,language,components&limit=200`,
    );
    return (res.data ?? []).map((t) => {
      const body = (t.components ?? []).find((c: any) => c.type === 'BODY');
      const header = (t.components ?? []).find((c: any) => c.type === 'HEADER');
      const vars = new Set<string>((body?.text ?? '').match(/\{\{\s*\d+\s*\}\}/g) ?? []);
      return {
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        bodyVariables: vars.size,
        headerFormat: header?.format,
        bodyText: body?.text,
      };
    });
  }

  /**
   * Meta signs every webhook with the app secret (X-Hub-Signature-256).
   * Without a secret configured nothing is trusted outside development.
   */
  verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET')?.trim();
    if (!secret) {
      return this.config.get<string>('NODE_ENV') !== 'production';
    }
    if (!rawBody || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = Buffer.from(header.slice('sha256='.length), 'hex');
    const want = Buffer.from(expected, 'hex');
    return given.length === want.length && timingSafeEqual(given, want);
  }
}
