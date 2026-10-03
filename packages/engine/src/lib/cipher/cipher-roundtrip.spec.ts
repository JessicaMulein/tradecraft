/**
 * Property 8: Cipher round-trip.
 *
 * **Property 8: Cipher round-trip.** For every supported cipher, any key and
 * any plaintext over the message alphabet, `decrypt(encrypt(m, k), k) = m`.
 *
 * **Validates: Requirements 9.2, 9.3**
 *
 * This is the formal, comprehensive property test for Property 8 from the
 * design's Correctness Properties section. Where `cipher.spec.ts` gives each
 * cipher basic per-cipher round-trip assurance, this file states the property
 * once over *all five* supported ciphers (Req 9.2: Caesar, Vigenère, columnar
 * transposition, book cipher, one-time pad) driven through the public
 * `encrypt`/`decrypt` dispatchers, and additionally pins down the determinism
 * that Req 9.3 demands — the Cipher Engine is deterministic code with no
 * language model involvement, so the same inputs must always yield the same
 * output and `encrypt` must be a pure function of (plaintext, key).
 *
 * The generators below span the message alphabet the engine actually handles:
 * uppercase and lowercase A–Z letters (which are substituted/transposed), plus
 * digits, punctuation and spaces (which pass through substitution ciphers and
 * are carried as cells by the columnar cipher). Book and one-time-pad keys are
 * generated with provably sufficient letter material for the message so the
 * running key never runs dry.
 */

import fc from 'fast-check';

import { decrypt, encrypt, type CipherKey, type CipherKind } from './cipher.js';

// ---------------------------------------------------------------------------
// Message-alphabet generators
// ---------------------------------------------------------------------------

// The characters a message may contain: letters (both cases, enciphered within
// their case), digits, punctuation and spaces (passthrough / transposed cells).
// U+0000 is deliberately excluded — it is the columnar cipher's internal row
// sentinel and never appears in a real plaintext.
const MESSAGE_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'abcdefghijklmnopqrstuvwxyz' +
  '0123456789' +
  " .,!?;:'\"()-/";

/**
 * Plaintext over the message alphabet, including the empty string. Mixes case,
 * digits, punctuation and spaces so the property exercises both enciphered and
 * passthrough characters in the same message.
 */
const plaintextArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(...MESSAGE_CHARS.split('')),
  minLength: 0,
  maxLength: 80,
});

/** Count the A–Z/a–z letters in a string — the characters a running key feeds. */
function letterCount(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

/**
 * A key stream of A–Z letters with at least as many letters as `message`, plus
 * some slack, so a book or one-time-pad key never runs dry. The slack and
 * interspersed non-letters mirror how a real public text or pad reads: letters
 * carry the key, everything else is skipped.
 */
function keyStreamFor(message: string): fc.Arbitrary<string> {
  const needed = letterCount(message);
  return fc
    .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
      minLength: needed,
      maxLength: needed + 32,
    })
    .map((letters) => letters.join(''));
}

// Per-cipher key generators. Caesar/Vigenère/columnar keys are independent of
// the plaintext; book/otp keys depend on the plaintext's letter count, so those
// are generated jointly with the message in the properties below.

const caesarKeyArb: fc.Arbitrary<CipherKey> = fc
  .integer()
  .map((shift) => ({ kind: 'caesar', shift }));

const vigenereKeyArb: fc.Arbitrary<CipherKey> = fc
  .string({
    unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    minLength: 1,
    maxLength: 16,
  })
  .map((keyword) => ({ kind: 'vigenere', keyword }));

const columnarKeyArb: fc.Arbitrary<CipherKey> = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((k) => !k.includes('\u0000'))
  .map((key) => ({ kind: 'columnar', key }));

// ---------------------------------------------------------------------------
// Property 8: round-trip
// ---------------------------------------------------------------------------

describe('Property 8: Cipher round-trip', () => {
  // Caesar, Vigenère and columnar have plaintext-independent keys, so the
  // round-trip property is stated directly over (plaintext, key).
  const independentKeyCiphers: ReadonlyArray<
    [CipherKind, fc.Arbitrary<CipherKey>]
  > = [
    ['caesar', caesarKeyArb],
    ['vigenere', vigenereKeyArb],
    ['columnar', columnarKeyArb],
  ];

  for (const [kind, keyArb] of independentKeyCiphers) {
    it(`decrypt(encrypt(m, k), k) === m for ${kind} over the message alphabet`, () => {
      fc.assert(
        fc.property(plaintextArb, keyArb, (plain, key) => {
          expect(decrypt(encrypt(plain, key), key)).toBe(plain);
        }),
        { numRuns: 300 },
      );
    });
  }

  it('decrypt(encrypt(m, k), k) === m for book cipher with sufficient key text', () => {
    fc.assert(
      fc.property(
        plaintextArb.chain((plain) =>
          keyStreamFor(plain).map((text) => ({ plain, text })),
        ),
        ({ plain, text }) => {
          const key: CipherKey = { kind: 'book', text };
          expect(decrypt(encrypt(plain, key), key)).toBe(plain);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('decrypt(encrypt(m, k), k) === m for one-time pad with sufficient pad material', () => {
    fc.assert(
      fc.property(
        plaintextArb.chain((plain) =>
          keyStreamFor(plain).map((pad) => ({ plain, pad })),
        ),
        ({ plain, pad }) => {
          const key: CipherKey = { kind: 'otp', pad };
          expect(decrypt(encrypt(plain, key), key)).toBe(plain);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Req 9.3: deterministic code, no language model involvement.
//
// A pure, LM-free cipher must give byte-identical output for identical inputs.
// We assert that encrypting (and decrypting) the same (message, key) twice —
// and via two independently constructed key objects of equal value — yields the
// exact same string, for every supported cipher.
// ---------------------------------------------------------------------------

describe('Property 8: cipher determinism (Req 9.3, no LM involvement)', () => {
  it('encrypt and decrypt are deterministic for every cipher and valid key', () => {
    fc.assert(
      fc.property(
        plaintextArb.chain((plain) =>
          fc
            .record({
              shift: fc.integer(),
              vigenere: fc.string({
                unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
                minLength: 1,
                maxLength: 16,
              }),
              columnar: fc
                .string({ minLength: 1, maxLength: 12 })
                .filter((k) => !k.includes('\u0000')),
              stream: keyStreamFor(plain),
            })
            .map((keys) => ({ plain, keys })),
        ),
        ({ plain, keys }) => {
          // Two independently constructed, equal-valued key objects per cipher,
          // to prove the output depends only on the key's value, not identity.
          const keyPairs: ReadonlyArray<[CipherKey, CipherKey]> = [
            [
              { kind: 'caesar', shift: keys.shift },
              { kind: 'caesar', shift: keys.shift },
            ],
            [
              { kind: 'vigenere', keyword: keys.vigenere },
              { kind: 'vigenere', keyword: keys.vigenere },
            ],
            [
              { kind: 'columnar', key: keys.columnar },
              { kind: 'columnar', key: keys.columnar },
            ],
            [
              { kind: 'book', text: keys.stream },
              { kind: 'book', text: keys.stream },
            ],
            [
              { kind: 'otp', pad: keys.stream },
              { kind: 'otp', pad: keys.stream },
            ],
          ];

          for (const [k1, k2] of keyPairs) {
            const first = encrypt(plain, k1);
            // Same input twice.
            expect(encrypt(plain, k1)).toBe(first);
            // Equal-valued but distinct key object.
            expect(encrypt(plain, k2)).toBe(first);
            // Decryption is likewise deterministic and inverts the output.
            expect(decrypt(first, k1)).toBe(decrypt(first, k2));
            expect(decrypt(first, k1)).toBe(plain);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
