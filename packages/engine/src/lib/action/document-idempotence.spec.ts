/**
 * Property 22 — Document reading idempotence (dedicated formal version; task
 * 9.3; Requirement 30.4).
 *
 * The design states Property 22 as: for any state and Document, reading it twice
 * yields the same Case File as reading it once, and the added Claims are exactly
 * the Document's asserted Propositions with source `document`. Equivalently, in
 * terms of the read action's surfaces:
 *
 * - the FIRST `resolveRead` seeds the Case File with the Document's asserted
 *   Propositions (as `document`-sourced Claims): its `claimsAdded` is exactly
 *   the Document's `asserts` filtered to those with a stored Proposition, with a
 *   `proposition` Observation for each;
 * - every SUBSEQUENT read adds NO new Claims and changes nothing: `claimsAdded`
 *   is empty, no new `proposition` Observations appear, and
 *   `player.readDocuments` does not grow;
 * - the player's read-tracking (`markDocumentRead`/`hasReadDocument` on
 *   `player.readDocuments`) is monotonic and duplicate-free;
 * - applying the engine-reported reads in sequence into a Case File adds the
 *   Document's Propositions exactly once (the player-view consequence).
 *
 * `read.spec.ts` (task 9.2) already covers idempotence by example; this is the
 * NEW dedicated Property-22 file, driving the real generated world through
 * fast-check. Test-only — it touches no production code.
 *
 * The player-view consequence (point 3) is modelled WITHOUT importing the
 * `player-view` package: the engine package depends only on `@tradecraft/content`
 * (see its manifest and the import-boundary rules), so a cross-package import
 * would break the dependency checks. The {@link recordDocumentClaims} stand-in
 * below mirrors `addDocumentClaims`'s only contract that matters here — it
 * records exactly the Propositions it is handed, once per call — so sequencing
 * the engine-reported reads through it reproduces the Case File side of
 * Property 22 faithfully.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import type { DocId, PropId, Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { resolve } from './action.js';
import {
  hasReadDocument,
  markDocumentRead,
  resolveRead,
} from './read.js';
import type { ReadAction } from './types.js';
import type { Observation, ResolverContext } from './result.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors read.spec.ts / travel.spec.ts)
// ---------------------------------------------------------------------------

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

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

const CTX: ResolverContext = { content };

function world(seed = 'doc-idem'): WorldState {
  return generate(seed, inputs());
}

/** Every Location open in the current phase, so the obtainable gate is moot. */
function allOpen(state: WorldState): WorldState {
  const locations = Object.fromEntries(
    Object.entries(state.city.locations).map(([id, loc]) => [
      id,
      { ...loc, hours: { 0: true, 1: true, 2: true, 3: true } },
    ]),
  );
  return { ...state, city: { ...state.city, locations } };
}

/**
 * The ids of Documents that are in hand (no `obtainableAt`) and assert at least
 * one stored Proposition — the brief Cable and the Dossiers. These are the ones
 * a first read actually seeds Claims from, so Property 22 has teeth on them.
 */
function inHandDocIds(state: WorldState): DocId[] {
  return Object.values(state.documents)
    .filter(
      (d) =>
        (d.obtainableAt === undefined || d.obtainableAt.length === 0) &&
        d.asserts.some((id) => state.documentPropositions[id] !== undefined),
    )
    .map((d) => d.id);
}

/** The stored Propositions a Document asserts, in `asserts` order. */
function assertedPropIds(state: WorldState, doc: DocId): PropId[] {
  const d = state.documents[doc];
  if (d === undefined) {
    return [];
  }
  return d.asserts.filter((id) => state.documentPropositions[id] !== undefined);
}

/** The number of `proposition` Observations in a result. */
function propObsCount(observations: readonly Observation[]): number {
  return observations.filter((o) => o.kind === 'proposition').length;
}

/** No-op render callback — Fact Line text is not what Property 22 is about. */
const NO_RENDER = (): string[] => [];

const BASE = allOpen(world());
const DOC_IDS = inHandDocIds(BASE);

// A sanity guard so the suite fails loudly if the brief ever stops carrying a
// readable Document that asserts Propositions (otherwise every property below
// would vacuously pass).
describe('Property 22 fixtures', () => {
  it('the generated world has in-hand Documents that assert Propositions', () => {
    expect(DOC_IDS.length).toBeGreaterThan(0);
    for (const id of DOC_IDS) {
      expect(assertedPropIds(BASE, id).length).toBeGreaterThan(0);
    }
  });
});

/** An arbitrary in-hand Document id drawn from the generated world. */
const docIdArb = fc.constantFrom(...DOC_IDS);

// ---------------------------------------------------------------------------
// 1. First read seeds exactly the asserted Propositions (Req 30.4 setup)
// ---------------------------------------------------------------------------

describe('Property 22 — first read seeds exactly the asserted Propositions', () => {
  it('claimsAdded equals the Document asserts (stored) with a proposition Observation each', () => {
    fc.assert(
      fc.property(docIdArb, (doc) => {
        const action: ReadAction = { kind: 'read', doc };
        const { result } = resolveRead(BASE, action, createPrng('seed'), NO_RENDER);

        const expected = assertedPropIds(BASE, doc);
        expect(result.claimsAdded).toEqual(expected);
        // One `proposition` Observation per asserted Proposition, each stamped
        // at the current time; nothing else on a first read.
        const propObs = result.observations.filter((o) => o.kind === 'proposition');
        expect(propObs).toHaveLength(expected.length);
        for (const obs of propObs) {
          if (obs.kind === 'proposition') {
            expect(obs.at).toEqual(BASE.time);
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotence (Property 22 core): only the first read ever contributes
// ---------------------------------------------------------------------------

describe('Property 22 — reading again is idempotent', () => {
  it('the second read adds no claims, no proposition Observations, and does not grow readDocuments', () => {
    fc.assert(
      fc.property(docIdArb, (doc) => {
        const action: ReadAction = { kind: 'read', doc };
        const first = resolveRead(BASE, action, createPrng('a'), NO_RENDER);
        expect(first.result.claimsAdded.length).toBeGreaterThan(0);

        const second = resolveRead(first.next, action, createPrng('a'), NO_RENDER);
        expect(second.result.claimsAdded).toEqual([]);
        expect(propObsCount(second.result.observations)).toBe(0);
        // readDocuments does not grow and carries the Document exactly once.
        expect(second.next.player.readDocuments).toEqual(first.next.player.readDocuments);
        expect(
          second.next.player.readDocuments.filter((id) => id === doc),
        ).toHaveLength(1);
      }),
      { numRuns: 40 },
    );
  });

  it('over N repeat reads, only the first ever contributes claimsAdded', () => {
    fc.assert(
      fc.property(
        docIdArb,
        fc.integer({ min: 2, max: 5 }),
        (doc, repeats) => {
          const action: ReadAction = { kind: 'read', doc };
          let state = BASE;
          const contributed: PropId[][] = [];
          for (let i = 0; i < repeats; i += 1) {
            const step = resolveRead(state, action, createPrng('r'), NO_RENDER);
            contributed.push([...step.result.claimsAdded] as PropId[]);
            state = step.next;
          }
          // Exactly the first read contributes; every later read is empty.
          expect(contributed[0]).toEqual(assertedPropIds(BASE, doc));
          for (let i = 1; i < contributed.length; i += 1) {
            expect(contributed[i]).toEqual([]);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('resolveRead applied twice equals once: the state after the first read is a fixed point', () => {
    fc.assert(
      fc.property(docIdArb, (doc) => {
        const action: ReadAction = { kind: 'read', doc };
        const once = resolveRead(BASE, action, createPrng('f'), NO_RENDER).next;
        const twice = resolveRead(once, action, createPrng('f'), NO_RENDER).next;
        // The read-tracking (the only state a read touches) is identical.
        expect(twice.player.readDocuments).toEqual(once.player.readDocuments);
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Player-view idempotence: the Document's Propositions file exactly once
// ---------------------------------------------------------------------------

/**
 * A minimal stand-in for the player-view `addDocumentClaims`: it records exactly
 * the Propositions it is handed, one Claim per Proposition, appending to a
 * running list. This mirrors the real helper's only Property-22-relevant
 * behaviour (it dedupes nothing itself — idempotence comes from the engine
 * reporting Propositions only on the first read). We model it here rather than
 * importing `player-view` so the engine package's dependency boundary stays
 * intact.
 */
function recordDocumentClaims(
  caseFile: Proposition[],
  propositions: readonly Proposition[],
): void {
  caseFile.push(...propositions);
}

/** Resolve a Document's asserted PropIds to their stored Propositions. */
function assertedProps(state: WorldState, doc: DocId): Proposition[] {
  return assertedPropIds(state, doc).map((id) => state.documentPropositions[id]);
}

describe('Property 22 — player-view files the Document Propositions exactly once', () => {
  it('sequencing the engine-reported reads adds the Document Propositions once', () => {
    fc.assert(
      fc.property(
        docIdArb,
        fc.integer({ min: 2, max: 5 }),
        (doc, repeats) => {
          const action: ReadAction = { kind: 'read', doc };
          const caseFile: Proposition[] = [];
          let state = BASE;
          for (let i = 0; i < repeats; i += 1) {
            const step = resolveRead(state, action, createPrng('p'), NO_RENDER);
            // The engine reports Propositions only on the first read; the view
            // records whatever it is handed, so later reads contribute nothing.
            const reported = step.result.observations.flatMap((o) =>
              o.kind === 'proposition' ? [o.prop] : [],
            );
            recordDocumentClaims(caseFile, reported);
            state = step.next;
          }
          // The Case File holds the Document's Propositions exactly once.
          const expected = assertedProps(BASE, doc);
          expect(caseFile).toEqual(expected);
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. read-tracking is monotonic + idempotent + duplicate-free
// ---------------------------------------------------------------------------

describe('Property 22 — markDocumentRead is idempotent and duplicate-free', () => {
  it('marking a Document twice equals marking it once; hasReadDocument then holds', () => {
    fc.assert(
      fc.property(docIdArb, (doc) => {
        const once = markDocumentRead(BASE, doc);
        const twice = markDocumentRead(once, doc);
        expect(hasReadDocument(once, doc)).toBe(true);
        expect(twice.player.readDocuments).toEqual(once.player.readDocuments);
        expect(
          twice.player.readDocuments.filter((id) => id === doc),
        ).toHaveLength(1);
      }),
      { numRuns: 40 },
    );
  });

  it('over an arbitrary sequence of reads, each Document appears at most once', () => {
    fc.assert(
      fc.property(
        fc.array(docIdArb, { minLength: 1, maxLength: 12 }),
        (sequence) => {
          let state = BASE;
          for (const doc of sequence) {
            state = markDocumentRead(state, doc);
          }
          const read = state.player.readDocuments;
          // No duplicates: the set size equals the array length.
          expect(new Set(read).size).toBe(read.length);
          // Every Document that was marked is present (monotonic growth).
          for (const doc of new Set(sequence)) {
            expect(read).toContain(doc);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism: resolveRead gives the same result for the same inputs
// ---------------------------------------------------------------------------

describe('Property 22 — resolveRead is deterministic', () => {
  it('the same inputs give the same claimsAdded and next read-tracking', () => {
    fc.assert(
      fc.property(docIdArb, (doc) => {
        const action: ReadAction = { kind: 'read', doc };
        // Different PRNG seeds must not change anything — the read draws nothing.
        const a = resolveRead(BASE, action, createPrng('x'), NO_RENDER);
        const b = resolveRead(BASE, action, createPrng('y'), NO_RENDER);
        expect(a.result.claimsAdded).toEqual(b.result.claimsAdded);
        expect(a.next.player.readDocuments).toEqual(b.next.player.readDocuments);

        // The top-level `resolve` route agrees with `resolveRead` on claimsAdded.
        const viaResolve = resolve(BASE, action, createPrng('z'), CTX);
        expect(viaResolve.result.claimsAdded).toEqual(a.result.claimsAdded);
      }),
      { numRuns: 40 },
    );
  });
});
