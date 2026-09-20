import { compareVersions, isOlderThan, isValidVersion } from './semver';

describe('compareVersions', () => {
  it('orders by numeric part, not lexicographically', () => {
    // The whole reason this exists: '1.0.10' < '1.0.9' as strings.
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBe(-1);
  });

  it('ignores prerelease and build suffixes', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3+build9', '1.2.3')).toBe(0);
  });

  it('is symmetric', () => {
    expect(compareVersions('1.4.0', '1.3.9')).toBe(1);
    expect(compareVersions('1.3.9', '1.4.0')).toBe(-1);
    expect(compareVersions('1.3.9', '1.3.9')).toBe(0);
  });

  it('does not crash on junk', () => {
    expect(compareVersions('', '1.0.0')).toBe(-1);
    expect(compareVersions('abc', '0.0.0')).toBe(0);
  });
});

describe('isOlderThan', () => {
  it('treats an equal version as supported', () => {
    // Blocking on !== rather than < is what locks out users on the newest
    // build whenever the stored value lags behind a release.
    expect(isOlderThan('1.0.0', '1.0.0')).toBe(false);
  });

  it('treats a newer version as supported', () => {
    // TestFlight and store reviewers run ahead of whatever is stored.
    expect(isOlderThan('1.1.0', '1.0.0')).toBe(false);
  });

  it('flags only genuinely older versions', () => {
    expect(isOlderThan('0.9.9', '1.0.0')).toBe(true);
  });
});

describe('isValidVersion', () => {
  it('accepts real version strings and rejects junk', () => {
    expect(isValidVersion('1.0.0')).toBe(true);
    expect(isValidVersion('1.0')).toBe(true);
    expect(isValidVersion('1.2.3-beta.1')).toBe(true);
    expect(isValidVersion('')).toBe(false);
    expect(isValidVersion('latest')).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
  });
});
