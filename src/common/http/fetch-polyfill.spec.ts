import { installFetchPolyfill } from './fetch-polyfill';

// The bug this guards against was invisible in CI and fatal in production:
// the deployed server runs Node 16, where `fetch` is not a global, so every
// outbound call threw "fetch is not defined" — breaking the admin broadcast,
// the reminder push dispatch, and Apple purchase verification.
describe('installFetchPolyfill', () => {
  const original = (globalThis as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = original;
  });

  it('installs a fetch when the runtime has none (Node < 18)', () => {
    delete (globalThis as { fetch?: unknown }).fetch;
    expect(typeof (globalThis as { fetch?: unknown }).fetch).toBe('undefined');

    installFetchPolyfill();

    expect(typeof (globalThis as { fetch?: unknown }).fetch).toBe('function');
  });

  it('leaves the native implementation alone on Node >= 18', () => {
    // Replacing a working native fetch with a partial shim would be a
    // regression — the shim only covers what this codebase uses.
    const native = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = native;

    installFetchPolyfill();

    expect((globalThis as { fetch?: unknown }).fetch).toBe(native);
  });

  it('is safe to call more than once', () => {
    delete (globalThis as { fetch?: unknown }).fetch;
    installFetchPolyfill();
    const first = (globalThis as { fetch?: unknown }).fetch;
    installFetchPolyfill();
    expect((globalThis as { fetch?: unknown }).fetch).toBe(first);
  });
});
