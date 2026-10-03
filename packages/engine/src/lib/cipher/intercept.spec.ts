/**
 * Tests for Intercept generation (task 8.3; Requirements 9.1, 9.4, 29.4).
 *
 * The generator turns transmissions (Plot Stage traces, Side Threads, Noise
 * Traffic) into the ciphertext the player captures. These tests pin:
 *
 * - **Fidelity (Property 9).** Decrypting an Intercept with its true spec and
 *   parsing the field message recovers exactly its source Propositions.
 * - **Traffic metadata.** Each Intercept carries its Channel, firing time,
 *   owner, direction and a call sign.
 * - **Owner-weighted cipher kind.** The drawn kind is always in the owner's
 *   weighted, preset-allowed set.
 * - **Tradecraft errors (Req 9.4).** At probability 1 every eligible Intercept
 *   carries an error; at 0 none do. Pad reuse links two OTP Intercepts sharing a
 *   pad (and the two-time-pad cancellation holds); fixed-header Intercepts share
 *   the crib.
 * - **Ids.** Intercept ids are unique `int:` ids.
 * - **Determinism.** The same seed and inputs produce identical Intercepts.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createPrng } from '../prng/prng.js';
import type {
  ChannelId,
  DocId,
  GameTime,
  Proposition,
} from '../model/core.js';
import type { Channel, ChannelKind } from '../city/comms.js';
import { resolveCipherSpec, type CipherKeyLookup } from './spec.js';
import type { CipherConventions } from '@tradecraft/content';
import {
  generateIntercepts,
  weightedCipherKinds,
  conventionWeightsFor,
  revealedSpec,
  decryptToFieldMessage,
  OWNER_CIPHER_WEIGHTS,
  FIXED_HEADER_CRIB,
  INTERCEPT_OWNER_KINDS,
  type GenerateInterceptsInputs,
  type InterceptOwnerKind,
  type InterceptSource,
} from './intercept.js';
import {
  encodePropositions,
  parseFieldMessage,
  type FieldCodeLookup,
} from './field-message.js';
import { decrypt } from './cipher.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A hand-built field-code map, exactly the subset field-message.ts needs. Two
// predicates are enough to exercise encode/parse without loading the pack.
const fieldCodes: FieldCodeLookup = {
  fieldCodes: new Map<string, string>([
    ['MEETS_AT', 'MAT'],
    ['USES_CHANNEL', 'UCH'],
  ]),
};

// A pad and a public text long enough to key any message these tests produce.
// Both are plain letter runs so the running-key ciphers never run dry.
const PAD = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(20);
const PUBLIC_TEXT = 'THEQUICKBROWNFOXJUMPSOVERTHELAZYDOG'.repeat(20);
const PAD_ID = 'pad:test';
const DOC_ID = 'doc:almanac' as DocId;

const keyLookup: CipherKeyLookup = {
  publicText: (id) => (id === DOC_ID ? PUBLIC_TEXT : undefined),
  pad: (id) => (id === PAD_ID ? PAD : undefined),
};

/** A radio Channel owned by an org, interceptable. */
function channel(id: string, kind: ChannelKind = 'radio'): Channel {
  return {
    id: id as ChannelId,
    kind,
    owner: 'org:cell',
    schedule: { period: 1, start: { day: 0, phase: 0 }, phase: 0 },
  };
}

const CHANNELS: Record<ChannelId, Channel> = {
  ['chan:a' as ChannelId]: channel('chan:a'),
  ['chan:b' as ChannelId]: channel('chan:b'),
  ['chan:courier' as ChannelId]: channel('chan:courier', 'courier'),
};

/** A couple of well-typed Propositions over the hand-built vocabulary. */
function props(n: number): Proposition[] {
  const at: GameTime = { day: 2, phase: 1 };
  return [
    {
      id: `p:${n}:0`,
      subject: 'npc:ana',
      predicate: 'MEETS_AT',
      object: 'npc:boris',
      place: 'loc:cafe',
      window: { from: at },
    },
    {
      id: `p:${n}:1`,
      subject: 'npc:boris',
      predicate: 'USES_CHANNEL',
      object: 'chan:a' as ChannelId,
    },
  ];
}

function source(
  id: string,
  overrides: Partial<InterceptSource> = {},
): InterceptSource {
  return {
    id,
    channel: 'chan:a' as ChannelId,
    at: { day: 1, phase: 2 },
    ownerKind: 'hostile',
    origin: 'plot',
    propositions: props(0),
    ...overrides,
  };
}

const ALL_CIPHERS = [
  'caesar',
  'vigenere',
  'columnar',
  'book',
  'otp',
] as const;

function inputs(
  overrides: Partial<GenerateInterceptsInputs> = {},
): GenerateInterceptsInputs {
  return {
    channels: CHANNELS,
    fieldCodes,
    allowedCiphers: [...ALL_CIPHERS],
    tradecraftErrorProbability: 0,
    publicTextIds: [DOC_ID],
    padIds: [PAD_ID],
    keyLookup,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fidelity (Property 9)
// ---------------------------------------------------------------------------

describe('generateIntercepts — fidelity (Req 9.1, Property 9)', () => {
  it('round-trips every Intercept back to its source Propositions', () => {
    const txs = [source('tx-1'), source('tx-2', { ownerKind: 'noise' })];
    const { intercepts } = generateIntercepts(createPrng('seed-fid'), txs, inputs());

    expect(Object.keys(intercepts)).toHaveLength(2);
    for (const intercept of Object.values(intercepts)) {
      const key = resolveCipherSpec(revealedSpec(intercept), keyLookup);
      const plain = decryptToFieldMessage(intercept, key);
      const recovered = parseFieldMessage(plain, fieldCodes);
      // Both sources carry props(0); the field message does not carry the
      // Sim-internal id (rebuilt as fm:<line>), so compare every other field.
      const expected = parseFieldMessage(
        encodePropositions(props(0), fieldCodes),
        fieldCodes,
      );
      expect(recovered).toEqual(expected);
      expect(recovered.map((p) => p.predicate)).toEqual([
        'MEETS_AT',
        'USES_CHANNEL',
      ]);
      expect(recovered.map((p) => p.subject)).toEqual(['npc:ana', 'npc:boris']);
    }
  });

  it('records the source Proposition ids as plaintextProps', () => {
    const { intercepts } = generateIntercepts(
      createPrng('seed-props'),
      [source('tx-1')],
      inputs(),
    );
    const [intercept] = Object.values(intercepts);
    expect(intercept.plaintextProps).toEqual(['p:0:0', 'p:0:1']);
  });

  it('round-trips across arbitrary owners and seeds (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.constantFrom<InterceptOwnerKind>(...INTERCEPT_OWNER_KINDS),
        (seed, ownerKind) => {
          const { intercepts } = generateIntercepts(
            createPrng(seed),
            [source('tx-1', { ownerKind })],
            inputs(),
          );
          const [intercept] = Object.values(intercepts);
          const key = resolveCipherSpec(revealedSpec(intercept), keyLookup);
          const recovered = parseFieldMessage(
            decryptToFieldMessage(intercept, key),
            fieldCodes,
          );
          expect(recovered.map((p) => p.predicate)).toEqual([
            'MEETS_AT',
            'USES_CHANNEL',
          ]);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Traffic metadata
// ---------------------------------------------------------------------------

describe('generateIntercepts — traffic metadata (Req 25.3)', () => {
  it('populates channel, time, owner, direction and call sign', () => {
    const tx = source('tx-1', {
      channel: 'chan:b' as ChannelId,
      at: { day: 3, phase: 2 },
      direction: 'inbound',
    });
    const { intercepts } = generateIntercepts(createPrng('seed-meta'), [tx], inputs());
    const [intercept] = Object.values(intercepts);

    expect(intercept.channel).toBe('chan:b');
    expect(intercept.at).toEqual({ day: 3, phase: 2 });
    expect(intercept.owner).toBe('org:cell');
    expect(intercept.direction).toBe('inbound');
    expect(intercept.meta.callsign).toBe('B');
    expect(intercept.meta.length).toBe(intercept.ciphertext.length);
  });

  it('defaults direction to outbound', () => {
    const { intercepts } = generateIntercepts(
      createPrng('seed-dir'),
      [source('tx-1')],
      inputs(),
    );
    const [intercept] = Object.values(intercepts);
    expect(intercept.direction).toBe('outbound');
  });

  it('skips non-interceptable Channels and empty / unknown traffic', () => {
    const txs: InterceptSource[] = [
      source('tx-courier', { channel: 'chan:courier' as ChannelId }),
      source('tx-empty', { propositions: [] }),
      source('tx-unknown', { channel: 'chan:missing' as ChannelId }),
      source('tx-ok'),
    ];
    const { intercepts, order } = generateIntercepts(
      createPrng('seed-skip'),
      txs,
      inputs(),
    );
    expect(order).toEqual(['int:tx-ok']);
    expect(Object.keys(intercepts)).toEqual(['int:tx-ok']);
  });
});

// ---------------------------------------------------------------------------
// Owner-weighted cipher kind
// ---------------------------------------------------------------------------

describe('generateIntercepts — owner-weighted cipher kind', () => {
  it('draws a kind in the owner weighted, preset-allowed set (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.constantFrom<InterceptOwnerKind>(...INTERCEPT_OWNER_KINDS),
        (seed, ownerKind) => {
          const allowedSet = new Set(
            weightedCipherKinds(ownerKind, [...ALL_CIPHERS]),
          );
          const { intercepts } = generateIntercepts(
            createPrng(seed),
            [source('tx-1', { ownerKind })],
            inputs(),
          );
          const [intercept] = Object.values(intercepts);
          expect(allowedSet.has(revealedSpec(intercept).kind)).toBe(true);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('respects the preset allowed set (Vigenère-only)', () => {
    const { intercepts } = generateIntercepts(
      createPrng('seed-vig'),
      [source('tx-1', { ownerKind: 'hostile' })],
      inputs({ allowedCiphers: ['vigenere'] }),
    );
    const [intercept] = Object.values(intercepts);
    expect(revealedSpec(intercept).kind).toBe('vigenere');
  });

  it('hostile never draws caesar (weight 0) over many seeds', () => {
    for (let i = 0; i < 50; i += 1) {
      const { intercepts } = generateIntercepts(
        createPrng(`seed-${i}`),
        [source('tx-1', { ownerKind: 'hostile' })],
        inputs(),
      );
      const [intercept] = Object.values(intercepts);
      expect(revealedSpec(intercept).kind).not.toBe('caesar');
    }
    // Sanity: hostile does weight caesar at 0.
    expect(OWNER_CIPHER_WEIGHTS.hostile.caesar).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tradecraft errors (Req 9.4)
// ---------------------------------------------------------------------------

describe('generateIntercepts — tradecraft errors (Req 9.4)', () => {
  it('at probability 1 every Intercept carries an error', () => {
    const txs = [source('tx-1'), source('tx-2'), source('tx-3')];
    const { intercepts } = generateIntercepts(
      createPrng('seed-err1'),
      txs,
      inputs({ tradecraftErrorProbability: 1 }),
    );
    for (const intercept of Object.values(intercepts)) {
      expect(intercept.tradecraftError).toBeDefined();
    }
  });

  it('at probability 0 none carry an error (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const txs = [source('tx-1'), source('tx-2')];
        const { intercepts } = generateIntercepts(
          createPrng(seed),
          txs,
          inputs({ tradecraftErrorProbability: 0 }),
        );
        for (const intercept of Object.values(intercepts)) {
          expect(intercept.tradecraftError).toBeUndefined();
        }
      }),
      { numRuns: 40 },
    );
  });

  it('bounds the error rate between the 0 and 1 extremes (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (p) => {
          const txs = [source('tx-1'), source('tx-2'), source('tx-3')];
          const { intercepts } = generateIntercepts(
            createPrng('seed-rate'),
            txs,
            inputs({ tradecraftErrorProbability: p }),
          );
          const withError = Object.values(intercepts).filter(
            (i) => i.tradecraftError !== undefined,
          ).length;
          expect(withError).toBeGreaterThanOrEqual(0);
          expect(withError).toBeLessThanOrEqual(Object.keys(intercepts).length);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('pad reuse links two OTP Intercepts and the two-time-pad cancellation holds', () => {
    const txs = [source('tx-1'), source('tx-2')];
    const { intercepts, order } = generateIntercepts(
      createPrng('seed-pad'),
      txs,
      inputs({ allowedCiphers: ['otp'], tradecraftErrorProbability: 1 }),
    );
    const [first, second] = order.map((id) => intercepts[id]);

    // The first OTP user gets a fixed-header crib (no prior pad to reuse); the
    // second reuses the first's pad.
    expect(revealedSpec(first).kind).toBe('otp');
    expect(revealedSpec(second).kind).toBe('otp');
    expect(second.tradecraftError).toEqual({ kind: 'pad-reuse', with: first.id });
    const secondSpec = revealedSpec(second);
    expect(secondSpec.kind === 'otp' && secondSpec.reusedWith).toBe(first.id);

    // Both ciphertexts used the same pad, so the letter-wise difference of the
    // ciphertexts equals the letter-wise difference of the plaintexts: the pad
    // cancels. This is the break the player exploits. Compare against the raw
    // decrypted plaintexts (crib included), aligned from the start.
    const firstKey = resolveCipherSpec(revealedSpec(first), keyLookup);
    const secondKey = resolveCipherSpec(revealedSpec(second), keyLookup);
    const p1 = decrypt(first.ciphertext, firstKey);
    const p2 = decrypt(second.ciphertext, secondKey);
    expect(letterDiff(first.ciphertext, second.ciphertext)).toEqual(
      letterDiff(p1, p2),
    );
  });

  it('fixed-header Intercepts all share the crib', () => {
    const txs = [source('tx-1'), source('tx-2')];
    const { intercepts } = generateIntercepts(
      createPrng('seed-hdr'),
      txs,
      // Caesar can never be an OTP, so every error is a fixed header.
      inputs({ allowedCiphers: ['caesar'], tradecraftErrorProbability: 1 }),
    );
    for (const intercept of Object.values(intercepts)) {
      expect(intercept.tradecraftError).toEqual({
        kind: 'fixed-header',
        header: FIXED_HEADER_CRIB,
      });
      expect(intercept.meta.header).toBe(FIXED_HEADER_CRIB);
    }
  });
});

// ---------------------------------------------------------------------------
// Ids and determinism
// ---------------------------------------------------------------------------

describe('generateIntercepts — ids and determinism (Req 1.2, Property 1)', () => {
  it('mints unique int: ids', () => {
    const txs = [source('tx-1'), source('tx-2'), source('tx-3')];
    const { intercepts, order } = generateIntercepts(
      createPrng('seed-ids'),
      txs,
      inputs(),
    );
    for (const id of order) {
      expect(id.startsWith('int:')).toBe(true);
    }
    expect(new Set(order).size).toBe(order.length);
    expect(Object.keys(intercepts).sort()).toEqual([...order].sort());
  });

  it('is identical for the same seed and inputs (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const txs = [
          source('tx-1', { ownerKind: 'hostile' }),
          source('tx-2', { ownerKind: 'noise' }),
          source('tx-3', { ownerKind: 'station' }),
        ];
        const a = generateIntercepts(
          createPrng(seed),
          txs,
          inputs({ tradecraftErrorProbability: 0.5 }),
        );
        const b = generateIntercepts(
          createPrng(seed),
          txs,
          inputs({ tradecraftErrorProbability: 0.5 }),
        );
        expect(a).toEqual(b);
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UPPER_A = 'A'.charCodeAt(0);
const LOWER_A = 'a'.charCodeAt(0);

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function letterIndex(code: number): number {
  return code >= LOWER_A ? code - LOWER_A : code - UPPER_A;
}

/**
 * The per-letter difference `(a[i] - b[i]) mod 26` over the letters of two
 * strings. For two one-time-pad ciphertexts sharing a pad this equals the same
 * difference computed over their plaintexts, since the shared pad cancels.
 */
function letterDiff(a: string, b: string): number[] {
  const la = lettersOf(a);
  const lb = lettersOf(b);
  const out: number[] = [];
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i += 1) {
    out.push((((la[i] - lb[i]) % 26) + 26) % 26);
  }
  return out;
}

function lettersOf(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isLetter(code)) {
      out.push(letterIndex(code));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Era Pack cipher conventions (content-expansion Req 5.6)
// ---------------------------------------------------------------------------

/**
 * A hand-built CipherConventions fixture. Owner weights are chosen so each
 * engine owner kind draws a *different*, verifiable kind:
 *
 * - era `hostile` → only `book` (so engine `hostile` and `cell` both draw book);
 * - era `station` → only `vigenere`;
 * - era `commercial` + `criminal` → `caesar` and `columnar` (summed for the
 *   engine `noise` bucket, which maps onto both).
 *
 * `diplomatic` is weighted too but the engine never asks for it.
 */
function conventions(
  overrides: Partial<CipherConventions> = {},
): CipherConventions {
  return {
    ownerWeights: {
      hostile: { book: 5 },
      diplomatic: { vigenere: 1 },
      commercial: { caesar: 3 },
      criminal: { columnar: 2 },
      station: { vigenere: 7 },
    },
    headers: ['QRA {groupNo}', 'ZBZ {dateGroup}', 'KKK'],
    padFormat: { groupSize: 5, groupsPerLine: 6 },
    numbersFormat: { callup: '1-2-3', groups: 50, repeat: 2 },
    ...overrides,
  };
}

describe('conventionWeightsFor — owner-kind mapping (Req 5.6)', () => {
  it('falls back to the built-in defaults when no conventions are loaded', () => {
    for (const owner of INTERCEPT_OWNER_KINDS) {
      expect(conventionWeightsFor(owner)).toEqual(OWNER_CIPHER_WEIGHTS[owner]);
    }
  });

  it('maps hostile and cell onto the era hostile weights', () => {
    const c = conventions();
    const expected = { caesar: 0, vigenere: 0, columnar: 0, book: 5, otp: 0 };
    expect(conventionWeightsFor('hostile', c)).toEqual(expected);
    expect(conventionWeightsFor('cell', c)).toEqual(expected);
  });

  it('maps station onto the era station weights', () => {
    expect(conventionWeightsFor('station', conventions())).toEqual({
      caesar: 0,
      vigenere: 7,
      columnar: 0,
      book: 0,
      otp: 0,
    });
  });

  it('sums the era commercial and criminal weights for noise', () => {
    expect(conventionWeightsFor('noise', conventions())).toEqual({
      caesar: 3,
      vigenere: 0,
      columnar: 2,
      book: 0,
      otp: 0,
    });
  });
});

describe('generateIntercepts — applies loaded cipher conventions (Req 5.6)', () => {
  it('draws owner cipher kinds from the convention weights, not the defaults', () => {
    const c = conventions();
    // hostile/cell → book only; station → vigenere only; noise → caesar|columnar.
    const cases: [InterceptOwnerKind, readonly string[]][] = [
      ['hostile', ['book']],
      ['cell', ['book']],
      ['station', ['vigenere']],
      ['noise', ['caesar', 'columnar']],
    ];
    for (const [ownerKind, allowedKinds] of cases) {
      for (let i = 0; i < 20; i += 1) {
        const { intercepts } = generateIntercepts(
          createPrng(`conv-${ownerKind}-${i}`),
          [source('tx-1', { ownerKind })],
          inputs({ cipherConventions: c }),
        );
        const [intercept] = Object.values(intercepts);
        expect(allowedKinds).toContain(revealedSpec(intercept).kind);
      }
    }
  });

  it('weightedCipherKinds honours the convention weights', () => {
    const c = conventions();
    expect(weightedCipherKinds('hostile', [...ALL_CIPHERS], c)).toEqual(['book']);
    expect(weightedCipherKinds('station', [...ALL_CIPHERS], c)).toEqual([
      'vigenere',
    ]);
    expect(weightedCipherKinds('noise', [...ALL_CIPHERS], c)).toEqual([
      'caesar',
      'columnar',
    ]);
  });

  it('draws fixed-header cribs from the convention headers list', () => {
    const c = conventions();
    const headerSet = new Set(c.headers);
    const txs = [source('tx-1'), source('tx-2'), source('tx-3')];
    // Caesar is never an OTP, so every injected error is a fixed header. (With
    // caesar-only allowed, hostile's convention `book` weight has no allowed
    // member, so the generator falls back to caesar.)
    const { intercepts } = generateIntercepts(
      createPrng('conv-hdr'),
      txs,
      inputs({
        cipherConventions: c,
        allowedCiphers: ['caesar'],
        tradecraftErrorProbability: 1,
      }),
    );
    const errs = Object.values(intercepts)
      .map((i) => i.tradecraftError)
      .filter(
        (e): e is { kind: 'fixed-header'; header: string } =>
          e?.kind === 'fixed-header',
      );
    expect(errs.length).toBeGreaterThan(0);
    for (const err of errs) {
      expect(headerSet.has(err.header)).toBe(true);
      // Never the built-in default, which is not in the convention list.
      expect(err.header).not.toBe(FIXED_HEADER_CRIB);
    }
  });

  it('falls back to the built-in crib when no conventions are loaded', () => {
    const txs = [source('tx-1'), source('tx-2')];
    const { intercepts } = generateIntercepts(
      createPrng('conv-fallback'),
      txs,
      inputs({ allowedCiphers: ['caesar'], tradecraftErrorProbability: 1 }),
    );
    for (const intercept of Object.values(intercepts)) {
      expect(intercept.tradecraftError).toEqual({
        kind: 'fixed-header',
        header: FIXED_HEADER_CRIB,
      });
    }
  });

  it('is deterministic for the same seed, inputs and conventions', () => {
    const c = conventions();
    const txs = [
      source('tx-1', { ownerKind: 'hostile' }),
      source('tx-2', { ownerKind: 'noise' }),
      source('tx-3', { ownerKind: 'station' }),
    ];
    const run = () =>
      generateIntercepts(
        createPrng('conv-det'),
        txs,
        inputs({ cipherConventions: c, tradecraftErrorProbability: 0.5 }),
      );
    expect(run()).toEqual(run());
  });

  it('round-trips Intercepts generated under conventions', () => {
    const c = conventions();
    const txs = [source('tx-1'), source('tx-2', { ownerKind: 'noise' })];
    const { intercepts } = generateIntercepts(
      createPrng('conv-fid'),
      txs,
      inputs({ cipherConventions: c, tradecraftErrorProbability: 1 }),
    );
    for (const intercept of Object.values(intercepts)) {
      const key = resolveCipherSpec(revealedSpec(intercept), keyLookup);
      const recovered = parseFieldMessage(
        decryptToFieldMessage(intercept, key),
        fieldCodes,
      );
      expect(recovered.map((p) => p.predicate)).toEqual([
        'MEETS_AT',
        'USES_CHANNEL',
      ]);
    }
  });
});
