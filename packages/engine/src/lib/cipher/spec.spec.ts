import { decrypt, encrypt } from './cipher.js';
import {
  CipherSpecSchema,
  KeySubmissionSchema,
  resolveCipherSpec,
  type CipherKeyLookup,
  type CipherSpec,
} from './spec.js';

const PUBLIC_TEXT = 'The quick brown fox jumps over the lazy dog, again and again.';

const lookup: CipherKeyLookup = {
  publicText: (id) => (id === 'doc:almanac' ? PUBLIC_TEXT : undefined),
  pad: (id) => (id === 'pad:alpha' ? PUBLIC_TEXT : undefined),
};

describe('CipherSpecSchema', () => {
  it('accepts each cipher kind', () => {
    const specs: unknown[] = [
      { kind: 'caesar', shift: 3 },
      { kind: 'vigenere', key: 'VIENNA' },
      { kind: 'columnar', key: 'ZEBRAS' },
      { kind: 'book', textId: 'doc:almanac', scheme: 'page-line-word' },
      { kind: 'otp', padId: 'pad:alpha' },
      { kind: 'otp', padId: 'pad:alpha', reusedWith: 'int:7' },
    ];
    for (const spec of specs) {
      expect(CipherSpecSchema.safeParse(spec).success).toBe(true);
    }
  });

  it('rejects unknown kinds and bad shapes', () => {
    expect(CipherSpecSchema.safeParse({ kind: 'rot', shift: 1 }).success).toBe(false);
    expect(CipherSpecSchema.safeParse({ kind: 'vigenere', key: '' }).success).toBe(false);
    expect(
      CipherSpecSchema.safeParse({ kind: 'book', textId: 'almanac', scheme: 'x' }).success,
    ).toBe(false);
  });
});

describe('KeySubmissionSchema', () => {
  it('accepts a key submission and a plaintext submission', () => {
    expect(
      KeySubmissionSchema.safeParse({ kind: 'key', spec: { kind: 'caesar', shift: 3 } })
        .success,
    ).toBe(true);
    expect(
      KeySubmissionSchema.safeParse({ kind: 'plaintext', text: 'meet at dawn' }).success,
    ).toBe(true);
  });

  it('rejects a submission with no kind', () => {
    expect(KeySubmissionSchema.safeParse({ spec: { kind: 'caesar', shift: 3 } }).success).toBe(
      false,
    );
  });
});

describe('resolveCipherSpec', () => {
  it('resolves references and round-trips through the pure ciphers', () => {
    const specs: CipherSpec[] = [
      { kind: 'caesar', shift: 5 },
      { kind: 'vigenere', key: 'PRATER' },
      { kind: 'columnar', key: 'DELTA' },
      { kind: 'book', textId: 'doc:almanac', scheme: 'page-line-word' },
      { kind: 'otp', padId: 'pad:alpha' },
    ];
    const plain = 'Signal received.';
    for (const spec of specs) {
      const key = resolveCipherSpec(spec, lookup);
      expect(decrypt(encrypt(plain, key), key)).toBe(plain);
    }
  });

  it('throws naming a missing public text', () => {
    expect(() =>
      resolveCipherSpec({ kind: 'book', textId: 'doc:missing', scheme: 'page-line-word' }, lookup),
    ).toThrow(/doc:missing/);
  });

  it('throws naming a missing pad', () => {
    expect(() => resolveCipherSpec({ kind: 'otp', padId: 'pad:missing' }, lookup)).toThrow(
      /pad:missing/,
    );
  });
});
