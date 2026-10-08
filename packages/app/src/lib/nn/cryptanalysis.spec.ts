/**
 * Cryptanalysis from ciphertext only. These tests encrypt a field message and
 * ask for it back without handing over the key.
 */
import { encrypt } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { breakTraffic, type TrafficCopy } from './cryptanalysis.js';

const PLAIN = 'MT npc:ana loc:cafe @loc:cafe\nPL npc:ana org:hq ~1.0..2.1';

const KNOWN = ['npc:ana', 'loc:cafe', 'org:hq'];

function traffic(
  ciphertext: string,
  patch: Partial<TrafficCopy> = {},
): TrafficCopy {
  return { id: 'int:a', ciphertext, ...patch };
}

describe('breakTraffic', () => {
  it('reads a Caesar shift off the ciphertext', () => {
    const ciphertext = encrypt(PLAIN, { kind: 'caesar', shift: 5 });
    const result = breakTraffic(traffic(ciphertext));
    expect(result).toEqual({
      method: 'caesar',
      submission: { kind: 'plaintext', text: PLAIN },
    });
  });

  it('reads an ambient field code the same way', () => {
    const plain = 'OC evt:fair loc:square\nAD npc:ana evt:fair';
    const ciphertext = encrypt(plain, { kind: 'caesar', shift: 9 });
    expect(breakTraffic(traffic(ciphertext))?.submission).toEqual({
      kind: 'plaintext',
      text: plain,
    });
  });

  it('fits a Vigenère keyword from the field-message skeleton', () => {
    const ciphertext = encrypt(PLAIN, { kind: 'vigenere', keyword: 'QMZP' });
    const result = breakTraffic(traffic(ciphertext));
    expect(result?.method).toBe('vigenere');
    expect(result?.submission).toEqual({ kind: 'plaintext', text: PLAIN });
  });

  it('uses a fixed-header crib and returns the field message without it', () => {
    const ciphertext = encrypt(`NR\n${PLAIN}`, {
      kind: 'vigenere',
      keyword: 'QMZP',
    });
    const result = breakTraffic(traffic(ciphertext, { header: 'NR' }));
    expect(result?.submission).toEqual({ kind: 'plaintext', text: PLAIN });
  });

  it('recovers a columnar transposition for a short key and a longer one', () => {
    for (const key of ['BCAE', 'FDBCAE']) {
      const ciphertext = encrypt(PLAIN, { kind: 'columnar', key });
      const result = breakTraffic(traffic(ciphertext));
      expect(result?.method).toBe('columnar');
      expect(result?.submission).toEqual({ kind: 'plaintext', text: PLAIN });
    }
  });

  it('tries a public text as a book-cipher running key', () => {
    const book = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    const decoy = 'Pack my box with five dozen liquor jugs. '.repeat(20);
    const ciphertext = encrypt(PLAIN, { kind: 'book', text: book });
    const result = breakTraffic(traffic(ciphertext), [
      { id: 'doc:decoy', body: decoy },
      { id: 'doc:almanac', body: book },
    ]);
    expect(result).toEqual({
      method: 'book',
      submission: { kind: 'plaintext', text: PLAIN },
    });
  });

  it('leaves a one-time pad alone when the operator did not reuse it', () => {
    const pad = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(8);
    const ciphertext = encrypt(PLAIN, { kind: 'otp', pad });
    expect(breakTraffic(traffic(ciphertext))).toBeUndefined();
  });

  it('leaves a reused pad alone until the other capture is in hand', () => {
    const pad = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(8);
    const ciphertext = encrypt(PLAIN, { kind: 'otp', pad });
    expect(
      breakTraffic(
        traffic(ciphertext, { padReuseWith: 'int:b' }),
        [],
        [],
        KNOWN,
      ),
    ).toBeUndefined();
  });

  it('reads two captures off one reused pad when the cribs cover both', () => {
    const pad = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(8);
    const otherPlain = 'WF npc:ana org:hq\nMT npc:ana loc:cafe';
    const ciphertext = encrypt(PLAIN, { kind: 'otp', pad });
    const other = encrypt(otherPlain, { kind: 'otp', pad });
    const result = breakTraffic(
      traffic(ciphertext, { padReuseWith: 'int:b' }),
      [],
      [{ id: 'int:b', ciphertext: other }],
      KNOWN,
    );
    expect(result).toEqual({
      method: 'pad-reuse',
      submission: { kind: 'plaintext', text: PLAIN },
    });
  });

  it('does not invent the letters a reused pad never cribbed', () => {
    const pad = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(8);
    const otherPlain = 'WF npc:ana org:hq\nMT npc:ana loc:cafe';
    const ciphertext = encrypt(PLAIN, { kind: 'otp', pad });
    const other = encrypt(otherPlain, { kind: 'otp', pad });
    expect(
      breakTraffic(
        traffic(ciphertext, { padReuseWith: 'int:b' }),
        [],
        [{ id: 'int:b', ciphertext: other }],
        ['npc:ana'],
      ),
    ).toBeUndefined();
  });
});
