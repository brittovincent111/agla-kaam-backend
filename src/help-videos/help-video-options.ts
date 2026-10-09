/**
 * The screens a help video can be pinned to. 'home' is special on the app
 * side: Home lists the videos of every screen, so it doubles as "all".
 */
export const HELP_VIDEO_SCREENS = [
  'home',
  'services',
  'customers',
  'log_service',
  'invoice',
  'quotation',
  'proforma',
  'purchase',
  'amc',
  'team',
  'inventory',
  'reports',
  'settings',
] as const;
export type HelpVideoScreen = (typeof HELP_VIDEO_SCREENS)[number];

export const HELP_VIDEO_LANGUAGES = ['en', 'hi', 'ml'] as const;
export type HelpVideoLanguage = (typeof HELP_VIDEO_LANGUAGES)[number];

export const HELP_VIDEO_AUDIENCES = ['all', 'owner', 'technician'] as const;
export type HelpVideoAudience = (typeof HELP_VIDEO_AUDIENCES)[number];

export const INVALID_YOUTUBE_LINK = 'Not a valid YouTube link';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Path prefixes whose next segment is the video id. */
const ID_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v']);

/**
 * The 11-character video id from whatever the admin pasted: a bare id, or a
 * watch?v= / youtu.be / shorts / embed link (with or without the scheme and
 * any extra params like &t=30s or ?si=...). null for anything else, so a
 * typo never reaches the app as a broken player.
 */
/** True for a youtube.com/shorts/… link — those play tall (9:16) in the app. */
export function isShortsLink(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  return /(^|[/.])youtube\.com\/shorts\//i.test(input.trim());
}

export function parseYoutubeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (YOUTUBE_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | null | undefined;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') {
      candidate = url.searchParams.get('v');
    } else if (segments.length >= 2 && ID_PATH_PREFIXES.has(segments[0])) {
      candidate = segments[1];
    }
  }

  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

/**
 * Which audiences a signed-in role sees: a technician gets the field how-tos,
 * an owner or a manager (who both run the business side) the owner ones.
 */
export function audiencesFor(role: string | undefined): HelpVideoAudience[] {
  return role === 'technician' ? ['all', 'technician'] : ['all', 'owner'];
}

/** Languages to fetch for a request: the asked-for one, then English. */
export function languagesFor(lang: HelpVideoLanguage): HelpVideoLanguage[] {
  return lang === 'en' ? ['en'] : [lang, 'en'];
}

type Sortable = { language: string; screen: string; order: number };

/**
 * Requested-language videos first, then the English fallback; inside each,
 * screens in their canonical order (only matters on Home) and then the
 * admin's order. Stable, so equal orders keep the query's _id order.
 */
export function sortForViewer<T extends Sortable>(
  videos: T[],
  lang: HelpVideoLanguage,
): T[] {
  const langRank = (v: T) => (v.language === lang ? 0 : 1);
  const screenRank = (v: T) =>
    HELP_VIDEO_SCREENS.indexOf(v.screen as HelpVideoScreen);
  return [...videos].sort(
    (a, b) =>
      langRank(a) - langRank(b) ||
      screenRank(a) - screenRank(b) ||
      a.order - b.order,
  );
}
