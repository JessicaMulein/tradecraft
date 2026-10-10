/**
 * Property 15 — Cipher conventions applied (content-expansion Req 5.6).
 *
 * Task 3.13. This is the property-based companion to the hand-written cases in
 * `intercept.spec.ts` ("generateIntercepts — applies loaded cipher
 * conventions"): where those pin specific, worked examples, this quantifies the
 * property over *arbitrary* conforming cipher conventions and arbitrary
 * Intercept sources, so the guarantee holds across the whole input space rather
 * than the few shapes a human picked.
 *
 * Design, Property 15 — for any cipher conventions and Intercept source:
 *
 *   1. every generated Intercept uses a cipher kind with non-zero weight for
 *      its owner kind;
 *   2. its header, when present, is rendered from a convention header template;
 *   3. pad and numbers-broadcast groups match the convention formats;
 *   4. decrypting with the true spec and parsing yields the source Propositions
 *      (slice Property 9 under conventions).
 *
 * **Validates: Requirements 5.6**
 *
 * ## What task 3.7 wired, and what this test can observe
 *
 * Task 3.7 made `makeIntercept` read the Era Pack's `CipherConventions` from the
 * Content Set in place of its built-in defaults: the per-owner cipher-kind
 * weights (via `conventionWeightsFor`, mapping the engine's four owner
 * categories onto the era's five) and the fixed-header crib (drawn from the
 * convention `headers` list). Those are the parts of Property 15 observable at
 * the `generateIntercepts` boundary this task covers:
 *
 *   - Claim 1 (owner weights)  — asserted directly: every drawn kind has a
 *     positive effective convention weight for its owner.
 *   - Claim 2 (header from convention) — asserted directly: whenever an
 *     Intercept carries a `fixed-header` error / `meta.header`, the header is a
 *     member of the convention's `headers` list, never the built-in default.
 *   - Claim 4 (round-trip under conventions) — asserted directly: decrypting
 *     with the true spec and parsing recovers the source Propositions.
 *
 * Claim 3 (pad and numbers-broadcast *group layout*) is not yet observable
 * here: task 3.7 carries `padFormat`/`numbersFormat` on the inputs but the
 * group-rendered presentation of an Intercept is produced by the rendering /
 * Preview path (tasks 3.6, 5.9), not by `generateIntercepts`. What this test
 * *can* and does assert for claim 3 is the invariant that holds at this
 * boundary: carrying arbitrary (schema-valid) pad and numbers formats never
 * perturbs the generated Intercepts, their cipher-kind draws or their
 * round-trip — the formats are inert to generation, exactly as the module
 * documents. The group-layout assertion proper belongs with the rendering
 * task's own property test.
 *
 * The fixtures (field codes, pad, public text, channels, propositions, the
 * `source`/`inputs` builders) mirror `intercept.spec.ts`; the fast-check shape
 * (a seeded generator, a bounded `numRuns`) mirrors the engine's other
 * `*.property.spec.ts` files.
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
  conventionWeightsFor,
  revealedSpec,
  privateFieldMessage,
  interceptIdOf,
  FIXED_HEADER_CRIB,
  INTERCEPT_OWNER_KINDS,
  type GenerateInterceptsInputs,
  type InterceptOwnerKind,
  type InterceptSource,
} from './intercept.js';
import {
  parseFieldMessage,
  type FieldCodeLookup,
} from './field-message.js';

// ---------------------------------------------------------------------------
// Fixtures (mirror intercept.spec.ts)
// ---------------------------------------------------------------------------

const fieldCodes: FieldCodeLookup = {
  fieldCodes: new Map<string, string>([
    ['MEETS_AT', 'MAT'],
    ['USES_CHANNEL', 'UCH'],
  ]),
};

// A pad and public text long enough to key any message these tests produce.
const PAD = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(20);
const PUBLIC_TEXT = 'THEQUICKBROWNFOXJUMPSOVERTHELAZYDOG'.repeat(20);
const PAD_ID = 'pad:test';
const DOC_ID = 'doc:almanac' as DocId;

const keyLookup: CipherKeyLookup = {
  publicText: (id) => (id === DOC_ID ? PUBLIC_TEXT : undefined),
  pad: (id) => (id === PAD_ID ? PAD : undefined),
};

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
};

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

const ALL_CIPHERS = ['caesar', 'vigenere', 'columnar', 'book', 'otp'] as const;

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
// Arbitraries
// ---------------------------------------------------------------------------

const ERA_OWNERS = [
  'hostile',
  'diplomatic',
  'commercial',
  'criminal',
  'station',
] as const;
type EraOwner = (typeof ERA_OWNERS)[number];

/** A non-negative integer weight (small range keeps the search focused). */
const weight = fc.nat({ max: 6 });

/** A partial per-owner weight table over the five slice cipher kinds. */
const ownerWeightTable = fc.record({
  caesar: weight,
  vigenere: weight,
  columnar: weight,
  book: weight,
  otp: weight,
});

/**
 * An arbitrary, schema-valid `CipherConventions`. The generated owner tables
 * are constrained so the engine always has *some* usable kind to draw: at least
 * one of the era owners every engine owner maps onto carries a positive weight
 * on a key-material-free kind (caesar/vigenere/columnar), so no owner can be
 * starved regardless of the random weights. Pad/numbers formats and the header
 * list range freely within their schemas.
 *
 * The mapping (see `conventionWeightsFor`): engine `hostile`/`cell` → era
 * `hostile`; `station` → era `station`; `noise` → era `commercial`+`criminal`.
 * Giving `hostile`, `station`, `commercial` and `criminal` a guaranteed
 * positive hand-cipher weight covers all four engine owners.
 */
function conventionsArb(): fc.Arbitrary<CipherConventions> {
  const guaranteedHand = fc.constantFrom<'caesar' | 'vigenere' | 'columnar'>(
    'caesar',
    'vigenere',
    'columnar',
  );
  return fc
    .record({
      ownerWeights: fc.record(
        Object.fromEntries(
          ERA_OWNERS.map((o) => [o, ownerWeightTable]),
        ) as Record<EraOwner, typeof ownerWeightTable>,
      ),
      headers: fc.uniqueArray(
        fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
        { minLength: 1, maxLength: 5 },
      ),
      padFormat: fc.record({
        groupSize: fc.constant(5 as const),
        groupsPerLine: fc.integer({ min: 1, max: 12 }),
      }),
      numbersFormat: fc.record({
        callup: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
        groups: fc.integer({ min: 1, max: 100 }),
        repeat: fc.integer({ min: 1, max: 4 }),
      }),
      // One hand-cipher kind each owner is guaranteed to be able to draw.
      floorKind: guaranteedHand,
    })
    .map(({ floorKind, ...rest }) => {
      const ow = rest.ownerWeights as Record<
        EraOwner,
        Record<(typeof ALL_CIPHERS)[number], number>
      >;
      // Floor the hand-cipher weight for every era owner an engine owner reaches
      // (all of them except diplomatic, which no engine owner maps onto).
      for (const o of ['hostile', 'station', 'commercial', 'criminal'] as const) {
        ow[o] = { ...ow[o], [floorKind]: Math.max(ow[o][floorKind], 1) };
      }
      return rest as unknown as CipherConventions;
    });
}

const ownerKindArb = fc.constantFrom<InterceptOwnerKind>(
  ...INTERCEPT_OWNER_KINDS,
);

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

describe('Property 15 — cipher conventions applied (Req 5.6)', () => {
  it('claim 1: every Intercept draws a kind with positive convention weight for its owner', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        conventionsArb(),
        fc.array(ownerKindArb, { minLength: 1, maxLength: 4 }),
        (seed, conventions, ownerKinds) => {
          const txs = ownerKinds.map((ownerKind, i) =>
            source(`tx-${i}`, { ownerKind }),
          );
          const { intercepts } = generateIntercepts(
            createPrng(seed),
            txs,
            inputs({ cipherConventions: conventions }),
          );

          for (const tx of txs) {
            const intercept = intercepts[interceptIdOf(tx.id)];
            // Resolve against the source's own owner weights.
            const weights = conventionWeightsFor(tx.ownerKind, conventions);
            const kind = revealedSpec(intercept).kind;
            // The drawn kind has a positive owner weight — unless the owner's
            // positive-weight kinds are all key-material-starved (book with no
            // public text / otp with no pad), in which case the generator may
            // fall back. Here both pools are non-empty, so no fallback applies
            // and the kind must carry a positive weight.
            expect(weights[kind]).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('claim 2: any header present is drawn from the convention header list, never the default', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        conventionsArb(),
        fc.array(ownerKindArb, { minLength: 1, maxLength: 4 }),
        (seed, conventions, ownerKinds) => {
          // Force an error on every eligible Intercept so headers surface.
          const txs = ownerKinds.map((ownerKind, i) =>
            source(`tx-${i}`, { ownerKind }),
          );
          const { intercepts } = generateIntercepts(
            createPrng(seed),
            txs,
            inputs({
              cipherConventions: conventions,
              tradecraftErrorProbability: 1,
            }),
          );

          const headerSet = new Set(conventions.headers);
          for (const intercept of Object.values(intercepts)) {
            const err = intercept.tradecraftError;
            if (err?.kind === 'fixed-header') {
              expect(headerSet.has(err.header)).toBe(true);
              expect(err.header).toBe(intercept.meta.header);
              // The built-in default is never used when conventions are loaded
              // (unless it happens to also be a convention header — the
              // generated header list excludes it in practice, but the
              // membership check above is the real guarantee).
              if (!headerSet.has(FIXED_HEADER_CRIB)) {
                expect(err.header).not.toBe(FIXED_HEADER_CRIB);
              }
            }
            if (intercept.meta.header !== undefined) {
              expect(headerSet.has(intercept.meta.header)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('claim 3: arbitrary pad/numbers formats are inert — generation is unchanged by them', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        conventionsArb(),
        fc.record({
          groupSize: fc.constant(5 as const),
          groupsPerLine: fc.integer({ min: 1, max: 12 }),
        }),
        fc.record({
          callup: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
          groups: fc.integer({ min: 1, max: 100 }),
          repeat: fc.integer({ min: 1, max: 4 }),
        }),
        (seed, conventions, padFormat, numbersFormat) => {
          const txs = [
            source('tx-1', { ownerKind: 'hostile' }),
            source('tx-2', { ownerKind: 'noise' }),
            source('tx-3', { ownerKind: 'station' }),
          ];
          const base = generateIntercepts(
            createPrng(seed),
            txs,
            inputs({
              cipherConventions: conventions,
              tradecraftErrorProbability: 0.5,
            }),
          );
          // Same conventions but with the pad/numbers formats swapped out.
          const swapped = generateIntercepts(
            createPrng(seed),
            txs,
            inputs({
              cipherConventions: { ...conventions, padFormat, numbersFormat },
              tradecraftErrorProbability: 0.5,
            }),
          );
          // The group formats drive presentation only; they must not change the
          // generated Intercepts (kinds, ciphertext, headers, order).
          expect(swapped).toEqual(base);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('claim 4: decrypting with the true spec and parsing recovers the source Propositions', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        conventionsArb(),
        fc.array(ownerKindArb, { minLength: 1, maxLength: 4 }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (seed, conventions, ownerKinds, errorP) => {
          const txs = ownerKinds.map((ownerKind, i) =>
            source(`tx-${i}`, { ownerKind }),
          );
          const { intercepts } = generateIntercepts(
            createPrng(seed),
            txs,
            inputs({
              cipherConventions: conventions,
              tradecraftErrorProbability: errorP,
            }),
          );

          for (const intercept of Object.values(intercepts)) {
            const recovered = parseFieldMessage(
              privateFieldMessage(intercept),
              fieldCodes,
            );
            // Every source carries props(0): MEETS_AT then USES_CHANNEL.
            expect(recovered.map((p) => p.predicate)).toEqual([
              'MEETS_AT',
              'USES_CHANNEL',
            ]);
            expect(recovered.map((p) => p.subject)).toEqual([
              'npc:ana',
              'npc:boris',
            ]);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
