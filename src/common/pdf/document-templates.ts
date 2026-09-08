import { SubscriptionTier, tierHasInvoicing } from '../constants/subscription-options';
import {
  DocumentPalette,
  buildPalette,
  normalizeHex,
} from './document-colors';

// Shared by invoice and quotation PDFs (and their in-app preview) — one
// template choice applies to both document types for a business.
//
// A template is a LAYOUT, not a palette. These five ids are deliberately
// unchanged from the original colour-swap set so every business's stored
// `invoiceTemplateId` keeps working with no migration — but what each one
// now selects is a structurally different document (see DocumentLayoutId),
// and the colour is a separate, independently chosen accent.
export const DOCUMENT_TEMPLATE_IDS = ['classic', 'modern', 'minimal', 'bold', 'compact'] as const;
export type DocumentTemplateId = (typeof DOCUMENT_TEMPLATE_IDS)[number];

export const DEFAULT_DOCUMENT_TEMPLATE_ID: DocumentTemplateId = 'classic';

// The five archetypes. Each is a genuinely different document — header
// position and treatment, how the billing parties are arranged, how the item
// table is ruled, and where the totals sit all differ. None of them is
// another one with a different hex.
export const DOCUMENT_LAYOUT_IDS = [
  'banded',
  'sidebar',
  'letterhead',
  'formal',
  'dense',
] as const;
export type DocumentLayoutId = (typeof DOCUMENT_LAYOUT_IDS)[number];

// Kept as an alias of DocumentPalette so the many `theme.colors.*` reads in
// the renderer keep type-checking unchanged.
export type DocumentTemplateColors = DocumentPalette;

export interface DocumentTemplateTheme {
  id: DocumentTemplateId;
  name: string;
  description: string;
  layout: DocumentLayoutId;
  colors: DocumentTemplateColors;
  // The accent this theme actually resolved to — the business's chosen
  // colour when set, otherwise the layout's default. Surfaced so the
  // template picker can show the swatch that will really be used.
  accent: string;
  // Whether `accent` came from the business's own choice rather than the
  // layout default.
  accentIsCustom: boolean;
  // Multiplies font sizes and row heights uniformly. Only 'dense' moves this
  // off 1 — the other layouts differ structurally, not by scale.
  fontScale: number;
}

interface DocumentTemplateDefinition {
  id: DocumentTemplateId;
  name: string;
  description: string;
  layout: DocumentLayoutId;
  defaultAccent: string;
  fontScale: number;
}

const TEMPLATE_DEFINITIONS: Record<DocumentTemplateId, DocumentTemplateDefinition> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description:
      'The reliable everyday invoice. Colour header, billing details side by side, numbered item table, and payment details next to the totals. Free on every plan.',
    layout: 'banded',
    defaultAccent: '#0F6E56',
    fontScale: 1,
  },
  modern: {
    id: 'modern',
    name: 'Modern',
    description:
      'A brand sidebar carries your details and how to pay you, leaving a clean, lightly ruled table and a bold total bar. For businesses that want to look premium.',
    layout: 'sidebar',
    defaultAccent: '#2952CC',
    fontScale: 1,
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description:
      'Letterhead style — no colour blocks, no boxes. Your name set large, hairline rules, and a lot of white space. For businesses that prefer understatement.',
    layout: 'letterhead',
    defaultAccent: '#2C2C2A',
    fontScale: 1,
  },
  bold: {
    id: 'bold',
    name: 'Formal',
    description:
      'Corporate tax invoice: Bill From and Bill To boxes, a ruled detail grid, per-line tax, and the amount in words. Built for invoicing another company.',
    layout: 'formal',
    defaultAccent: '#C1421A',
    fontScale: 1,
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    description:
      'For field work. A slim header, then customer, service address and technician across the top, a dense item table, and service dates plus payment status at the foot. Fits a job on one page.',
    layout: 'dense',
    defaultAccent: '#146356',
    fontScale: 0.9,
  },
};

function definitionFor(templateId: DocumentTemplateId | undefined | null): DocumentTemplateDefinition {
  return (
    TEMPLATE_DEFINITIONS[templateId as DocumentTemplateId] ??
    TEMPLATE_DEFINITIONS[DEFAULT_DOCUMENT_TEMPLATE_ID]
  );
}

// Resolves a template id plus the business's chosen accent into the theme the
// renderer draws with. Every colour token is derived from the accent (see
// document-colors.ts) rather than hard-coded per template, which is what lets
// any layout be used in any colour.
export function resolveDocumentTheme(
  templateId: DocumentTemplateId | undefined | null,
  accentColor?: string | null,
): DocumentTemplateTheme {
  const definition = definitionFor(templateId);
  const customAccent = normalizeHex(accentColor);
  const accent = customAccent ?? definition.defaultAccent;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    layout: definition.layout,
    colors: buildPalette(accent),
    accent,
    accentIsCustom: customAccent !== null,
    fontScale: definition.fontScale,
  };
}

// Back-compat entry point for callers that have no accent to pass — resolves
// the template with its own default accent.
export function getDocumentTemplate(
  templateId: DocumentTemplateId | undefined | null,
): DocumentTemplateTheme {
  return resolveDocumentTheme(templateId, null);
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

// A custom accent colour is a paid capability on every layout, including the
// free Classic one — picking your own brand colour is the upgrade, having a
// professional-looking document is not.
export function isCustomAccentUnlocked(tier: SubscriptionTier | null): boolean {
  return tierHasInvoicing(tier);
}

export function listDocumentTemplatesForTier(
  tier: SubscriptionTier | null,
  accentColor?: string | null,
) {
  return DOCUMENT_TEMPLATE_IDS.map((id) => {
    const theme = resolveDocumentTheme(id, accentColor);
    return {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      layout: theme.layout,
      // The resolved palette travels with the listing so the in-app mockup
      // renders from exactly the same colours the PDF will use, instead of
      // keeping its own copy that drifts.
      colors: theme.colors,
      accent: theme.accent,
      accentIsCustom: theme.accentIsCustom,
      defaultAccent: TEMPLATE_DEFINITIONS[id].defaultAccent,
      fontScale: theme.fontScale,
      locked: !isDocumentTemplateUnlocked(id, tier),
    };
  });
}

// Suggested swatches for the colour picker — spread across the hue circle so
// the row reads as a real choice, and each one already contrast-safe as a
// document accent.
export const ACCENT_PRESETS = [
  '#0F6E56',
  '#146356',
  '#2952CC',
  '#3F51B5',
  '#0E7490',
  '#7C3AED',
  '#BE185D',
  '#C1421A',
  '#B45309',
  '#4D7C0F',
  '#334155',
  '#2C2C2A',
] as const;
