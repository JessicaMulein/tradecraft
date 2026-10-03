import fc from 'fast-check';

import {
  compilePredicateRegistry,
  type EvaluatorKind,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import {
  TruthStore,
  type EntityId,
  type GameTime,
  type NpcId,
  type Proposition,
} from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { evaluateExtraction, type SpeakerKnowledge } from './extractor.js';
import { buildExtractionSchema, type ExtractionResult } from './schema.js';

/**
 * Property 4: Model outputs cannot write facts.
 *
 * "For any state and action, replacing the voice and extractor outputs with
 * arbitrary fuzzed strings and schema-valid fuzzed Claims leaves the Truth
 * Store's fact set identical. Only the classified Intent enum may influence Sim
 * transitions." (design.md, Correctness Properties; Validates: Requirements
 * 2.3, 2.4.)
 *
 * The Claim Extractor is the one place a model's free text crosses into typed
 * data the Sim evaluates. Its pure core, {@link evaluateExtraction}, is where
 * that crossing happens: it takes a schema-valid {@link ExtractionResult} — the
 * model's output, standing in for "the extractor output" of the property — and
 * runs it against the Truth Store. The one and only thing it is allowed to
 * write to the store is a {@link import('@tradecraft/engine').ClaimTruthRecord}
 * per Claim: claim-truth bookkeeping, which is *not* a ground-truth fact. It
 * must never create, modify or delete a fact (Requirements 2.3, 2.4): a model
 * only produces Claims (view-safe Case File data), Intents and utterances.
 *
 * This test fuzzes the extractor output across the whole input space the schema
 * admits and asserts the two faces of "the fact set is identical":
 *
 *   1. `snapshot().facts` — the ground-truth fact list — is byte-identical
 *      before and after evaluation. No fact is added, removed or changed.
 *   2. `holds` returns the same verdict before and after on a fixed probe set
 *      of Propositions (the seeded facts plus Propositions drawn from the
 *      model's own Claims). Even for a Proposition the model just "asserted",
 *      whether it *holds* is decided only by the pre-existing facts, never by
 *      the assertion.
 *
 * It also asserts the *only* growth is in the claim-truth list — one record per
 * Claim — so the single permitted write is exactly the bookkeeping write and
 * nothing more. Allegiances and identities are left untouched.
 *
 * The Claims are generated through the real predicate-derived schema
 * ({@link buildExtractionSchema}) and parsed, so every input is a Claim the Sim
 * genuinely recognises — the strongest adversary, not a malformed one the
 * schema would reject anyway.
 */

// ---------------------------------------------------------------------------
// Fixtures: a fixed small predicate set (as extractor.spec.ts uses)
// ---------------------------------------------------------------------------

const meetsAt: PredicateDefinition = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match-symmetric',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

const worksFor: PredicateDefinition = {
  id: 'WORKS_FOR',
  subject: ['npc', 'unk'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'WF',
  render: {
    second: 'You work for {object}.',
    third: '{subject} works for {object}.',
  },
  extractorHint: 'A person works for an organisation.',
};

function registry(): PredicateRegistry {
  const result = compilePredicateRegistry([meetsAt, worksFor]);
  if (!result.ok) throw new Error('fixture predicates must compile');
  return result.registry;
}

const reg = registry();
const schema = buildExtractionSchema(reg);

const KINDS: Record<string, EvaluatorKind> = {
  MEETS_AT: 'fact-match-symmetric',
  WORKS_FOR: 'fact-match',
};

function evaluatorLookup(): Map<string, EvaluatorKind> {
  return new Map(Object.entries(KINDS));
}

const AT: GameTime = { day: 3, phase: 1 };

// A small fixed universe of entity ids the generators draw from, so a fuzzed
// Claim can line up with a seeded fact (and so sometimes genuinely hold).
const NPCS = ['npc:ana', 'npc:viktor', 'npc:greta'] as const;
const ORGS = ['org:cell', 'org:station', 'org:hostile'] as const;
const PLACES = ['loc:pier', 'loc:cafe', 'loc:market'] as const;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const npcArb = fc.constantFrom(...NPCS);
const orgArb = fc.constantFrom(...ORGS);
const placeArb = fc.constantFrom(...PLACES);
const windowArb: fc.Arbitrary<ExtractionResult['claims'][number]['when']> = fc
  .integer({ min: 0, max: 5 })
  .map((day) => ({ from: { day, phase: 0 as const } }));

/** A schema-valid WORKS_FOR Claim. */
const worksForClaimArb = fc.record({
  predicate: fc.constant('WORKS_FOR' as const),
  subject: npcArb,
  object: orgArb,
  hedged: fc.boolean(),
});

/** A schema-valid MEETS_AT Claim (place + window required). */
const meetsAtClaimArb = fc.record({
  predicate: fc.constant('MEETS_AT' as const),
  subject: npcArb,
  object: fc.oneof(npcArb, fc.constant('unknown')),
  place: placeArb,
  when: windowArb,
  hedged: fc.boolean(),
});

/** An arbitrary extractor output: a bounded list of schema-valid Claims. */
const extractionResultArb: fc.Arbitrary<ExtractionResult> = fc
  .array(fc.oneof(worksForClaimArb, meetsAtClaimArb), { minLength: 0, maxLength: 8 })
  .map((claims) => ({ claims }) as unknown as ExtractionResult);

/** An arbitrary seed fact for the store (so there is real ground truth to protect). */
const seedWorksFor = fc.record({ subject: npcArb, object: orgArb });
const seedMeetsAt = fc.record({ subject: npcArb, object: npcArb, place: placeArb });

const seedFactsArb = fc.record({
  worksFor: fc.array(seedWorksFor, { maxLength: 4 }),
  meetsAt: fc.array(seedMeetsAt, { maxLength: 4 }),
});

/** An arbitrary speaker knowledge, so belief/lie classification varies too. */
const knowledgeArb: fc.Arbitrary<SpeakerKnowledge> = fc.record({
  known: fc.array(seedWorksFor, { maxLength: 3 }).map((xs) =>
    xs.map(
      (x, i): Proposition => ({
        id: `k:${i}`,
        subject: x.subject as EntityId,
        predicate: 'WORKS_FOR',
        object: x.object as EntityId,
      }),
    ),
  ),
  falseBeliefs: fc.constant([]),
  promote: fc.constant([]),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedStore(seed: {
  worksFor: readonly { subject: string; object: string }[];
  meetsAt: readonly { subject: string; object: string; place: string }[];
}): TruthStore {
  const store = TruthStore.create(evaluatorLookup());
  seed.worksFor.forEach((f, i) => {
    store.addFact({
      id: `fw:${i}`,
      subject: f.subject as EntityId,
      predicate: 'WORKS_FOR',
      object: f.object as EntityId,
    });
  });
  seed.meetsAt.forEach((f, i) => {
    store.addFact({
      id: `fm:${i}`,
      subject: f.subject as EntityId,
      predicate: 'MEETS_AT',
      object: f.object as EntityId,
      place: f.place as Proposition['place'],
      window: { from: { day: 0, phase: 0 } },
    });
  });
  return store;
}

/** Build the probe set: a Proposition for every (subject, predicate, object[, place]) combo. */
function probeSet(): Proposition[] {
  const probes: Proposition[] = [];
  let id = 0;
  for (const s of NPCS) {
    for (const o of ORGS) {
      probes.push({
        id: `probe:${id++}`,
        subject: s as EntityId,
        predicate: 'WORKS_FOR',
        object: o as EntityId,
      });
    }
    for (const o of NPCS) {
      for (const place of PLACES) {
        probes.push({
          id: `probe:${id++}`,
          subject: s as EntityId,
          predicate: 'MEETS_AT',
          object: o as EntityId,
          place: place as Proposition['place'],
          window: { from: { day: 0, phase: 0 } },
        });
      }
    }
  }
  return probes;
}

const PROBES = probeSet();

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 4: Model outputs cannot write facts (Req 2.3, 2.4)', () => {
  it('evaluating any schema-valid extractor output leaves the ground-truth fact set and every holds verdict unchanged', () => {
    fc.assert(
      fc.property(
        extractionResultArb,
        seedFactsArb,
        knowledgeArb,
        fc.boolean(),
        (rawResult, seed, knowledge, coverIntact) => {
          // Parse the fuzzed output through the real predicate-derived schema,
          // so only Claims the Sim genuinely recognises reach the extractor —
          // the strongest adversary, not one the schema would reject.
          const result = schema.parse(rawResult);

          const store = seedStore(seed);

          // Snapshot the ground truth and the full probe verdict set *before*.
          const factsBefore = store.snapshot().facts;
          const allegiancesBefore = store.snapshot().allegiances;
          const identitiesBefore = store.snapshot().identities;
          const claimTruthsBefore = store.snapshot().claimTruths.length;
          const holdsBefore = PROBES.map((p) => store.holds(p, AT));

          // The model's "action": run its output through the extractor.
          const outcome = evaluateExtraction({
            result,
            speaker: 'npc:ana' as NpcId,
            at: AT,
            knowledge,
            toldList: [],
            coverIntact,
            truth: store,
            predicates: reg,
          });

          const snapAfter = store.snapshot();

          // 1. The ground-truth fact list is byte-identical: no fact created,
          //    modified or deleted (Req 2.3, 2.4).
          expect(snapAfter.facts).toEqual(factsBefore);

          // 2. Every holds verdict is unchanged: a model asserting a
          //    Proposition never makes it hold (or stop holding).
          const holdsAfter = PROBES.map((p) => store.holds(p, AT));
          expect(holdsAfter).toEqual(holdsBefore);

          // 3. Allegiances and identities — the other ground-truth maps — are
          //    untouched too.
          expect([...snapAfter.allegiances]).toEqual([...allegiancesBefore]);
          expect([...snapAfter.identities]).toEqual([...identitiesBefore]);

          // 4. The *only* write is claim-truth bookkeeping: one record per
          //    Claim, which is not a ground-truth fact.
          expect(snapAfter.claimTruths.length).toBe(
            claimTruthsBefore + result.claims.length,
          );
          expect(outcome.truthRecords).toHaveLength(result.claims.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});
