import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHarness, type Harness } from './test-support/harness.js';
import { isLoopbackPeer, peerCheck } from './security/guards.js';
import { Lockout } from './security/lockout.js';
import { SessionStore } from './security/sessions.js';
import { constantTimeEqual, generateToken } from './security/token.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('token, sessions, lockout', () => {
  it('generates a 256-bit hex token from the random source', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(generateToken());
  });

  it('compares in constant time over equal-length digests', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('forgets every session on clear (restart)', () => {
    const s = new SessionStore();
    const id = s.create();
    expect(s.has(id)).toBe(true);
    s.clear();
    expect(s.has(id)).toBe(false);
  });

  it('locks out after maxFailures within the window, then recovers', () => {
    let now = 0;
    const l = new Lockout({ maxFailures: 3, windowMs: 1000, blockMs: 5000 }, () => now);
    l.fail();
    l.fail();
    expect(l.blocked()).toBeUndefined();
    l.fail();
    expect(l.blocked()).toBe(5);
    now = 5001;
    expect(l.blocked()).toBeUndefined();
  });

  it('does not count failures that fall outside the window', () => {
    let now = 0;
    const l = new Lockout({ maxFailures: 2, windowMs: 1000, blockMs: 5000 }, () => now);
    l.fail();
    now = 2000;
    l.fail();
    expect(l.blocked()).toBeUndefined();
  });
});

describe('Property 1: Loopback only', () => {
  // Feature: web-shell, Property 1: Loopback only
  it('binds to 127.0.0.1 for any accepted configuration', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          openBrowser: fc.boolean(),
          maxBodyBytes: fc.integer({ min: 1024, max: 1_000_000 }),
          lockout: fc.record({
            maxFailures: fc.integer({ min: 1, max: 20 }),
            windowMs: fc.integer({ min: 1, max: 100_000 }),
            blockMs: fc.integer({ min: 1, max: 100_000 }),
          }),
        }),
        async (cfg) => {
          const harness = await startHarness(cfg);
          try {
            expect(new URL(harness.server.launchUrl).hostname).toBe('127.0.0.1');
            const res = await harness.request({ path: '/api/state' });
            expect(res.status).toBe(200);
          } finally {
            await harness.close();
          }
        },
      ),
      { numRuns: 8 },
    );
  });

  it('closes a non-loopback peer without writing a response', () => {
    const destroy = vi.fn();
    const next = vi.fn();
    const res = { write: vi.fn(), end: vi.fn(), status: vi.fn(), setHeader: vi.fn() };
    for (const address of ['10.0.0.5', '192.168.1.2', '::1', '::ffff:10.0.0.5', undefined]) {
      peerCheck()({ socket: { remoteAddress: address, destroy } } as never, res as never, next);
    }
    expect(destroy).toHaveBeenCalledTimes(5);
    expect(next).not.toHaveBeenCalled();
    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts the two loopback forms', () => {
    expect(isLoopbackPeer('127.0.0.1')).toBe(true);
    expect(isLoopbackPeer('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackPeer('::1')).toBe(false);
  });
});

describe('Property 2: Credential required', () => {
  // Feature: web-shell, Property 2: Credential required
  it('answers 401 with an empty body for every route without a credential', async () => {
    h = await startHarness();
    const paths = ['/', '/api/state', '/api/views/journal', '/api/saves', '/api/frames/' + 'a'.repeat(64), '/audio/City.mp3', '/art/box-wide.jpg', '/api/events', '/static/app.css', '/nowhere'];
    for (const path of paths) {
      const res = await h.request({ path, auth: false });
      expect(res.status, path).toBe(401);
      expect(res.text, path).toBe('');
    }
    expect(h.engine.calls).toEqual([]);
  });

  it('refuses unauthenticated POSTs and leaves the game untouched', async () => {
    h = await startHarness();
    const res = await h.request({ method: 'POST', path: '/api/act', body: { ref: '1.0.aaaaaaaaaa' }, auth: false, headers: { origin: h.origin } });
    expect(res.status).toBe(401);
    expect(h.engine.calls).toEqual([]);
  });

  it('accepts the bearer token for scripts and evals', async () => {
    h = await startHarness();
    const token = new URL(h.server.launchUrl).searchParams.get('token') as string;
    const res = await h.request({ path: '/api/state', auth: false, headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it('does not accept the token in a query string on any other route', async () => {
    h = await startHarness();
    const token = new URL(h.server.launchUrl).searchParams.get('token') as string;
    const res = await h.request({ path: `/api/state?token=${token}`, auth: false });
    expect(res.status).toBe(401);
  });

  it('launch sets an HttpOnly, SameSite=Strict cookie and a meta-refresh page without the token', async () => {
    h = await startHarness();
    const token = new URL(h.server.launchUrl).searchParams.get('token') as string;
    const res = await h.request({ path: `/launch?token=${token}`, auth: false });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^tc_session=[0-9a-f]{32}; HttpOnly; SameSite=Strict; Path=\/$/);
    expect(res.text).toContain('http-equiv="refresh"');
    expect(res.text).not.toContain(token);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('refuses a wrong launch token and a forged cookie', async () => {
    h = await startHarness();
    expect((await h.request({ path: '/launch?token=nope', auth: false })).status).toBe(401);
    expect((await h.request({ path: '/launch', auth: false })).status).toBe(401);
    const res = await h.request({ path: '/api/state', auth: false, headers: { cookie: 'tc_session=deadbeef' } });
    expect(res.status).toBe(401);
  });

  it('locks out after repeated wrong credentials with Retry-After', async () => {
    h = await startHarness({ lockout: { maxFailures: 3, windowMs: 60_000, blockMs: 30_000 } });
    for (let i = 0; i < 3; i += 1) {
      await h.request({ path: '/api/state', auth: false, headers: { cookie: 'tc_session=wrong' } });
    }
    const res = await h.request({ path: '/api/state' });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('Property 3: Cross-origin state change refused', () => {
  // Feature: web-shell, Property 3: Cross-origin state change refused
  it('refuses a bad Host with 421 on every route', async () => {
    h = await startHarness();
    for (const host of ['evil.example', 'evil.example:1', '127.0.0.1', `127.0.0.1:${h.port + 1}`, `localhost.evil.example:${h.port}`]) {
      const res = await h.request({ path: '/api/state', headers: { host } });
      expect(res.status, host).toBe(421);
    }
    const ok = await h.request({ path: '/api/state', headers: { host: `localhost:${h.port}` } });
    expect(ok.status).toBe(200);
  });

  it('refuses a POST whose Origin is absent or foreign, whatever the credentials', async () => {
    h = await startHarness();
    const body = { ref: '1.0.aaaaaaaaaa' };
    const cases: Array<string | undefined> = [undefined, 'null', 'http://evil.example', `http://127.0.0.1:${h.port + 1}`, `https://127.0.0.1:${h.port}`, `http://127.0.0.1.evil.example:${h.port}`];
    for (const origin of cases) {
      const res = await h.request({ method: 'POST', path: '/api/act', body, headers: { origin } });
      expect(res.status, String(origin)).toBe(403);
    }
    expect(h.engine.calls).toEqual([]);
  });

  it('refuses a POST with Sec-Fetch-Site other than same-origin', async () => {
    h = await startHarness();
    for (const site of ['cross-site', 'same-site', 'none']) {
      const res = await h.request({ method: 'POST', path: '/api/act', body: { ref: 'x' }, headers: { 'sec-fetch-site': site } });
      expect(res.status, site).toBe(403);
    }
  });

  it('answers a cross-origin preflight with 403 and no CORS headers', async () => {
    h = await startHarness();
    const res = await h.request({ method: 'OPTIONS', path: '/api/act', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requires application/json on a request with a body', async () => {
    h = await startHarness();
    const res = await h.request({ method: 'POST', path: '/api/act', rawBody: 'ref=1', headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(400);
  });

  it('enforces the body size limit', async () => {
    h = await startHarness({ maxBodyBytes: 1024 });
    const res = await h.request({ method: 'POST', path: '/api/say', body: { line: 'x'.repeat(5000) } });
    expect(res.status).toBe(413);
    expect((res.json().error as { code: string }).code).toBe('too-large');
  });

  it('sets CSP, nosniff, referrer, framing and no-store headers; never CORS', async () => {
    h = await startHarness();
    const res = await h.request({ path: '/api/state' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
