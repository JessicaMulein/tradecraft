/**
 * Feature: slice-integration, Property 45: Decrypt soundness (task 8.7).
 *
 * **Validates: Requirements 8.3, 8.4, 8.5, 8.6**
 *
 * The design states (slice-integration design, "Property 45: Decrypt
 * soundness"):
 *
 * > For any reachable state and collected Intercept, resolving `decrypt` with
 * > its true key adds exactly the Intercept's plaintext Propositions to the Case
 * > File as Claims with source `intercept` and marks it broken; resolving
 * > `decrypt` again adds nothing. For any two wrong submissions against the same
 * > Intercept, the results, Fact Lines and Case File are identical, and no Claim
 * > is added.
 *
 * This drives the real {@link createTurnDriver} pipeline behind the
 * {@link PlayerViewEngine} facade — the same action turn (`resolve` → stage
 * Claims → commit; design "Turn Pipeline" step 5 and the claim recorder, task
 * 7.2) the player hits when they submit a key on the Workbench — over real
 * generated worlds. The walk is action-only (`decrypt` and `wait`), so no model
 * seam runs.
 *
 * ## The reachable state with a collected Intercept
 *
 * A generated world starts with `intercepts: {}` — the player has captured
 * nothing (slice-integration `world-intercepts.ts`: `WorldState.intercepts`
 * starts empty, the intercept action delivers them). The intercept action's
 * Station sweep (`resolveStationCollection`) collects a transmission by copying
 * its seeded Intercept from `WorldState.transmissions` into
 * `WorldState.intercepts` *unchanged*. This spec reaches that exact state by
 * copying one seeded transmission's Intercept into `intercepts` — the same
 * state the collection path commits — so the facade then quotes `decrypt`
 * allowed on it (`quoteDecrypt`: allowed iff the Intercept is a key of
 * `WorldState.intercepts`) and resolves it like any collected capture.
 *
 * ## The true key
 *
 * A correct submission is `{ kind: 'key', spec: revealedSpec(intercept) }` —
 * the Intercept's own ground-truth cipher spec (the same true-key submission the
 * engine's `verifySubmission` tests use). The engine oracle `verifySubmission`
 * is called in the test only to derive the *expected* recovered Propositions
 * (what "exactly the Intercept's plaintext Propositions" means), against the
 * same world cipher-key lookup (`meta.seed`, `documents`) the decrypt resolver
 * falls back to.
 *
 * The property then pins decrypt soundness across the input space:
 *
 *   - **Correct key (Req 8.3, 8.4).** After one `decrypt` with the true key, the
 *     Case File gains exactly one Claim per recovered Proposition, every one
 *     sourced `{ kind: 'intercept', id }` for that Intercept, and the recorded
 *     Propositions equal the engine's recovered set — no more, no fewer. The
 *     committed Intercept is marked `broken`.
 *
 *   - **Idempotent re-break (Req 8.6).** A second `decrypt` on the now-broken
 *     Intercept — with the true key or any key — leaves the Case File unchanged:
 *     a broken Intercept reports no Proposition Observations, so the claim
 *     recorder files nothing.
 *
 *   - **Wrong submissions reveal nothing (Req 8.5).** Two different wrong
 *     submissions against the same (unbroken) Intercept produce byte-for-byte
 *     identical Fact Lines (the fixed rejection line, which says nothing about
 *     how close the guess came), add no Claim, and leave the Intercept unbroken
 *     and the state's Case File identical — so a rejection carries no
 *     information about the key or plaintext.
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
import {
  generate,
  revealedSpec,
  ScenarioConfigSchema,
  TruthStore,
  verifySubmission,
  worldCipherKeyLookup,
  type Action,
  type GenerateInputs,
  type Intercept,
  type InterceptId,
  type KeySubmission,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  ActionLog,
  ExtractionQueue,
  createTurnDriver,
  type TurnPipelineConfig,
} from './turn-pipeline.js';
import type { TurnChunk } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors outcome-record.property.spec.ts / turn-pipeline)
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
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
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
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

function world(seed: string): WorldState {
  return generate(seed, inputs());
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

// ---------------------------------------------------------------------------
// Reaching a state with a collected Intercept
// ---------------------------------------------------------------------------

/**
 * The seeded Intercept to work in `seed`'s world: the first transmission's
 * Intercept, by transmission id. A generated world seeds `transmissions` with
 * the real ciphertext records (Plot/Side-Thread/Noise traffic); the intercept
 * action collects one by copying it into `intercepts`. `undefined` when a world
 * seeded no interceptable traffic (then the seed is skipped).
 */
function firstSeededIntercept(state: WorldState): Intercept | undefined {
  const sorted = [...state.transmissions].sort((a, b) =>
    a.intercept.id < b.intercept.id ? -1 : a.intercept.id > b.intercept.id ? 1 : 0,
  );
  return sorted[0]?.intercept;
}

/**
 * A reachable state in which the player has collected `intercept`: it is copied
 * into `WorldState.intercepts` unchanged, exactly as the intercept action's
 * Station sweep (`resolveStationCollection`) commits a collected capture.
 */
function withCollected(state: WorldState, intercept: Intercept): WorldState {
  return {
    ...state,
    intercepts: { ...state.intercepts, [intercept.id]: intercept },
  };
}

/**
 * Build a facade over `state` with a Truth Store wired (the pipeline builds its
 * Resolver Context — and the decrypt key lookup — over it) and no model seams.
 */
function makeEngine(state: WorldState): {
  engine: PlayerViewEngine;
  caseFile: CaseFile;
} {
  const truth = TruthStore.create(content.predicates.evaluators);
  const caseFile = new CaseFile();
  const ctx: ResolverContext = { content, truth };
  const config: TurnPipelineConfig = {
    outcomes: () => undefined,
    actionLog: new ActionLog(),
    extractionQueue: new ExtractionQueue(),
  };
  const engine = new PlayerViewEngine({
    state,
    caseFile,
    journal: new Journal(),
    cityData,
    ctx,
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
    notifications: new NotificationStore(),
    truth,
    turnDriver: createTurnDriver(config),
  });
  return { engine, caseFile };
}

/** Drain a turn stream into its chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/** The fixed Fact Lines a stream surfaced, in order. */
function factLines(chunks: readonly TurnChunk[]): string[] {
  return chunks.filter((c) => c.kind === 'fact').map((c) => (c as { text: string }).text);
}

function decrypt(intercept: InterceptId, submission: KeySubmission): Action {
  return { kind: 'decrypt', intercept, submission };
}

/** The true-key submission for an Intercept: its own ground-truth cipher spec. */
function trueKey(intercept: Intercept): KeySubmission {
  return { kind: 'key', spec: revealedSpec(intercept) };
}

/**
 * The Propositions a correct break of `intercept` recovers, derived by the
 * engine oracle against the world's own cipher-key lookup — the "exactly the
 * Intercept's plaintext Propositions" the Case File must gain.
 */
function recoveredPropositions(state: WorldState, intercept: Intercept) {
  const result = verifySubmission(
    intercept,
    trueKey(intercept),
    worldCipherKeyLookup(state.meta.seed, state.documents),
    content.predicates,
  );
  if (!result.ok) throw new Error('the true key failed to verify an own Intercept');
  return result.propositions;
}

const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'w2',
  'seed-99',
  'fox-trot',
];

const seedArb = fc.constantFrom(...SEEDS);

// ---------------------------------------------------------------------------
// Property 45 — Decrypt soundness (Req 8.3, 8.4, 8.5, 8.6)
// ---------------------------------------------------------------------------

describe('Property 45: Decrypt soundness (Req 8.3, 8.4, 8.5, 8.6)', () => {
  it('a correct key adds exactly the recovered Propositions as intercept Claims and marks the Intercept broken (Req 8.3, 8.4)', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, async (seed) => {
        const base = world(seed);
        const intercept = firstSeededIntercept(base);
        if (intercept === undefined) return; // no interceptable traffic in this world

        const state = withCollected(base, intercept);
        const { engine, caseFile } = makeEngine(state);
        expect(caseFile.size).toBe(0);

        await drain(engine.act(decrypt(intercept.id, trueKey(intercept))));

        // The recorded Claims are exactly one per recovered Proposition, each
        // sourced `intercept` for this Intercept, and their Propositions equal
        // the engine's recovered set (no more, no fewer; Req 8.4).
        const expected = recoveredPropositions(state, intercept);
        const claims = caseFile.list();
        expect(claims).toHaveLength(expected.length);
        for (const claim of claims) {
          expect(claim.source).toEqual({ kind: 'intercept', id: intercept.id });
        }
        const recordedProps = claims
          .map((c) => c.prop)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const expectedProps = [...expected].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
        expect(recordedProps).toEqual(expectedProps);

        // The committed Intercept is marked broken (Req 8.3 / 8.4).
        expect(engine.state.intercepts[intercept.id]?.broken).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('resolving decrypt again on a broken Intercept adds nothing (Req 8.6)', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, async (seed) => {
        const base = world(seed);
        const intercept = firstSeededIntercept(base);
        if (intercept === undefined) return;

        const state = withCollected(base, intercept);
        const { engine, caseFile } = makeEngine(state);

        // First break: fills the Case File and marks the Intercept broken.
        await drain(engine.act(decrypt(intercept.id, trueKey(intercept))));
        const afterFirst = caseFile.snapshot();
        const sizeAfterFirst = caseFile.size;
        expect(engine.state.intercepts[intercept.id]?.broken).toBe(true);

        // A second break on the now-broken Intercept — true key or wrong — adds
        // no Claim: a broken Intercept reports no Proposition Observations.
        await drain(engine.act(decrypt(intercept.id, trueKey(intercept))));
        await drain(
          engine.act(decrypt(intercept.id, { kind: 'plaintext', text: 'NOT THE MESSAGE' })),
        );

        expect(caseFile.size).toBe(sizeAfterFirst);
        expect(caseFile.snapshot()).toEqual(afterFirst);
      }),
      { numRuns: 60 },
    );
  });

  it('two different wrong submissions give identical Fact Lines, add no Claim, and leave the Intercept unbroken (Req 8.5)', async () => {
    const wrongPairArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
      )
      .filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(seedArb, wrongPairArb, async (seed, [textA, textB]) => {
        const base = world(seed);
        const intercept = firstSeededIntercept(base);
        if (intercept === undefined) return;

        const state = withCollected(base, intercept);

        // The two wrong submissions must actually be wrong — skip the (vanishing)
        // chance that a random plaintext equals the true recovered message.
        const keyLookup = worldCipherKeyLookup(state.meta.seed, state.documents);
        const wrongA: KeySubmission = { kind: 'plaintext', text: textA };
        const wrongB: KeySubmission = { kind: 'plaintext', text: textB };
        if (verifySubmission(intercept, wrongA, keyLookup, content.predicates).ok) return;
        if (verifySubmission(intercept, wrongB, keyLookup, content.predicates).ok) return;

        // Two independent fresh games, one per wrong submission, so each starts
        // from the identical collected state.
        const a = makeEngine(state);
        const b = makeEngine(state);

        const chunksA = await drain(a.engine.act(decrypt(intercept.id, wrongA)));
        const chunksB = await drain(b.engine.act(decrypt(intercept.id, wrongB)));

        // Identical Fact Lines: the rejection says nothing about how close the
        // guess came, so two different wrong guesses read the same.
        expect(factLines(chunksA)).toEqual(factLines(chunksB));

        // No Claim added by either, and the Intercept stays unbroken.
        expect(a.caseFile.size).toBe(0);
        expect(b.caseFile.size).toBe(0);
        expect(a.engine.state.intercepts[intercept.id]?.broken).not.toBe(true);
        expect(b.engine.state.intercepts[intercept.id]?.broken).not.toBe(true);

        // The committed Case Files are identical (both empty, same snapshot).
        expect(a.caseFile.snapshot()).toEqual(b.caseFile.snapshot());
      }),
      { numRuns: 60 },
    );
  });
});
