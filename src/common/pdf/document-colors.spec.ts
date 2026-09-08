import { buildPalette, normalizeHex, onAccentColor } from './document-colors';
import {
  ACCENT_PRESETS,
  DOCUMENT_TEMPLATE_IDS,
  resolveDocumentTheme,
} from './document-templates';

// The whole point of deriving a palette instead of hard-coding one per
// template is that ANY accent a business picks has to stay readable. These
// cover the cases a fixed palette never had to handle: very light accents,
// very dark ones, and the tokens that are drawn as text on top of the accent.

function toRgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

describe('normalizeHex', () => {
  it('accepts 6-digit, 3-digit, and un-prefixed hex', () => {
    expect(normalizeHex('#2952cc')).toBe('#2952CC');
    expect(normalizeHex('2952CC')).toBe('#2952CC');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
  });

  it('rejects anything that is not a hex colour', () => {
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('onAccentColor', () => {
  it('uses white on a dark accent and near-black on a light one', () => {
    expect(onAccentColor('#0F6E56')).toBe('#FFFFFF');
    expect(onAccentColor('#2C2C2A')).toBe('#FFFFFF');
    // A mid-yellow with white text is the case that used to be unreadable.
    expect(onAccentColor('#F5C518')).not.toBe('#FFFFFF');
  });
});

describe('buildPalette', () => {
  // Every accent a business could plausibly pick, including deliberately
  // awkward ones at both ends of the luminance range.
  const accents = [
    ...ACCENT_PRESETS,
    '#F5C518', // bright yellow
    '#FFFFFF', // white
    '#000000', // black
    '#00E5FF', // saturated cyan
    '#FFB6C1', // pale pink
  ];

  it.each(accents)('keeps text on the accent readable for %s', (accent) => {
    const palette = buildPalette(accent);
    // Primary text on the band must clear WCAG AA for large text.
    expect(contrast(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(3);
    // Secondary text on the band has to separate from it too — this is the
    // token that was yellow-on-yellow when it always lightened.
    expect(contrast(palette.onPrimaryMuted, palette.primary)).toBeGreaterThanOrEqual(1.8);
  });

  it.each(accents)('keeps the accent readable as text on white for %s', (accent) => {
    const palette = buildPalette(accent);
    expect(contrast(palette.primaryInk, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(accents)('keeps tinted text readable on its own tint for %s', (accent) => {
    const palette = buildPalette(accent);
    expect(contrast(palette.tintText, palette.tintBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves the neutral signal colours alone whatever the accent', () => {
    const teal = buildPalette('#0F6E56');
    const pink = buildPalette('#BE185D');
    // An "overdue" invoice has to look overdue in every brand colour.
    expect(teal.dangerText).toBe(pink.dangerText);
    expect(teal.urgencyText).toBe(pink.urgencyText);
    expect(teal.text).toBe(pink.text);
  });
});

describe('resolveDocumentTheme', () => {
  it('gives every template a distinct layout', () => {
    const layouts = DOCUMENT_TEMPLATE_IDS.map(
      (id) => resolveDocumentTheme(id, null).layout,
    );
    expect(new Set(layouts).size).toBe(DOCUMENT_TEMPLATE_IDS.length);
  });

  it('falls back to the layout default when no accent is set', () => {
    const theme = resolveDocumentTheme('modern', null);
    expect(theme.accent).toBe('#2952CC');
    expect(theme.accentIsCustom).toBe(false);
  });

  it('applies a custom accent to any layout', () => {
    for (const id of DOCUMENT_TEMPLATE_IDS) {
      const theme = resolveDocumentTheme(id, '#7C3AED');
      expect(theme.accent).toBe('#7C3AED');
      expect(theme.accentIsCustom).toBe(true);
      expect(theme.colors.primary).toBe('#7C3AED');
    }
  });

  it('ignores an unusable accent rather than rendering a broken document', () => {
    const theme = resolveDocumentTheme('classic', 'not-a-colour');
    expect(theme.accent).toBe('#0F6E56');
    expect(theme.accentIsCustom).toBe(false);
  });

  it('falls back to the default template for an unknown id', () => {
    const theme = resolveDocumentTheme('nonsense' as never, null);
    expect(theme.id).toBe('classic');
    expect(theme.layout).toBe('banded');
  });
});
