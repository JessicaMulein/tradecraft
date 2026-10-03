/**
 * The dedicated property-based test for **Property 9 — Intercept fidelity**
 * (design "Properties"; Requirements 9.1 and 9.5).
 *
 * > For any generated Intercept, decrypting it with its true cipher spec and
 * > parsing the recovered field message yields EXACTLY its source Propositions;
 * > and submitting the true key / plaintext verifies and returns those source
 * > Propositions, while a wrong submission is rejected and leaks nothing.
 *
 * Tasks 8.3 (intercept.spec.ts) and 8.4 (verify.spec.ts) already exercise
 * fidelity at a handful of fixed points. This file is the FORMAL property
 * version: it quantifies the round-trip and the verification contract over a
 * WIDE input space — arbitrary owner kinds, arbitrary allowed-cipher subsets,
 * arbitrary well-typed Proposition sets, and both tradecraft-error settings — so
 * fidelity is pinned universally rather than by example. Conceptual overlap with
 * the earlier files is deliberate; the test bodies are not copied.
 *
 * The fixtures mirror intercept.spec.ts: a hand-built field-code map, a radio
 * Channel, a key lookup with a pad and a public text long enough to key any
 * message, and `InterceptSource` arrays built from generated Propositions.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createPrng } from '../prng/prng.js';
import type {
  ChannelId,
  DocId,
  GameTime,
  Phase,
  Proposition,
} from '../model/core.js';
import type { Channel, ChannelKind } from '../city/comms.js';
import {
  resolveCipherSpec,
  type CipherKeyLookup,
  type CipherSpec,
  type KeySubmission,
} from './spec.js';
import {
  generateIntercepts,
  revealedSpec,
  decryptToFieldMessage,
  INTERCEPT_OWNER_KINDS,
  type GenerateInterceptsInputs,
  type Intercept,
  type InterceptOwnerKind,
  type InterceptSource,
} from './intercept.js';
import { parseFieldMessage, type FieldCodeLookup } from './field-message.js';
import { verifySubmission } from './verify.js';
import type { CipherKind } from './cipher.js';

// ---------------------------------------------------------------------------
// Fixtures (mirroring intercept.spec.ts)
// ---------------------------------------------------------------------------

/** The two predicates the field-code map knows, each with a unique code. */
const PREDICATES = ['MEETS_AT', 'USES_CHANNEL'] as const;

const fieldCodes: FieldCodeLookup = {
  fieldCodes: new Map<string, string>([
    ['MEETS_AT', 'MAT'],
    ['USES_CHANNEL', 'UCH'],
  ]),
};

// A pad and a public text long enough to key any message these tests produce.
const PAD = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(40);
const PUBLIC_TEXT = 'THEQUICKBROWNFOXJUMPSOVERTHELAZYDOG'.repeat(40);
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
};

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
// Arbitraries — a bounded, always-parseable proposition model
// ---------------------------------------------------------------------------

// Small entity-id pools, drawn from valid namespaces so every token tokenises
// cleanly (no spaces, no leading '=') and parses back as a valid entity id.
const SUBJECTS = ['npc:ana', 'npc:boris', 'npc:cyra', 'npc:dmitri'] as const;
const OBJECTS = ['npc:ana', 'npc:boris', 'chan:a', 'org:cell', 'loc:cafe'] as const;
const PLACES = ['loc:cafe', 'loc:park', 'loc:dock'] as const;

/** A bounded GameTime: non-negative integer day, phase in 0..3. */
const timeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 999 }),
  phase: fc.integer({ min: 0, max: 3 }).map((n) => n as Phase),
});

/** An optional half-open window; when closed, `to` is a second moment. */
const windowArb = fc.option(
  fc.oneof(
    timeArb.map((from) => ({ from })),
    fc.tuple(timeArb, timeArb).map(([from, to]) => ({ from, to })),
  ),
  { nil: undefined },
);

/**
 * One well-typed Proposition over the hand-built vocabulary. The predicate is
 * always one the field-code map knows, subject/object come from the small id
 * pools, and place/window are optional — so the encoded field message is always
 * parseable. The `id` is a stable source id, overwritten per-set below.
 */
function propArb(id: string): fc.Arbitrary<Proposition> {
  return fc.record({
    predicate: fc.constantFrom(...PREDICATES),
    subject: fc.constantFrom(...SUBJECTS),
    object: fc.constantFrom(...OBJECTS),
    place: fc.option(fc.constantFrom(...PLACES), { nil: undefined }),
    window: windowArb,
  }).map((parts) => {
    const prop: Proposition = {
      id,
      subject: parts.subject,
      predicate: parts.predicate,
      object: parts.object,
      ...(parts.place !== undefined ? { place: parts.place as Proposition['place'] } : {}),
      ...(parts.window !== undefined ? { window: parts.window } : {}),
    };
    return prop;
  });
}

/** A non-empty set of Propositions with distinct, position-stable source ids. */
const propsArb: fc.Arbitrary<Proposition[]> = fc
  .integer({ min: 1, max: 4 })
  .chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => propArb(`src:${i}`))),
  )
  .map((tuple) => [...tuple]);

/** A non-empty subset of the five cipher kinds, in the fixed order. */
const allowedCiphersArb: fc.Arbitrary<CipherKind[]> = fc
  .subarray([...ALL_CIPHERS], { minLength: 1 })
  .map((ks) => [...ks]);

const ownerArb: fc.Arbitrary<InterceptOwnerKind> = fc.constantFrom(
  ...INTERCEPT_OWNER_KINDS,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function source(
  id: string,
  propositions: readonly Proposition[],
  ownerKind: InterceptOwnerKind,
): InterceptSource {
  return {
    id,
    channel: 'chan:a' as ChannelId,
    at: { day: 1, phase: 2 },
    ownerKind,
    origin: 'plot',
    propositions,
  };
}

/** Generate a single Intercept from one source transmission. */
function makeIntercept(
  seed: string,
  propositions: readonly Proposition[],
  ownerKind: InterceptOwnerKind,
  inputOverrides: Partial<GenerateInterceptsInputs> = {},
): Intercept {
  const { intercepts, order } = generateIntercepts(
    createPrng(seed),
    [source('tx-1', propositions, ownerKind)],
    inputs(inputOverrides),
  );
  return intercepts[order[0]];
}

/** The content of a Proposition, with the Sim-internal id dropped. */
function content(prop: Proposition): Omit<Proposition, 'id'> {
  return {
    subject: prop.subject,
    predicate: prop.predicate,
    object: prop.object,
    ...(prop.place !== undefined ? { place: prop.place } : {}),
    ...(prop.window !== undefined ? { window: prop.window } : {}),
  };
}

/** The true recovered field message of an Intercept (crib stripped). */
function truePlaintext(intercept: Intercept): string {
  return decryptToFieldMessage(
    intercept,
    resolveCipherSpec(revealedSpec(intercept), keyLookup),
  );
}

// ---------------------------------------------------------------------------
// Property 9a — round-trip fidelity (Req 9.1)
// ---------------------------------------------------------------------------

describe('Property 9 — round-trip fidelity (Req 9.1)', () => {
  it('decrypt + parse recovers the source Propositions over a wide input space', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        ownerArb,
        allowedCiphersArb,
        propsArb,
        fc.boolean(),
        (seed, ownerKind, allowedCiphers, sourceProps, withError) => {
          const intercept = makeIntercept(seed, sourceProps, ownerKind, {
            allowedCiphers,
            // Both tradecraft-error extremes: 1 forces an error (fixed-header
            // crib stripped, or pad reuse), 0 forces none. Fidelity must hold
            // either way.
            tradecraftErrorProbability: withError ? 1 : 0,
          });

          const recovered = parseFieldMessage(
            truePlaintext(intercept),
            fieldCodes,
          );

          // The field message does not carry the Sim-internal id (parse rebuilds
          // it as fm:<line>); compare content only, in message order.
          expect(recovered.map(content)).toEqual(sourceProps.map(content));
          // The true source ids live on plaintextProps, aligned by position.
          expect([...intercept.plaintextProps]).toEqual(
            sourceProps.map((p) => p.id),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds for every cipher kind individually, with and without a tradecraft error', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.constantFrom(...ALL_CIPHERS),
        propsArb,
        fc.boolean(),
        (seed, cipher, sourceProps, withError) => {
          // Pin the owner so weighting cannot veto the single allowed kind:
          // 'noise'/'station' weight every kind positively, and the generator
          // falls back to the allowed set otherwise, so one-kind presets resolve
          // to exactly that kind.
          const intercept = makeIntercept(seed, sourceProps, 'noise', {
            allowedCiphers: [cipher],
            tradecraftErrorProbability: withError ? 1 : 0,
          });
          expect(revealedSpec(intercept).kind).toBe(cipher);

          const recovered = parseFieldMessage(
            truePlaintext(intercept),
            fieldCodes,
          );
          expect(recovered.map(content)).toEqual(sourceProps.map(content));
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9b — verifySubmission accepts the true key / plaintext (Req 9.5)
// ---------------------------------------------------------------------------

describe('Property 9 — verifySubmission accepts the truth (Req 9.5)', () => {
  it('the true key verifies and returns the source ids with matching content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        ownerArb,
        allowedCiphersArb,
        propsArb,
        fc.boolean(),
        (seed, ownerKind, allowedCiphers, sourceProps, withError) => {
          const intercept = makeIntercept(seed, sourceProps, ownerKind, {
            allowedCiphers,
            tradecraftErrorProbability: withError ? 1 : 0,
          });

          const submission: KeySubmission = {
            kind: 'key',
            spec: revealedSpec(intercept),
          };
          const result = verifySubmission(
            intercept,
            submission,
            keyLookup,
            fieldCodes,
          );

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }
          // Returned Propositions carry the Intercept's true source ids...
          expect(result.propositions.map((p) => p.id)).toEqual(
            sourceProps.map((p) => p.id),
          );
          // ...and the source content.
          expect(result.propositions.map(content)).toEqual(
            sourceProps.map(content),
          );
        },
      ),
      { numRuns: 80 },
    );
  });

  it('the true plaintext also verifies', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        ownerArb,
        propsArb,
        fc.boolean(),
        (seed, ownerKind, sourceProps, withError) => {
          const intercept = makeIntercept(seed, sourceProps, ownerKind, {
            tradecraftErrorProbability: withError ? 1 : 0,
          });
          const result = verifySubmission(
            intercept,
            { kind: 'plaintext', text: truePlaintext(intercept) },
            keyLookup,
            fieldCodes,
          );
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.propositions.map((p) => p.id)).toEqual(
              sourceProps.map((p) => p.id),
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9c — rejection leaks nothing (Req 9.5)
// ---------------------------------------------------------------------------

describe('Property 9 — a wrong submission is rejected and leaks nothing (Req 9.5)', () => {
  it('an arbitrary wrong key returns exactly { ok: false }', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        propsArb,
        fc.integer({ min: 1, max: 25 }),
        (seed, sourceProps, delta) => {
          // Force a caesar Intercept so a definitely-wrong shift is nameable.
          const intercept = makeIntercept(seed, sourceProps, 'noise', {
            allowedCiphers: ['caesar'],
          });
          const trueSpec = revealedSpec(intercept);
          const trueShift = trueSpec.kind === 'caesar' ? trueSpec.shift : 0;
          const wrongShift = ((trueShift + delta - 1) % 26) + 1;
          // Skip the vanishingly unlikely collision back onto the true shift.
          if (wrongShift % 26 === trueShift % 26) {
            return;
          }
          const wrong: CipherSpec = { kind: 'caesar', shift: wrongShift };
          const result = verifySubmission(
            intercept,
            { kind: 'key', spec: wrong },
            keyLookup,
            fieldCodes,
          );
          expect(result).toEqual({ ok: false });
          // No spec, plaintext or propositions ride along.
          expect(Object.keys(result)).toEqual(['ok']);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('an arbitrary wrong vigenere keyword is rejected without leaking', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        propsArb,
        fc
          .array(fc.integer({ min: 0, max: 25 }), { minLength: 4, maxLength: 7 })
          .map((codes) =>
            codes.map((c) => String.fromCharCode(65 + c)).join(''),
          ),
        (seed, sourceProps, keyword) => {
          const intercept = makeIntercept(seed, sourceProps, 'noise', {
            allowedCiphers: ['vigenere'],
          });
          const trueSpec = revealedSpec(intercept);
          const trueKey = trueSpec.kind === 'vigenere' ? trueSpec.key : '';
          // Skip the (rare) case the drawn keyword equals the true one.
          if (keyword === trueKey) {
            return;
          }
          const result = verifySubmission(
            intercept,
            { kind: 'key', spec: { kind: 'vigenere', key: keyword } },
            keyLookup,
            fieldCodes,
          );
          expect(result).toEqual({ ok: false });
        },
      ),
      { numRuns: 80 },
    );
  });

  it('an arbitrary wrong plaintext (truth + non-empty suffix) is rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        ownerArb,
        propsArb,
        fc.string({ minLength: 1, maxLength: 8 }),
        (seed, ownerKind, sourceProps, suffix) => {
          const intercept = makeIntercept(seed, sourceProps, ownerKind);
          const result = verifySubmission(
            intercept,
            { kind: 'plaintext', text: truePlaintext(intercept) + suffix },
            keyLookup,
            fieldCodes,
          );
          // Any non-empty suffix makes it a different, wrong plaintext.
          expect(result).toEqual({ ok: false });
          expect(Object.keys(result)).toEqual(['ok']);
        },
      ),
      { numRuns: 60 },
    );
  });
});
