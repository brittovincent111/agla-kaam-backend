// Derives a complete document palette from a single accent colour.
//
// Templates used to hard-code every token (primary, tint, tintBg, tintText…)
// per template, which is why five "templates" ended up being five hex swaps
// of one layout: the palette was the only thing a template could vary. Now a
// template chooses a *layout*, and the accent — whichever the business picks,
// or the layout's own default — is expanded here into the tokens the
// renderer needs. One accent in, a readable palette out, for any hex.

export interface DocumentPalette {
  primary: string;
  onPrimary: string;
  // Secondary text ON the accent (a header band's contact line). Must move
  // AWAY from the accent in the same direction onPrimary did: lightened when
  // the accent is dark, darkened when it is light. Lightening unconditionally
  // — which is what primaryTint does — turns a yellow band's contact line
  // into yellow-on-yellow.
  onPrimaryMuted: string;
  // The accent as TEXT ON WHITE (the grand total, an outlined monogram).
  // Darkened until legible, so a pale brand colour stays readable.
  primaryInk: string;
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

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

// Neutral tokens are deliberately NOT derived from the accent: body text,
// rules and the "overdue"/"unpaid" signal colours have to stay legible and
// mean the same thing whatever accent a business picks. Only the accent-
// derived tokens below change.
const NEUTRALS = {
  urgencyText: '#D85A30',
  urgencyBg: '#FAECE7',
  text: '#2C2C2A',
  textSecondary: '#5F5E5A',
  textMuted: '#888780',
  border: '#E4E2DD',
  dangerText: '#A32D2D',
  dangerBg: '#FCEBEB',
  stripe: '#FAFAF9',
} as const;

export function normalizeHex(input: string | undefined | null): string | null {
  if (!input) return null;
  const match = HEX_RE.exec(input.trim());
  if (!match) return null;
  const body = match[1];
  const full =
    body.length === 3
      ? body
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : body;
  return `#${full.toUpperCase()}`;
}

function toRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? '#000000';
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

// Relative luminance, WCAG 2.x definition — used to decide whether text sitting
// on the accent should be white or near-black, and whether an accent is too
// pale to read as body text on a tinted background.
function luminance(rgb: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

// Text drawn directly on the accent (the banded header's business name, the
// sidebar's totals). A mid-yellow accent with white text is unreadable, so
// this picks whichever of white/near-black actually contrasts.
export function onAccentColor(accentHex: string): string {
  const accent = toRgb(accentHex);
  const onWhite = contrastRatio(accent, WHITE);
  const onInk = contrastRatio(accent, toRgb(NEUTRALS.text));
  return onWhite >= onInk ? '#FFFFFF' : NEUTRALS.text;
}

// The accent used as *text* (on white or on its own pale tint) needs to be
// dark enough to read. A pale accent is darkened until it clears 4.5:1
// against its tint background rather than being drawn as-is.
function readableAccentInk(accent: Rgb, background: Rgb): string {
  let candidate = accent;
  for (let step = 0; step < 12; step += 1) {
    if (contrastRatio(candidate, background) >= 4.5) break;
    candidate = mix(candidate, BLACK, 0.12);
  }
  return toHex(candidate);
}

export function buildPalette(accentHex: string): DocumentPalette {
  const accent = toRgb(accentHex);
  const primary = toHex(accent);
  const onPrimary = onAccentColor(primary);

  // Tint ladder: primaryTint is the accent softened enough to read against
  // the accent itself (used for secondary text inside a filled header);
  // tintBg is the very pale wash behind table headers and status pills.
  const primaryTint = toHex(mix(accent, WHITE, 0.62));
  const tintBg = toHex(mix(accent, WHITE, 0.88));
  const tintText = readableAccentInk(accent, toRgb(tintBg));

  return {
    primary,
    onPrimary,
    // Follows onPrimary: toward white over a dark accent, toward black over a
    // light one, so it always separates from the band it sits on.
    onPrimaryMuted:
      onPrimary === '#FFFFFF'
        ? toHex(mix(accent, WHITE, 0.62))
        : toHex(mix(accent, BLACK, 0.45)),
    primaryInk: readableAccentInk(accent, WHITE),
    primaryTint,
    tintBg,
    tintText,
    ...NEUTRALS,
  };
}

// A pale accent on a white header (the letterhead/formal layouts draw the
// business name in the accent directly on white) needs the same treatment as
// tintText, against white instead of the tint.
export function accentOnWhite(accentHex: string): string {
  return readableAccentInk(toRgb(accentHex), WHITE);
}
