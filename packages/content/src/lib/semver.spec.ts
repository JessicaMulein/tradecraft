import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  parseRange,
  parseVersion,
  satisfies,
} from '../index.js';

describe('parseVersion', () => {
  it('parses a well-formed version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVersion('  2.0.0 ')).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('rejects a malformed version', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3-beta')).toBeNull();
    expect(parseVersion('v1.2.3')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    const a = { major: 1, minor: 0, patch: 0 };
    const b = { major: 1, minor: 2, patch: 0 };
    const c = { major: 2, minor: 0, patch: 0 };
    expect(compareVersions(a, b)).toBeLessThan(0);
    expect(compareVersions(b, c)).toBeLessThan(0);
    expect(compareVersions(c, c)).toBe(0);
    expect(compareVersions(c, a)).toBeGreaterThan(0);
  });
});

describe('parseRange + satisfies', () => {
  const sat = (version: string, range: string): boolean => {
    const v = parseVersion(version);
    const r = parseRange(range);
    if (v === null || r === null) throw new Error('bad test input');
    return satisfies(v, r);
  };

  it('matches any version for * or empty', () => {
    expect(sat('0.0.1', '*')).toBe(true);
    expect(sat('9.9.9', '')).toBe(true);
  });

  it('matches an exact version with or without =', () => {
    expect(sat('1.2.3', '1.2.3')).toBe(true);
    expect(sat('1.2.3', '=1.2.3')).toBe(true);
    expect(sat('1.2.4', '1.2.3')).toBe(false);
  });

  it('honours a caret range for a 1.x pack', () => {
    expect(sat('1.0.0', '^1.0.0')).toBe(true);
    expect(sat('1.9.9', '^1.0.0')).toBe(true);
    expect(sat('2.0.0', '^1.0.0')).toBe(false);
    expect(sat('0.9.9', '^1.0.0')).toBe(false);
  });

  it('narrows a caret range for a 0.x pack to the minor', () => {
    expect(sat('0.2.3', '^0.2.3')).toBe(true);
    expect(sat('0.2.9', '^0.2.3')).toBe(true);
    expect(sat('0.3.0', '^0.2.3')).toBe(false);
  });

  it('narrows a caret range for a 0.0.x pack to the patch', () => {
    expect(sat('0.0.3', '^0.0.3')).toBe(true);
    expect(sat('0.0.4', '^0.0.3')).toBe(false);
  });

  it('matches a comparator conjunction', () => {
    expect(sat('1.5.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(sat('2.0.0', '>=1.2.0 <2.0.0')).toBe(false);
    expect(sat('1.1.0', '>=1.2.0 <2.0.0')).toBe(false);
  });

  it('returns null for a malformed range token', () => {
    expect(parseRange('^1.2')).toBeNull();
    expect(parseRange('~>1.0.0')).toBeNull();
    expect(parseRange('>=1.2.0 garbage')).toBeNull();
  });
});
