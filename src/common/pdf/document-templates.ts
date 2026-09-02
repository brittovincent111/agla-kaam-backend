import { SubscriptionTier, tierHasInvoicing } from '../constants/subscription-options';

// Shared by invoice and quotation PDFs (and their in-app preview) — one
// template choice applies to both document types for a business.
export const DOCUMENT_TEMPLATE_IDS = ['classic', 'modern', 'minimal', 'bold', 'compact'] as const;
export type DocumentTemplateId = (typeof DOCUMENT_TEMPLATE_IDS)[number];

export const DEFAULT_DOCUMENT_TEMPLATE_ID: DocumentTemplateId = 'classic';

export interface DocumentTemplateColors {
  primary: string;
  onPrimary: string;
  primaryTint: string;
  tintBg: string;
  tintText: string;
  urgencyText: string;
  urgencyBg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  dangerText: string;
  dangerBg: string;
  stripe: string;
}

export interface DocumentTemplateTheme {
  id: DocumentTemplateId;
  name: string;
  description: string;
  colors: DocumentTemplateColors;
  // 'band': the current default — a filled color header block with white text.
  // 'line': no color fill — white header, dark text, colored bottom rule and
  // monogram outline instead. Reads as a more understated/minimal document.
  headerStyle: 'band' | 'line';
  // Multiplies font sizes and row heights uniformly — the one knob 'compact'
  // uses to fit more line items per page without a separate layout pass.
  fontScale: number;
}

// Base (non-color) palette shared by every template except where a template
// overrides a specific token below.
const BASE_COLORS: DocumentTemplateColors = {
  primary: '#0F6E56',
  onPrimary: '#FFFFFF',
  primaryTint: '#CDEDE1',
  tintBg: '#E1F5EE',
  tintText: '#0F6E56',
  urgencyText: '#D85A30',
  urgencyBg: '#FAECE7',
  text: '#2C2C2A',
  textSecondary: '#5F5E5A',
  textMuted: '#888780',
  border: '#E4E2DD',
  dangerText: '#A32D2D',
  dangerBg: '#FCEBEB',
  stripe: '#FAFAF9',
};

export const DOCUMENT_TEMPLATES: Record<DocumentTemplateId, DocumentTemplateTheme> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'The original look — teal header, clean and familiar. Free on every plan.',
    colors: BASE_COLORS,
    headerStyle: 'band',
    fontScale: 1,
  },
  modern: {
    id: 'modern',
    name: 'Modern',
    description: 'A bolder indigo header with a larger business name for a punchier first impression.',
    colors: {
      ...BASE_COLORS,
      primary: '#2952CC',
      primaryTint: '#D3DDF8',
      tintBg: '#E8ECFB',
      tintText: '#2952CC',
    },
    headerStyle: 'band',
    fontScale: 1,
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'No color block — just a clean white header and dark type, for a understated, paper-like feel.',
    colors: {
      ...BASE_COLORS,
      primary: '#2C2C2A',
      primaryTint: '#5F5E5A',
      tintBg: '#F1F0EE',
      tintText: '#2C2C2A',
      stripe: '#F7F6F4',
    },
    headerStyle: 'line',
    fontScale: 1,
  },
  bold: {
    id: 'bold',
    name: 'Bold',
    description: 'A warm burnt-orange header and heavier totals — stands out when printed or forwarded.',
    colors: {
      ...BASE_COLORS,
      primary: '#C1421A',
      primaryTint: '#F3D2C3',
      tintBg: '#FBEAE1',
      tintText: '#C1421A',
    },
    headerStyle: 'band',
    fontScale: 1,
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter spacing and smaller type so long item lists fit on fewer pages.',
    colors: {
      ...BASE_COLORS,
      primary: '#146356',
      tintBg: '#E1F5EE',
      tintText: '#146356',
    },
    headerStyle: 'band',
    fontScale: 0.88,
  },
};

export function getDocumentTemplate(templateId: DocumentTemplateId | undefined | null): DocumentTemplateTheme {
  return DOCUMENT_TEMPLATES[templateId ?? DEFAULT_DOCUMENT_TEMPLATE_ID] ?? DOCUMENT_TEMPLATES[DEFAULT_DOCUMENT_TEMPLATE_ID];
}

// Every plan can use the default template; the other four require an active
// Invoicing/Combo subscription — mirrors tierAllowsTeam's gating pattern in
// subscription-options.ts.
export function isDocumentTemplateUnlocked(
  templateId: DocumentTemplateId,
  tier: SubscriptionTier | null,
): boolean {
  if (templateId === DEFAULT_DOCUMENT_TEMPLATE_ID) return true;
  return tierHasInvoicing(tier);
}

export function listDocumentTemplatesForTier(tier: SubscriptionTier | null) {
  return DOCUMENT_TEMPLATE_IDS.map((id) => {
    const theme = DOCUMENT_TEMPLATES[id];
    return {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      locked: !isDocumentTemplateUnlocked(id, tier),
    };
  });
}
