/**
 * Comparing app version strings.
 *
 * Deliberately not a string comparison: '1.0.10' < '1.0.9' lexicographically,
 * so the first double-digit patch release would start treating every
 * up-to-date user as out of date. Deliberately not the `semver` package
 * either — this needs three integers compared, not a dependency.
 */

/** -1 when a < b, 0 when equal, 1 when a > b. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    String(v ?? '')
      .trim()
      // Drops any build/prerelease suffix: '1.2.3-beta.1' compares as 1.2.3.
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      });

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** True when `version` is older than `floor`. Equal is NOT older. */
export function isOlderThan(version: string, floor: string): boolean {
  return compareVersions(version, floor) < 0;
}

/** A version string we are willing to act on at all. */
export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d+){0,3}([-+].*)?$/.test(value.trim());
}
