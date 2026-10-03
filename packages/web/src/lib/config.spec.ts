import { describe, expect, it } from 'vitest';

import { ShellConfigError, parseShellConfig } from './config.js';

describe('parseShellConfig', () => {
  it('applies documented defaults to an empty document', () => {
    const c = parseShellConfig({});
    expect(c.port).toBe(0);
    expect(c.openBrowser).toBe(false);
    expect(c.lockout).toEqual({ maxFailures: 8, windowMs: 60_000, blockMs: 60_000 });
    expect(c.maxBodyBytes).toBe(65_536);
    expect(c.audioFormats).toEqual(['opus', 'mp3']);
    expect(c.frames.dir).toBe('.cache/frames');
  });

  it('treats an absent file as an empty document', () => {
    expect(parseShellConfig(undefined).port).toBe(0);
  });

  it('rejects a host key, whatever its value (Req 2.2)', () => {
    for (const host of ['0.0.0.0', '127.0.0.1', '::1', 'localhost']) {
      expect(() => parseShellConfig({ host })).toThrow(ShellConfigError);
    }
    try {
      parseShellConfig({ host: '0.0.0.0' });
    } catch (e) {
      expect((e as ShellConfigError).issues[0]).toContain('host');
      expect((e as ShellConfigError).issues[0]).toContain('0.0.0.0');
    }
  });

  it('rejects unknown keys with a located issue', () => {
    expect(() => parseShellConfig({ lockout: { maxFailures: 3, surprise: 1 } })).toThrow(/lockout/);
    expect(() => parseShellConfig({ whatever: 1 })).toThrow(ShellConfigError);
  });

  it('rejects out-of-range values', () => {
    expect(() => parseShellConfig({ port: 70000 })).toThrow(/port/);
    expect(() => parseShellConfig({ audioFormats: [] })).toThrow(/audioFormats/);
    expect(() => parseShellConfig({ audioFormats: ['flac'] })).toThrow(/audioFormats/);
  });
});
