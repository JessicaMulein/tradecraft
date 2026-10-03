/**
 * Property 25 — Predicate-derived round-trip.
 *
 * > For any generated valid predicate definition set and any well-typed
 * > Proposition over it, `parseFieldMessage(encodePropositions([p]))` equals
 * > `[p]`, and the derived extractor schema accepts the Proposition's claim
 * > form.
 * >
 * > *Validates: Requirements 32.3, 7.2*
 *
 * This is the formal Property 25 version of the field-message round-trip. It
 * complements `field-message.spec.ts`, which pins the grammar with worked
 * examples and runs a round-trip over a *hand-built* field-code map. Here the
 * round-trip is driven by the **real compiled predicate registry** of the core
 * pack: `loadContent([CORE_DIR], ['core'])` → `content.predicates`, whose
 * `fieldCodes` map is what the Cipher Engine actually keys messages on. The
 * Propositions are not drawn from an arbitrary shape — they are generated
 * *from the actual predicate definitions*, so every one is well-typed over the
 * vocabulary (Requirement 7.2: Propositions use only the Predicate Vocabulary
 * and the Entity Registry id namespaces):
 *
 * - the `predicate` is a real registry id (`MEETS_AT`, …);
 * - the `subject` is an entity id of a kind the predicate's `subject` rule
 *   allows (`npc` / `unk` / `org`);
 * - the `object` is an entity id of an allowed entity kind, or a literal of the
 *   predicate's declared literal kind (`text` / `amount` / `time`);
 * - a `place` is present exactly as the predicate's `place` rule demands
 *   (`required` always, `optional` sometimes, `none` never) and is a `loc:` id;
 * - a `window` is present exactly as the predicate's `window` rule demands.
 *
 * The round-trip assertion is that `parseFieldMessage(encodePropositions(props,
 * registry), registry)` deep-equals `props`, modulo the one reconstruction the
 * field message documents: the Sim-internal `id` is not carried on the wire and
 * is rebuilt as `fm:<line index>` (see `field-message.ts`). Every other field —
 * subject, predicate, object (entity or literal, exact text/amount/time), place
 * and window — survives exactly.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadContent,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';

import type {
  EntityId,
  GameTime,
  Literal,
  LocId,
  Proposition,
  TimeWindow,
} from '../model/core.js';

import { encodePropositions, parseFieldMessage } from './field-message.js';

// ---------------------------------------------------------------------------
// The real compiled core predicate registry
// ---------------------------------------------------------------------------

// `src/lib/cipher` → up four to `packages/`, then into the core pack. This is
// the same relative hop the city specs use to reach the authored content.
const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCoreRegistry(): PredicateRegistry {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return content.value.predicates;
}

const registry = loadCoreRegistry();

// ---------------------------------------------------------------------------
// Entity-id generators, one per predicate entity kind
// ---------------------------------------------------------------------------

// A valid Entity Registry local part: a url-safe run that must *begin* with an
// alphanumeric (`isEntityId` in `core.ts` rejects a leading `_` or `-`). Keeping
// the generator inside this grammar is exactly Req 7.2 — a Proposition only
// carries ids that are real Entity Registry ids.
const localPart = fc
  .tuple(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(
        '',
      ),
    ),
    fc.string({
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(
          '',
        ),
      ),
      minLength: 0,
      maxLength: 9,
    }),
  )
  .map(([head, tail]) => `${head}${tail}`);

/**
 * A generator for an entity id of the given predicate entity kind. `npc` and
 * `org` take a url-safe local part; `unk` is `unk:<non-negative integer>` — the
 * only namespace whose local part is a plain number (see `core.ts`).
 */
function entityIdArbForKind(kind: 'npc' | 'unk' | 'org'): fc.Arbitrary<EntityId> {
  if (kind === 'unk') {
    return fc.nat({ max: 100_000 }).map((n) => `unk:${n}` as EntityId);
  }
  return localPart.map((local) => `${kind}:${local}` as EntityId);
}

const locIdArb: fc.Arbitrary<LocId> = localPart.map(
  (local) => `loc:${local}` as LocId,
);

const gameTimeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.nat({ max: 400 }),
  phase: fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<0 | 1 | 2 | 3>,
});

// Text covering every grammar-significant character: spaces, newlines, tabs,
// carriage returns, backslashes and the sigils themselves — the escaping must
// carry all of these through the one-line, space-separated wire form.
const textArb = fc.string({
  unit: fc.constantFrom(
    ...'abcdefghijkABCDEFG0123456789@~=:.\\/'.split(''),
    ' ',
    '\n',
    '\r',
    '\t',
  ),
  minLength: 0,
  maxLength: 24,
});

const amountArb: fc.Arbitrary<number> = fc
  .oneof(
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  )
  // `-0` serialises as "0" and parses back to `+0`; `toEqual` distinguishes the
  // two and the Sim never carries a signed-zero amount, so drop it.
  .filter((value) => !Object.is(value, -0));

/** A literal generator for the predicate's declared literal kind. */
function literalArbForKind(
  kind: 'text' | 'amount' | 'time',
): fc.Arbitrary<Literal> {
  switch (kind) {
    case 'text':
      return textArb.map((value) => ({ kind: 'text', value }));
    case 'amount':
      return amountArb.map((value) => ({ kind: 'amount', value }));
    case 'time':
      return gameTimeArb.map((value) => ({ kind: 'time', value }));
  }
}

// ---------------------------------------------------------------------------
// Proposition generators, derived from each real predicate definition
// ---------------------------------------------------------------------------

/** The object generator a predicate's `object` rule prescribes. */
function objectArbFor(
  definition: PredicateDefinition,
): fc.Arbitrary<EntityId | Literal> {
  if ('literal' in definition.object) {
    return literalArbForKind(definition.object.literal);
  }
  // One of the allowed entity kinds, each with its namespace generator.
  return fc.oneof(
    ...definition.object.entity.map((kind) => entityIdArbForKind(kind)),
  );
}

/**
 * The place generator a predicate's `place` rule prescribes:
 * `required` → always a `loc:` id; `optional` → a `loc:` id or none;
 * `none` → never a place.
 */
function placeArbFor(
  definition: PredicateDefinition,
): fc.Arbitrary<LocId | undefined> {
  switch (definition.place) {
    case 'required':
      return locIdArb;
    case 'optional':
      return fc.option(locIdArb, { nil: undefined });
    case 'none':
      return fc.constant(undefined);
  }
}

const windowArb: fc.Arbitrary<TimeWindow> = fc.oneof(
  gameTimeArb.map((from) => ({ from })),
  fc
    .tuple(gameTimeArb, gameTimeArb)
    .map(([from, to]) => ({ from, to })),
);

/** The window generator a predicate's `window` rule prescribes. */
function windowArbFor(
  definition: PredicateDefinition,
): fc.Arbitrary<TimeWindow | undefined> {
  switch (definition.window) {
    case 'required':
      return windowArb;
    case 'optional':
      return fc.option(windowArb, { nil: undefined });
    case 'none':
      return fc.constant(undefined);
  }
}

/**
 * A generator for a well-typed Proposition over a single predicate definition.
 * The `id` is a placeholder: the field message does not carry it, so the
 * round-trip rebuilds it as `fm:<index>` and the assertion compares against the
 * rebuilt form.
 */
function propositionArbFor(
  definition: PredicateDefinition,
): fc.Arbitrary<Proposition> {
  return fc
    .record({
      subject: fc.oneof(
        ...definition.subject.map((kind) => entityIdArbForKind(kind)),
      ),
      object: objectArbFor(definition),
      place: placeArbFor(definition),
      window: windowArbFor(definition),
    })
    .map(({ subject, object, place, window }) => {
      const prop: Proposition = {
        id: 'minted',
        subject,
        predicate: definition.id,
        object,
        ...(place !== undefined ? { place } : {}),
        ...(window !== undefined ? { window } : {}),
      };
      return prop;
    });
}

/** The compiled definitions, in registry order. */
const definitions = registry.predicates.map((p) => p.definition);

/** A Proposition over *any* predicate in the vocabulary. */
const anyPropositionArb: fc.Arbitrary<Proposition> = fc.oneof(
  ...definitions.map((definition) => propositionArbFor(definition)),
);

/** Reconstruct the id the parser assigns the Proposition at line `index`. */
function withParsedId(prop: Proposition, index: number): Proposition {
  return { ...prop, id: `fm:${index}` };
}

// ---------------------------------------------------------------------------
// Property 25
// ---------------------------------------------------------------------------

describe('Property 25: Predicate-derived round-trip (Req 32.3, 7.2)', () => {
  it('exposes the whole core predicate vocabulary with field codes', () => {
    // Guard the premise: the generators are only meaningful if the real
    // registry actually loaded the vocabulary. Every predicate must have a
    // field code (that is what makes it encodable on the wire).
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(registry.fieldCodes.get(definition.id)).toBeTypeOf('string');
    }
  });

  it('round-trips a single well-typed Proposition for every predicate', () => {
    // Pin each predicate individually so a failure names the predicate, and so
    // every predicate in the vocabulary is exercised regardless of `oneof` luck.
    for (const definition of definitions) {
      fc.assert(
        fc.property(propositionArbFor(definition), (prop) => {
          const encoded = encodePropositions([prop], registry);
          const parsed = parseFieldMessage(encoded, registry);
          expect(parsed).toEqual([withParsedId(prop, 0)]);
        }),
        { numRuns: 200 },
      );
    }
  });

  it('round-trips a list of well-typed Propositions across the vocabulary', () => {
    fc.assert(
      fc.property(fc.array(anyPropositionArb, { maxLength: 8 }), (props) => {
        const encoded = encodePropositions(props, registry);
        const parsed = parseFieldMessage(encoded, registry);
        const expected = props.map((p, i) => withParsedId(p, i));
        expect(parsed).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips when driven by the bare fieldCodes map, not the whole registry', () => {
    // `field-message.ts` accepts either the registry or its `fieldCodes` map;
    // the real map must round-trip identically.
    fc.assert(
      fc.property(fc.array(anyPropositionArb, { maxLength: 8 }), (props) => {
        const encoded = encodePropositions(props, registry.fieldCodes);
        const parsed = parseFieldMessage(encoded, registry.fieldCodes);
        const expected = props.map((p, i) => withParsedId(p, i));
        expect(parsed).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('produces exactly one line per Proposition (no stray newlines)', () => {
    fc.assert(
      fc.property(
        fc.array(anyPropositionArb, { minLength: 1, maxLength: 8 }),
        (props) => {
          const encoded = encodePropositions(props, registry);
          expect(encoded.split('\n')).toHaveLength(props.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
