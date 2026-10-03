import { describe, expect, it } from 'vitest';

import { canonicalJson, hashPack } from '../index.js';

describe('canonicalJson', () => {
  it('sorts object keys so key order does not matter', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively', () => {
    const a = canonicalJson({ outer: { z: 1, a: 2 }, first: [{ y: 1, x: 2 }] });
    const b = canonicalJson({ first: [{ x: 2, y: 1 }], outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined object members like JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('emits null for undefined inside an array', () => {
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('handles the JSON scalars', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson('hi')).toBe('"hi"');
    expect(canonicalJson(42)).toBe('42');
  });
});

describe('hashPack', () => {
  const files = [
    { path: 'a.yaml', content: { b: 1, a: 2 } },
    { path: 'b.yaml', content: [1, 2, 3] },
  ];

  it('is stable regardless of key order within file content', () => {
    const reordered = [
      { path: 'a.yaml', content: { a: 2, b: 1 } },
      { path: 'b.yaml', content: [1, 2, 3] },
    ];
    expect(hashPack(files)).toBe(hashPack(reordered));
  });

  it('is a 64-char lowercase hex digest', () => {
    expect(hashPack(files)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when content changes', () => {
    const changed = [
      { path: 'a.yaml', content: { b: 1, a: 3 } },
      { path: 'b.yaml', content: [1, 2, 3] },
    ];
    expect(hashPack(files)).not.toBe(hashPack(changed));
  });

  it('changes when a file moves to a different path', () => {
    const moved = [
      { path: 'c.yaml', content: { b: 1, a: 2 } },
      { path: 'b.yaml', content: [1, 2, 3] },
    ];
    expect(hashPack(files)).not.toBe(hashPack(moved));
  });
});
