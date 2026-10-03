/**
 * The shared reachable-state walk (`app/reachable-walk.walk.ts`) —
 * slice-integration task 12.6; design, "Testing Strategy: Reachable states";
 * Requirements 18.3, 23.5.
 *
 * This is the one place the property tests of tasks 12.7–12.11 (Properties
 * 38–40, 55, 57) and the Scripted Full Games get a *reachable* World State from:
 * a random walk of 0–30 turns through the real Composition Root with the Fake
 * Seams, driving the real {@link EngineApi} — `newGame` then a mix of `act`,
 * `say` and `endScene` turns — with no endpoint and no network (design
 * "random walks of 0–30 turns through the Composition Root with Fake Seams,
 * including multi-day waits, travel, surveil, talk/say/endScene, …").
 *
 * ## Why this is a `*.walk.ts`, not a `*.spec.ts`
 *
 * The file name ends in `.walk.ts` so it is **not** itself a vitest spec (it
 * declares no tests) but is still ordinary TypeScript a spec file imports. It is
 * imported only by spec files, so it carries no vitest import of its own and is
 * compiled as part of the test build. Keeping the walk here — rather than
 * copied into each property spec — is what lets the five property tests and the
 * Scripted Full Games share one deterministic driver, so a change to how a turn
 * is chosen lands in all of them at once.
 *
 * ## Determinism
 *
 * The whole walk is a pure function of its seed. The world seed, the Fake Seams'
 * seed and every per-turn choice (which turn kind, which allowed action, which
 * line) derive from the one `seed` through the engine's `createPrng`, so
 * `runReachableWalk(seed)` and a second `runReachableWalk(seed)` make the exact
 * same API calls in the same order and reach the same final state. That is the
 * invariant Properties 38 (turn determinism) and 40 (replay determinism) assert;
 * the other properties read the reached state as a representative reachable
 * state.
 *
 * The walk reaches no live model: it builds the game with the Fake Seams and no
 * gateway (`createGame` builds no endpoint client in that case), an in-memory
 * {@link InMemorySaveStore} and a recording Outcome Sink, so it is hermetic and
 * fast enough to run inside a property's many iterations.
 */

import { resolve as resolvePath } from 'node:path';

import {
  createPrng,
  type Action,
  type AdvanceWorldDeps,
  type OutcomeRecord,
  type Prng,
  type ScenarioConfig,
  type WorldState,
} from '@tradecraft/engine';
import {
  loadContent,
  type ContentSet,
  type PredicateRegistry,
} from '@tradecraft/content';
import { evaluateExtraction } from '@tradecraft/dialogue';
import {
  InMemorySaveStore,
  type EngineApi,
  type NewGameOptions,
  type TurnChunk,
  type TurnPipelineConfig,
} from '@tradecraft/player-view';

import { createGame } from './composition-root.js';
import { buildFakeSeams } from './fake-seams.js';
import { WALK_REPO_ROOT, walkModels, walkScenario } from './game-harness-config.js';

// ---------------------------------------------------------------------------
// Static configs the walk builds a game from
// ---------------------------------------------------------------------------

// The repo root, scenario and models configs the walk builds a game from now
// live in `game-harness-config.ts`, shared with the Scripted Full Games. They
// are re-exported here so the property specs that import them from this file
// keep working unchanged.
export { WALK_REPO_ROOT, walkModels, walkScenario } from './game-harness-config.js';

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** The upper bound on the number of turns a walk plays (design: 0–30). */
export const MAX_WALK_TURNS = 30;

/** The outcome of a reachable walk: the live game and the recorded Outcome Records. */
export interface ReachableWalk {
  /** The assembled game's facade, left at the state the walk reached. */
  readonly api: EngineApi;
  /** The live world state the walk reached (read for the properties). */
  readonly state: WorldState;
  /** Every Outcome Record the recording Outcome Sink saw (0 or 1 per game). */
  readonly outcomes: readonly OutcomeRecord[];
  /** The number of turns the walk actually played (0..{@link MAX_WALK_TURNS}). */
  readonly turnsPlayed: number;
  /**
   * The in-memory {@link InMemorySaveStore} the walk's game was built over. A property
   * that needs the recorded action log (the `extraction-commit` positions and
   * every logged turn) can read it by having the facade `save` into this store
   * and parsing the snapshot — the Composition Root does not otherwise expose
   * the bridge-owned action log. Property 40 (replay determinism) reads it to
   * compare the two sessions' action logs.
   */
  readonly saveStore: InMemorySaveStore;
  /** Release the game's resources. */
  readonly close: () => Promise<void>;
}

/** Options for a reachable walk. */
export interface ReachableWalkOptions {
  /** The seed every choice derives from (the whole walk is a function of this). */
  readonly seed: string;
  /** The difficulty preset id to generate under. Defaults to `standard`. */
  readonly preset?: string;
  /** The number of turns to play, 0..{@link MAX_WALK_TURNS}. Defaults to a seeded count. */
  readonly turns?: number;
  /**
   * Extra Turn Pipeline config merged over the Fake Seams, for a property that
   * needs to observe the pipeline (an `evalLog`, an `unparsedNote` sink). The
   * Fake Seams and `evaluateExtraction` are always wired; this overrides nothing
   * essential.
   */
  readonly extraConfig?: Partial<TurnPipelineConfig>;
  /**
   * A test-only clock-advance override threaded onto the facade (Property 39,
   * turn atomicity). Omitted in the normal walk, where the Turn Pipeline builds a
   * per-draft {@link AdvanceWorldDeps} from the production hooks. Property 39
   * passes an {@link AdvanceWorldDeps} with a Day-Boundary Hook that can throw, to
   * drive the pre-commit failure path through the real Composition Root.
   */
  readonly advance?: AdvanceWorldDeps;
}

/** Drain a {@link TurnStream} to completion, collecting its chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/** A short, deterministic dialogue line built from a PRNG draw. */
function walkLine(rng: Prng): string {
  const openers = [
    'tell me about it',
    'what do you know',
    'can we talk',
    'I need your help',
  ];
  return openers[rng.int(0, openers.length - 1)];
}

/**
 * Choose and play one turn, returning whether the game is still running. The
 * choice is a pure function of the per-turn PRNG and the live state:
 *
 *  - If a Talk Scene is open, usually `say` (sometimes with an offer the Budget
 *    may or may not cover) and sometimes `endScene`, so the walk exercises the
 *    dialogue path, the extraction boundary and the scene-close path.
 *  - Otherwise, an `act` turn: pick one *allowed* action from the live
 *    catalogue (which always lists at least the `wait` options), so the turn
 *    always commits and the clock advances.
 */
async function playTurn(
  api: EngineApi,
  getState: () => WorldState,
  rng: Prng,
): Promise<boolean> {
  const sceneOpen = getState().player.scene !== undefined;

  if (sceneOpen && rng.next() < 0.75) {
    // Dialogue turn. A money offer rides along sometimes; the pipeline rejects
    // one the Budget cannot cover before any seam runs, which the walk tolerates.
    const offer = rng.next() < 0.3 ? rng.int(1, 500) : undefined;
    const chunks = await drain(
      api.say(walkLine(rng), offer === undefined ? undefined : { offer }),
    );
    return !endedIn(chunks);
  }

  if (sceneOpen && rng.next() < 0.5) {
    const chunks = await drain(api.endScene());
    return !endedIn(chunks);
  }

  // Action turn: play a seeded allowed action from the catalogue.
  const allowed = api.actions().filter((o) => o.quote.allowed);
  if (allowed.length === 0) {
    // No allowed action (should not happen — `wait` is always listed); stop.
    return false;
  }
  const action: Action = allowed[rng.int(0, allowed.length - 1)].action;
  const chunks = await drain(api.act(action));
  return !endedIn(chunks);
}

/** Whether a turn's chunks included an `ended` chunk (the game is over). */
function endedIn(chunks: readonly TurnChunk[]): boolean {
  return chunks.some((c) => c.kind === 'ended');
}

/**
 * Run a reachable-state walk (Req 18.3, 23.5). Builds the real game through the
 * Composition Root with the Fake Seams, starts a new game on the seed, and plays
 * up to {@link MAX_WALK_TURNS} seeded turns of `act`/`say`/`endScene`, stopping
 * early if the game ends. Deterministic in the seed: the same seed replays the
 * same calls and reaches the same state.
 */
export async function runReachableWalk(
  options: ReachableWalkOptions,
): Promise<ReachableWalk> {
  const { seed, preset = 'standard', extraConfig } = options;
  const scenario = walkScenario(preset);
  const models = walkModels();

  // The holder breaks the construction cycle: the Fake Seams read the live state
  // through `getState`, which resolves to the facade's current state once the
  // game is built. The returned `api` is the live `PlayerViewEngine`, whose
  // `state` getter the seams read (cast here; the facade interface hides it).
  const holder: { api?: EngineApi } = {};
  const getState = (): WorldState => {
    if (holder.api === undefined) {
      throw new Error('the walk read state before the game was built');
    }
    return (holder.api as unknown as { readonly state: WorldState }).state;
  };

  const seams: Partial<TurnPipelineConfig> = {
    ...buildFakeSeams({
      seed,
      getState,
      predicates: contentPredicates(scenario),
    }),
    // The pure phase-2 evaluator the Fake extraction runner's parsed results
    // commit through (Property 57). The real dialogue function, wired here so
    // the Fake extraction boundary runs end to end.
    evaluateExtraction,
    ...extraConfig,
  };

  const outcomes: OutcomeRecord[] = [];
  const saveStore = new InMemorySaveStore();
  const game = createGame({
    repoRoot: WALK_REPO_ROOT,
    scenario,
    models,
    seams,
    saveStore,
    outcomes: (record: OutcomeRecord): void => {
      outcomes.push(record);
    },
    ...(options.advance !== undefined ? { advance: options.advance } : {}),
  });
  holder.api = game.api;

  const newGameOpts: NewGameOptions = {
    seed,
    preset,
    mole: scenario.mole,
    narration: scenario.narration,
  };
  await game.api.newGame(newGameOpts);

  const turnRng = createPrng(`reachable-walk:${seed}:turns`);
  const turnCount = options.turns ?? turnRng.int(0, MAX_WALK_TURNS);

  let turnsPlayed = 0;
  for (let i = 0; i < turnCount; i += 1) {
    const stillRunning = await playTurn(
      game.api,
      getState,
      createPrng(`reachable-walk:${seed}:turn:${i}`),
    );
    turnsPlayed += 1;
    if (!stillRunning) {
      break;
    }
  }

  return {
    api: game.api,
    state: getState(),
    outcomes,
    turnsPlayed,
    saveStore,
    close: game.close,
  };
}

/**
 * The compiled predicate registry the Fake extraction seam derives its schema
 * from. The Composition Root loads its own Content Set internally, but the Fake
 * Seams are built *before* `createGame` returns, so the walk loads the registry
 * once here from the same core pack the scenario names, using the same
 * {@link loadContent} loader the Composition Root uses.
 */
function contentPredicates(scenario: ScenarioConfig): PredicateRegistry {
  const dirs = scenario.packs.dirs.map((dir) =>
    resolvePath(WALK_REPO_ROOT, dir),
  );
  const content = loadContent([...dirs], [...scenario.packs.load]);
  if (!content.ok) {
    throw new Error('the reachable walk failed to load the Content Packs');
  }
  const set: ContentSet = content.value;
  return set.predicates;
}
