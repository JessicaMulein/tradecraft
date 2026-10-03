/**
 * Property 57: Extraction commit atomicity (slice-integration task 12.11).
 *
 * **Validates: Requirements 17.2**
 *
 * The design states (Correctness Property 57): "For any reachable state and any
 * schema-valid fuzzed extraction result for a queued job, after the next turn
 * boundary the Truth Store's Claim truth records, the speaker's Told List and
 * the Case File's new `npc` Claims equal `evaluateExtraction`'s outcome for that
 * job, and the Truth Store's fact set is unchanged. If the boundary's turn fails
 * before commit, none of the three changes."
 *
 * Requirement 17.2: when an extraction result commits, the Turn Pipeline writes
 * the Claim truth records to the Truth Store, updates the speaker's Told List,
 * and adds the Claims to the Case File without truth values, **as one
 * transaction at the turn boundary**.
 *
 * ## How this gets a reachable state and a queued job
 *
 * Like the other `app` property tests, this builds the *real* game through the
 * Composition Root (`createGame`) with the {@link buildFakeSeams} bundle — a
 * seeded, offline classifier/voice/narrate and a two-phase extraction runner
 * whose phase-1 result is a **schema-valid fuzzed** {@link ExtractionResult}
 * from `buildExtractionSchema` ({@link buildFuzzedExtraction}) — and the real
 * pure phase-2 `evaluateExtraction`, exactly the wiring the reachable walk
 * (`reachable-walk.walk.ts`) uses. It reuses that file's config helpers
 * (`walkScenario`, `walkModels`, `WALK_REPO_ROOT`) so a change to how the shared
 * walk builds a game lands here too.
 *
 * Rather than let the walk drain every boundary internally (which would hide the
 * pre-commit state of the job this property is about), the test drives the
 * facade by hand with full control of the moment of the boundary:
 *
 *  1. `newGame` on the seed, then a few `act` turns, preferring a `talk` so a
 *     Talk Scene opens — a *reachable* state.
 *  2. One `say` turn: this commits the dialogue turn and enqueues an extraction
 *     job (the Fake runner's `start` computes the fuzzed result synchronously, so
 *     the job is ready at the very next boundary). It is captured through the
 *     test's own {@link ExtractionQueue}, injected on the pipeline config, whose
 *     `head()` is the job about to commit.
 *  3. Before triggering the next boundary, snapshot the three stores and the
 *     fact set, and recompute `evaluateExtraction`'s outcome *independently* over
 *     a **clone** of the live Truth Store, from the very same schema-valid fuzzed
 *     result the Fake runner cached ({@link buildFuzzedExtraction}) and the exact
 *     inputs the pipeline passes (the job's speaker/time/knowledge/Told List and
 *     the same `allocateUnk` base the pipeline derives from `player.unkIds`).
 *  4. Trigger exactly one more turn so the boundary (step 1 of the pipeline)
 *     drains and commits the head job, then assert:
 *       - the new `npc` Case File Claims equal the outcome's `claims`,
 *       - the speaker's Told List equals the outcome's `toldList`,
 *       - the new Truth-Store Claim-truth records equal the outcome's
 *         `truthRecords`, and
 *       - the Truth Store's **fact set is unchanged** (extraction writes Claim
 *         truth, never facts).
 *
 * The negative half — "if the boundary's turn fails before commit, none of the
 * three changes" — is covered by a second case that wires an `evaluateExtraction`
 * that throws: the commit for the head job aborts before any of the three writes,
 * the thrown error leaves the job queued, and all three stores plus the fact set
 * are untouched.
 *
 * The whole game is hermetic (Fake Seams, no gateway, an in-memory Save Store, a
 * recording Outcome Sink), so each case runs fast enough for a property sweep.
 * Only this spec file imports vitest; the game it drives is the production
 * wiring.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createPrng,
  nextUnkId,
  TruthStore,
  type Action,
  type ClaimTruthRecord,
  type NpcId,
  type Prng,
  type Proposition,
  type TruthStoreData,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';
import { loadContent, type PredicateRegistry } from '@tradecraft/content';
import {
  evaluateExtraction,
  type ExtractionOutcome,
  type ExtractionResult,
} from '@tradecraft/dialogue';
import {
  InMemorySaveStore,
  type CaseFile,
  type Claim,
  type EvaluateExtraction,
  type EngineApi,
  type ExtractionReady,
  type ExtractionRunner,
  type QueuedExtraction,
  type TurnChunk,
  type TurnPipelineConfig,
} from '@tradecraft/player-view';

import { createGame, type Game } from './composition-root.js';
import { buildFakeSeams, buildFuzzedExtraction, type FakeSeamDeps } from './fake-seams.js';
import { walkModels, walkScenario, WALK_REPO_ROOT } from './reachable-walk.walk.js';

// ---------------------------------------------------------------------------
// Bounded run count: each case generates a world and plays several turns.
// ---------------------------------------------------------------------------

const RUNS = 60;

/** The most `act` turns to play while trying to open a Talk Scene. */
const MAX_OPEN_TURNS = 12;

// ---------------------------------------------------------------------------
// Shared game construction (mirrors the reachable walk's wiring)
// ---------------------------------------------------------------------------

/** The compiled predicate registry the Fake extraction seam derives from. */
function loadPredicates(): PredicateRegistry {
  const scenario = walkScenario();
  const dirs = scenario.packs.dirs.map((dir) => `${WALK_REPO_ROOT}/${dir}`);
  const content = loadContent([...dirs], [...scenario.packs.load]);
  if (!content.ok) {
    throw new Error('the atomicity property failed to load the Content Packs');
  }
  return content.value.predicates;
}

/**
 * The concrete facade's turn context, read through a structural cast. The
 * `turnContext` accessor (the Truth Store and raw Case File the pipeline stages
 * over) lives on the concrete `PlayerViewEngine`, not on the public
 * {@link EngineApi} surface — exactly as the reachable walk reads `state`
 * through a cast. The Truth Store is never a view-safe value, so the test (like
 * the pipeline itself) reads it only to stage/inspect, never to project.
 */
function turnContext(api: EngineApi): {
  readonly truth?: TruthStore;
  readonly caseFile: CaseFile;
} {
  return (
    api as unknown as {
      readonly turnContext: { readonly truth?: TruthStore; readonly caseFile: CaseFile };
    }
  ).turnContext;
}

/** The live Truth Store the facade stages extraction over (never projected). */
function liveTruth(api: EngineApi): TruthStore {
  const truth = turnContext(api).truth;
  if (truth === undefined) {
    throw new Error('the facade was built without a Truth Store');
  }
  return truth;
}

/** The live WorldState behind the facade (the Fake seams read it the same way). */
function liveState(api: EngineApi): WorldState {
  return (api as unknown as { readonly state: WorldState }).state;
}

/**
 * The handle a built game exposes to the test: the facade, the ordered list of
 * jobs the extraction runner was asked to `start` (the dialogue turns' enqueued
 * jobs, in order), and the {@link FakeSeamDeps} the Fake runner used (so the
 * test can recompute the exact fuzzed result the runner cached for a job).
 *
 * The Composition Root owns the pipeline's {@link ExtractionQueue} (it wires its
 * own, overriding any passed on the seams), so the test cannot read the queue
 * directly. Instead it wraps the Fake runner: a dialogue turn enqueues a job and
 * synchronously calls `start`, so `started` captures that job the moment it is
 * enqueued — before the next boundary commits it.
 */
interface BuiltGame {
  readonly game: Game;
  readonly started: QueuedExtraction[];
  readonly fakeDeps: FakeSeamDeps;
}

/**
 * Build the game with the Fake Seams and the real phase-2 `evaluateExtraction`.
 * The Fake extraction runner is wrapped so the test records every job the
 * pipeline enqueues (through `start`) while leaving its behaviour otherwise
 * identical. `evaluateExtraction` may be wrapped (the negative case wraps a
 * throwing one). No gateway, a no-op Save Store, a no-op Outcome Sink —
 * hermetic and deterministic in `seed`.
 */
function buildGame(
  seed: string,
  predicates: PredicateRegistry,
  evaluate: EvaluateExtraction,
): BuiltGame {
  const scenario = walkScenario();
  const models = walkModels();

  const holder: { api?: EngineApi } = {};
  const getState = (): WorldState => {
    if (holder.api === undefined) {
      throw new Error('the test read state before the game was built');
    }
    return liveState(holder.api);
  };

  const fakeDeps: FakeSeamDeps = { seed, getState, predicates };
  const fake = buildFakeSeams(fakeDeps);
  const started: QueuedExtraction[] = [];
  const innerRunner = fake.extraction as ExtractionRunner;
  const recordingRunner: ExtractionRunner = {
    start: (job: QueuedExtraction): void => {
      started.push(job);
      innerRunner.start(job);
    },
    ready: (job: QueuedExtraction): ExtractionReady => innerRunner.ready(job),
  };

  const seams: Partial<TurnPipelineConfig> = {
    ...fake,
    extraction: recordingRunner,
    evaluateExtraction: evaluate,
  };

  const game = createGame({
    repoRoot: WALK_REPO_ROOT,
    scenario,
    models,
    seams,
    saveStore: new InMemorySaveStore(),
    outcomes: () => undefined,
  });
  holder.api = game.api;
  return { game, started, fakeDeps };
}

// ---------------------------------------------------------------------------
// Driving the facade to a reachable state with a queued job
// ---------------------------------------------------------------------------

/** Drain a turn stream, collecting its chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Whether a turn's chunks ended the game. */
function endedIn(chunks: readonly TurnChunk[]): boolean {
  return chunks.some((c) => c.kind === 'ended');
}

/** A short, deterministic player line. */
function sayLine(rng: Prng): string {
  const lines = ['tell me about it', 'what do you know', 'can we talk', 'go on'];
  return lines[rng.int(0, lines.length - 1)];
}

/**
 * Play `act` turns until a Talk Scene is open or the budget runs out, preferring
 * a `talk` candidate so a scene reliably opens. Returns whether a scene is open
 * and the game is still running.
 */
async function openScene(api: EngineApi, seed: string): Promise<boolean> {
  const rng = createPrng(`atomicity:${seed}:open`);
  for (let i = 0; i < MAX_OPEN_TURNS; i += 1) {
    if (liveState(api).player.scene !== undefined) {
      return true;
    }
    const allowed = api.actions().filter((o) => o.quote.allowed);
    if (allowed.length === 0) {
      return false;
    }
    // Prefer a talk/approach so a scene opens; otherwise take a seeded action.
    const talk = allowed.find((o) => o.action.kind === 'talk');
    const picked: Action = talk?.action ?? allowed[rng.int(0, allowed.length - 1)].action;
    const chunks = await drain(api.act(picked));
    if (endedIn(chunks)) {
      return false;
    }
  }
  return liveState(api).player.scene !== undefined;
}

/** Trigger exactly one boundary: a `say` if the scene is still open, else `act`. */
async function triggerBoundary(api: EngineApi, seed: string): Promise<void> {
  if (liveState(api).player.scene !== undefined) {
    const rng = createPrng(`atomicity:${seed}:boundary-say`);
    await drain(api.say(sayLine(rng)));
    return;
  }
  const allowed = api.actions().filter((o) => o.quote.allowed);
  if (allowed.length === 0) {
    return;
  }
  const rng = createPrng(`atomicity:${seed}:boundary-act`);
  await drain(api.act(allowed[rng.int(0, allowed.length - 1)].action));
}

// ---------------------------------------------------------------------------
// Independent recomputation of the committed outcome
// ---------------------------------------------------------------------------

/**
 * Recompute `evaluateExtraction`'s outcome for the head job, independently of
 * the pipeline, over a **clone** of the live Truth Store (so this read does not
 * mutate the live store before the real commit). The parsed result is the exact
 * schema-valid fuzzed one the Fake runner cached ({@link buildFuzzedExtraction}
 * over the same `FakeSeamDeps` and job), and the inputs match the pipeline's
 * phase 2: the job's captured speaker/time/knowledge/Told List, the live
 * predicate registry, and the same `allocateUnk` base the pipeline derives from
 * the committed `player.unkIds` (`nextUnkId`), with the default Claim-id scheme.
 */
function expectedOutcome(
  api: EngineApi,
  predicates: PredicateRegistry,
  job: QueuedExtraction,
  result: ExtractionResult,
): ExtractionOutcome {
  const snapshot: TruthStoreData = liveTruth(api).snapshot();
  const clone = TruthStore.from(predicates.evaluators, snapshot);

  const base = Number.parseInt(
    nextUnkId(liveState(api).player.unkIds).slice('unk:'.length),
    10,
  );
  const allocateUnk = (index: number): UnkId => `unk:${base + index}` as UnkId;

  return evaluateExtraction({
    result,
    speaker: job.speaker,
    at: job.at,
    knowledge: job.speakerKnowledgeAtTurn,
    toldList: job.toldList,
    coverIntact: job.coverIntact,
    truth: clone,
    predicates,
    allocateUnk,
  });
}

/**
 * The `npc`-sourced Claims in the raw Case File for a speaker. Reads the raw
 * {@link CaseFile} on the turn context (not the view projection), so the Claim's
 * `source` and underlying Proposition are available for the comparison.
 */
function npcClaimsFor(api: EngineApi, speaker: NpcId): Claim[] {
  return turnContext(api)
    .caseFile.list()
    .filter((c: Claim) => c.source.kind === 'npc' && c.source.npc === speaker);
}

/** The Claim-truth records a speaker's extraction wrote, as plain data. */
function claimTruthsFor(truth: TruthStore, speaker: NpcId): ClaimTruthRecord[] {
  return truth
    .claimTruths()
    .map((r) => r as unknown as ClaimTruthRecord)
    .filter((r) => r.speaker === speaker);
}

/** The sorted ids of a list of Propositions, for order-insensitive comparison. */
function propIds(props: readonly Proposition[]): string[] {
  return props.map((p) => p.id).sort();
}

/** The fact-set ids of a Truth Store (facts are `Truth<Proposition>`). */
function factIds(truth: TruthStore): string[] {
  return propIds(truth.facts().map((f) => f as unknown as Proposition));
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

/**
 * Coverage counters, asserted at the end so the sweep cannot silently go
 * vacuous. A content or fuzzing change that stopped scenes opening, jobs
 * enqueuing, extraction results carrying Claims, or the negative throw firing
 * would make this file pass without testing the property; the `afterAll` guard
 * turns that into a visible failure.
 */
const coverage = { asserted: 0, committedClaims: 0, negativeThrows: 0 };

describe('Property 57: extraction commit atomicity (Req 17.2)', () => {
  const predicates = loadPredicates();

  afterAll(() => {
    // The sweep must have reached the real property on some reachable states:
    // at least one full positive assertion, at least one commit that actually
    // wrote Claims, and at least one negative case that reached the aborting
    // commit. (The counts are generous floors, not exact — the exact number is
    // seed- and content-dependent.)
    expect(coverage.asserted).toBeGreaterThan(0);
    expect(coverage.committedClaims).toBeGreaterThan(0);
    expect(coverage.negativeThrows).toBeGreaterThan(0);
  });

  it('commits the Truth records, Told List and npc Claims together, equal to evaluateExtraction, leaving facts unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100_000 }), async (n) => {
        const seed = `p57:${n}`;
        const { game, started, fakeDeps } = buildGame(seed, predicates, evaluateExtraction);
        try {
          const api = game.api;
          await api.newGame({ seed, preset: 'standard', mole: true, narration: 'off' });

          if (!(await openScene(api, seed))) {
            return; // No reachable scene from this seed; nothing to assert.
          }

          // One dialogue turn enqueues exactly one extraction job (the first
          // dialogue turn, so the boundary that ran at its start found an empty
          // queue). The wrapped runner records it as it is enqueued; nothing is
          // committed yet — the job is ready only at the NEXT boundary.
          const dialogue = await drain(api.say(sayLine(createPrng(`atomicity:${seed}:say`))));
          if (endedIn(dialogue)) {
            return;
          }
          const job = started[0];
          if (job === undefined) {
            return; // No job enqueued (no scene speaker); nothing to assert.
          }

          // The exact schema-valid fuzzed result the Fake runner cached for this
          // job — the raw Claims the pipeline's phase-2 evaluator will consume.
          const result = buildFuzzedExtraction(fakeDeps, job);
          const speaker = job.speaker;

          // Snapshot the three stores and the fact set BEFORE the boundary.
          const truth = liveTruth(api);
          const factIdsBefore = factIds(truth);
          const claimsBefore = npcClaimsFor(api, speaker).length;
          const truthsBefore = claimTruthsFor(truth, speaker).length;
          const toldBefore = (liveState(api).told[speaker] ?? []).length;

          // Recompute the expected outcome independently over a clone.
          const outcome = expectedOutcome(api, predicates, job, result);

          // Trigger exactly one more turn so the boundary drains and commits the
          // head job (the one captured above).
          await triggerBoundary(api, seed);

          const claimsAfter = npcClaimsFor(api, speaker);
          const newClaims = claimsAfter.length - claimsBefore;
          const toldAfter = liveState(api).told[speaker] ?? [];
          const truthsAfter = claimTruthsFor(truth, speaker);
          const newTruths = truthsAfter.length - truthsBefore;

          // npc Claims: one per outcome Claim, each sourced to the speaker and
          // filed without a truth value (the Case File carries no truth brand).
          expect(newClaims).toBe(outcome.claims.length);
          for (const claim of claimsAfter.slice(claimsBefore)) {
            expect(claim.source).toEqual({ kind: 'npc', npc: speaker });
          }
          expect(propIds(claimsAfter.slice(claimsBefore).map((c) => c.prop))).toEqual(
            propIds(outcome.claims.map((c) => c.prop)),
          );

          // Told List: equals the outcome's appended list.
          expect(propIds(toldAfter)).toEqual(propIds(outcome.toldList));
          expect(toldAfter.length - toldBefore).toBe(
            outcome.toldList.length - job.toldList.length,
          );

          // Claim-truth records: one per outcome record.
          expect(newTruths).toBe(outcome.truthRecords.length);
          expect(propIds(truthsAfter.slice(truthsBefore).map((r) => r.claim))).toEqual(
            propIds(outcome.truthRecords.map((r) => r.claim)),
          );

          // The three move together: a committed Claim has a Told entry and a
          // truth record; nothing is written half-way (Req 17.2).
          expect(newClaims).toBe(newTruths);
          expect(newClaims).toBe(toldAfter.length - toldBefore);

          // The fact set is UNCHANGED — extraction writes Claim truth, never a
          // fact.
          expect(factIds(truth)).toEqual(factIdsBefore);

          coverage.asserted += 1;
          coverage.committedClaims += newClaims;
        } finally {
          await game.close();
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('leaves all three stores and the fact set unchanged when the boundary commit fails before writing (Req 17.2)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100_000 }), async (n) => {
        const seed = `p57-fail:${n}`;
        // A phase-2 evaluator that throws: the head job's commit aborts before
        // any of the three writes, so the boundary turn fails before commit.
        const throwing: EvaluateExtraction = () => {
          throw new Error('phase-2 evaluation failed');
        };
        const { game, started, fakeDeps } = buildGame(seed, predicates, throwing);
        try {
          const api = game.api;
          await api.newGame({ seed, preset: 'standard', mole: true, narration: 'off' });

          if (!(await openScene(api, seed))) {
            return;
          }
          const dialogue = await drain(api.say(sayLine(createPrng(`atomicity:${seed}:say`))));
          if (endedIn(dialogue)) {
            return;
          }
          const job = started[0];
          if (job === undefined) {
            return;
          }
          // A write is only attempted when the result carries at least one
          // Claim; an empty result's commit is a no-op regardless, so skip it so
          // the "fails before writing" case is actually exercised.
          const result = buildFuzzedExtraction(fakeDeps, job);
          if (result.claims.length === 0) {
            return;
          }

          const speaker = job.speaker;
          const truth = liveTruth(api);
          const factIdsBefore = factIds(truth);
          const claimsBefore = npcClaimsFor(api, speaker).length;
          const truthsBefore = claimTruthsFor(truth, speaker).length;
          const toldBefore = (liveState(api).told[speaker] ?? []).length;

          // Trigger the boundary. The throwing evaluator makes the turn fail
          // before commit; the stream rejects, which the test tolerates (and
          // requires: a parsed, non-empty result must reach the evaluator).
          let threw = false;
          try {
            await triggerBoundary(api, seed);
          } catch {
            // Expected: the thrown phase-2 error propagated out of the turn.
            threw = true;
          }
          expect(threw).toBe(true);
          coverage.negativeThrows += 1;

          // None of the three changed — the commit aborted before any write.
          expect(npcClaimsFor(api, speaker).length).toBe(claimsBefore);
          expect(claimTruthsFor(truth, speaker).length).toBe(truthsBefore);
          expect((liveState(api).told[speaker] ?? []).length).toBe(toldBefore);
          expect(factIds(truth)).toEqual(factIdsBefore);
        } finally {
          await game.close();
        }
      }),
      { numRuns: RUNS },
    );
  });
});
