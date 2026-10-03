/**
 * Feature: slice-integration, Property 42: Outcome Record written once (task
 * 8.5).
 *
 * **Validates: Requirements 7.6**
 *
 * The design states (slice-integration design, "Property 42: Outcome Record
 * written once"):
 *
 * > For any reachable action sequence, the Outcome Sink receives at most one
 * > record per game, and receives exactly one if and only if the final state is
 * > ended. The record equals `buildOutcomeRecord` of the first ended state.
 * > Saving and loading an ended game and continuing to call the API writes no
 * > further record.
 *
 * This drives the real {@link createTurnDriver} pipeline behind the
 * {@link PlayerViewEngine} facade over real generated worlds, with the once-
 * per-game Outcome Record write (design, "Turn Pipeline" step 9) wired through a
 * *recording* {@link OutcomeSink} and **no model seams** (the walk is
 * action-only: `act` turns, never `say`, so no classifier / voice / narrator
 * runs). The property then pins the write-once invariant across the input space:
 *
 *   - **At most one, and exactly one iff ended.** An action-only walk plays
 *     random `wait` turns, each advancing one or more phases. The slice's Plot
 *     runs on its own schedule regardless of the player's actions, so a long
 *     enough walk always drives the game to an End Condition — the clock stops
 *     at the ending phase (early stop, Property 35) and the action turn commits
 *     the ended state, firing step 9. Whether the walk ends the game or not, the
 *     sink is checked: it receives nothing while the game is live, and exactly
 *     one record the moment — and only the moment — a turn first commits an End
 *     Condition.
 *
 *   - **The record equals `buildOutcomeRecord` of the first ended state.** The
 *     one record the sink receives is compared field-for-field against the pure
 *     engine derivation off the committed ended state, so the pipeline writes
 *     exactly what the engine derives, not a reshaped value.
 *
 *   - **No further write once ended.** Continuing to call `act` after the game
 *     has ended hits the ended gate (design step 2): the turn is rejected and no
 *     second record is written. The sink's count never grows past one.
 *
 *   - **Save/load an ended game writes nothing more.** A game rebuilt from a
 *     save seeds the pipeline's `outcomeWritten` flag `true` (the flag is
 *     persisted on the `SaveSnapshot`; design step 9). The property rebuilds a
 *     fresh facade + driver over the ended state with `outcomeWritten: true` —
 *     exactly what `saves.load` of an ended game does — and asserts that further
 *     `act` calls write no record through the reloaded game's own sink.
 *
 * These complement the example-based pipeline tests in `turn-pipeline.spec.ts`;
 * the property drives the write-once seam across seeds and walk shapes rather
 * than at one hand-picked ending.
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
  buildOutcomeRecord,
  generate,
  ScenarioConfigSchema,
  TruthStore,
  type Action,
  type GenerateInputs,
  type OutcomeRecord,
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
  type OutcomeSink,
  type TurnPipelineConfig,
} from './turn-pipeline.js';
import type { TurnChunk } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors turn-pipeline.spec.ts / turn-atomicity.property)
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
// A recording Outcome Sink
// ---------------------------------------------------------------------------

/** A sink that records every record it is handed, so the property can count them. */
function recordingSink(): { sink: OutcomeSink; records: OutcomeRecord[] } {
  const records: OutcomeRecord[] = [];
  const sink: OutcomeSink = (record) => {
    records.push(record);
  };
  return { sink, records };
}

/**
 * Build a facade over the given world with a Truth Store wired (the Outcome
 * Record derivation reads it) and a recording Outcome Sink, with **no model
 * seams** (action-only). Returns the facade, the sink's records, and the shared
 * Truth Store so the oracle can derive the expected record off the same store.
 *
 * `outcomeWritten` seeds the pipeline's write-once flag: `false` for a fresh
 * game, `true` for a game rebuilt from a save that had already written its
 * Outcome Record (what `saves.load` of an ended game does; design step 9).
 */
function makeEngine(
  state: WorldState,
  truth: TruthStore,
  outcomeWritten = false,
): { engine: PlayerViewEngine; records: OutcomeRecord[] } {
  const { sink, records } = recordingSink();
  const caseFile = new CaseFile();
  const ctx: ResolverContext = { content, truth };
  const config: TurnPipelineConfig = {
    outcomes: sink,
    outcomeWritten,
    actionLog: new ActionLog(),
    extractionQueue: new ExtractionQueue(),
  };
  const turnDriver = createTurnDriver(config);
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
    turnDriver,
  });
  return { engine, records };
}

/** Drain a turn stream into an array of chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

// ---------------------------------------------------------------------------
// The action-only walk arbitrary (spec-only helper)
// ---------------------------------------------------------------------------

/**
 * The action-only walk: a bounded sequence of `wait` turns, each advancing one
 * to a few phases. `wait` is always allowed and never opens a Talk Scene, so the
 * walk touches no model seam — it is purely the action turn's simulate/commit
 * path, which is where the Outcome Record write lives (design step 9). The slice
 * Plot runs on its own schedule, so a long walk drives any generated world to an
 * End Condition; the clock stops at the ending phase and that turn commits the
 * end, firing step 9. A shorter walk may leave the game live, which the property
 * also needs (the "exactly one iff ended" direction).
 */
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

/** A single `wait` turn advancing `phases` phases (1–4). */
function waitAction(phases: 1 | 2 | 3 | 4): Action {
  return { kind: 'wait', phases };
}

/** A walk of 1–120 `wait` turns, each 1–4 phases. */
const walkArb = fc.array(fc.integer({ min: 1, max: 4 }) as fc.Arbitrary<1 | 2 | 3 | 4>, {
  minLength: 1,
  maxLength: 120,
});

// ---------------------------------------------------------------------------
// Property 42 — Outcome Record written once (Req 7.6)
// ---------------------------------------------------------------------------

describe('Property 42: Outcome Record written once (Req 7.6)', () => {
  it('writes at most one record, and exactly one iff the game ended, equal to buildOutcomeRecord of the first ended state', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, walkArb, async (seed, phasesPerTurn) => {
        const truth = TruthStore.create(content.predicates.evaluators);
        const { engine, records } = makeEngine(world(seed), truth);

        // The game's state the moment it first ended, captured so the oracle can
        // derive the expected record off exactly that state (the FIRST ended
        // state; design: "the record equals buildOutcomeRecord of the first
        // ended state").
        let firstEnded: WorldState | undefined;

        for (const phases of phasesPerTurn) {
          const endedBefore = engine.state.ended !== undefined;
          await drain(engine.act(waitAction(phases)));
          const endedAfter = engine.state.ended !== undefined;

          // The sink is never handed more than one record, at any point in the
          // walk (the write-once invariant, checked each turn).
          expect(records.length).toBeLessThanOrEqual(1);

          // The write happens exactly on the turn that first commits the end.
          if (!endedBefore && endedAfter) {
            firstEnded = engine.state;
            expect(records.length).toBe(1);
          }
        }

        const endedFinal = engine.state.ended !== undefined;

        // Exactly one record iff the final state is ended; none otherwise.
        if (endedFinal) {
          expect(records).toHaveLength(1);
          expect(firstEnded).toBeDefined();
          // The one record equals the pure engine derivation off the first ended
          // state and the same ground truth.
          const expected = buildOutcomeRecord(firstEnded as WorldState, truth);
          expect(records[0]).toEqual(expected);
        } else {
          expect(records).toHaveLength(0);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('never writes a second record once the game has ended, however many further actions are taken', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.integer({ min: 1, max: 6 }), async (seed, extraTurns) => {
        const truth = TruthStore.create(content.predicates.evaluators);
        const { engine, records } = makeEngine(world(seed), truth);

        // Drive the game to its End Condition with a long action-only walk (the
        // Plot's own schedule guarantees an ending; the probe showed every seed
        // ends well within this bound). Each turn advances up to 4 phases.
        for (let i = 0; i < 120 && engine.state.ended === undefined; i++) {
          await drain(engine.act(waitAction(4)));
        }
        expect(engine.state.ended).toBeDefined();
        expect(records).toHaveLength(1);

        const theRecord = records[0];
        const stateAtEnd = engine.state;

        // Keep acting after the end. Each turn hits the ended gate (design step
        // 2): it is rejected, commits nothing, and writes no further record.
        for (let i = 0; i < extraTurns; i++) {
          await drain(engine.act(waitAction(4)));
          expect(records).toHaveLength(1);
          // The committed state is unchanged by a gated turn, and the one record
          // is the same object — nothing re-derived or re-written.
          expect(engine.state).toBe(stateAtEnd);
          expect(records[0]).toBe(theRecord);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('writes no further record after saving and loading an ended game and continuing to act', async () => {
    await fc.assert(
      fc.asyncProperty(seedArb, fc.integer({ min: 1, max: 6 }), async (seed, extraTurns) => {
        const truth = TruthStore.create(content.predicates.evaluators);
        const { engine, records } = makeEngine(world(seed), truth);

        // End the game.
        for (let i = 0; i < 120 && engine.state.ended === undefined; i++) {
          await drain(engine.act(waitAction(4)));
        }
        expect(engine.state.ended).toBeDefined();
        expect(records).toHaveLength(1);

        // Simulate a save/load of the ended game: a fresh facade + driver is
        // built over the ended state, and the reloaded pipeline seeds its
        // `outcomeWritten` flag `true` from the save (design step 9: "The flag is
        // saved, so loading an ended game never writes again"). The reload gets
        // its OWN recording sink, so any write would be observable on it.
        const { engine: reloaded, records: reloadedRecords } = makeEngine(
          engine.state,
          truth,
          /* outcomeWritten */ true,
        );

        // Continuing to call the API after a load of an ended game writes no
        // record through the reloaded game's sink (both because the flag is
        // seeded true and because the ended gate rejects each action turn).
        for (let i = 0; i < extraTurns; i++) {
          await drain(reloaded.act(waitAction(4)));
        }
        expect(reloadedRecords).toHaveLength(0);
      }),
      { numRuns: 30 },
    );
  });
});
