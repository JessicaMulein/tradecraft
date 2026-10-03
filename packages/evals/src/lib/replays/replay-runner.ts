/**
 * The golden-replay runner (task 21.4; Req 17.4), now driven through the
 * Composition Root (slice-integration task 17.3; Req 5.5, 18.5, 23.6).
 *
 * This is the CI half of Property 14 / Property 40 (replay determinism). Where
 * the property tests sweep the determinism abstractly over generated seeds and
 * action logs, this module replays small, *checked-in* golden sessions and
 * asserts the reproduced artifact is byte-for-byte identical to the recorded
 * expectation. A golden fixture that stops reproducing is how an accidental
 * generator or core-pack change is caught in CI (design, "Testing Strategy":
 * "Golden replays check recorded sessions into `evals/replays/`. CI replays
 * them through `ReplayGateway` and asserts identical final state.").
 *
 * ## What a replay does
 *
 * A golden session is `(seed, inputs, action log, recording)`. {@link
 * replayGoldenSession} reproduces it exactly as a player would through the
 * assembled game, instead of folding `resolve` by hand (slice-integration
 * task 17.3). It builds the game through `@tradecraft/app`'s {@link createGame}
 * — the single Composition Root the launcher, the REPL and the eval harness all
 * use — with a {@link ReplayGateway} serving the fixture's recording and no
 * endpoint, then drives the plan through the public {@link EngineApi}:
 *
 *   1. **Assemble** the game with
 *      `createGame({ gateway: { replay }, … })`. The Content Set is loaded from
 *      the scenario's packs under `repoRoot`, the Gateway is a `ReplayGateway`
 *      over the fixture's {@link RecordSource}, and the Live Seams are built over
 *      that gateway (so a session that *did* make a model call is served from —
 *      or diverges against — its recording, with no endpoint touched; Req 17.3).
 *      The golden sessions here are model-free (`wait`/`travel`), so no call is
 *      served, but the replay path is still wired through `ReplayGateway`.
 *   2. **Start a new game** with `api.newGame({ seed, preset, … })`. Generation
 *      is deterministic in `(seed, inputs)` (Property 1), so this is the fixed
 *      determinism key, exactly as a save/replay would resume it.
 *   3. **Drive the plan** in order through `api.act`, draining each turn's
 *      {@link TurnStream} so the whole Turn Pipeline — resolve, world advance,
 *      day boundaries, commit — runs for every step, exactly as a live turn
 *      does. A `ReplayMismatchError` thrown by the gateway for an unrecorded
 *      call propagates, failing the replay loudly (Req 17.3, 17.4).
 *   4. **Snapshot** the reproduced session once through the facade's `saves`
 *      surface into an in-memory store, so the reproduced action log is read
 *      back from the pipeline's own {@link ActionLog} rather than reconstructed.
 *
 * ## The reproduced artifact
 *
 * The design names "identical final state" as the replay guarantee (Req 17.4,
 * Property 14). The artifact this runner returns and the golden file pins is the
 * final {@link WorldState} together with the reproduced action log, plus a
 * stable content hash of the world so a golden file can be compared compactly
 * and a mismatch names *where* it diverged. The spec asserts the full artifact
 * deep-equals the checked-in golden expectation.
 */

import {
  GENERATOR_VERSION,
  type Action,
  type GenerateInputs,
  type LocId,
  type ScenarioConfig,
  type WorldState,
} from '@tradecraft/engine';
import { canonicalJson, type ModelsConfig, type RecordSource } from '@tradecraft/llm';
import {
  InMemorySaveStore,
  type EngineApi,
  type TurnChunk,
} from '@tradecraft/player-view';
import { createGame } from '@tradecraft/app';
import { createHash } from 'node:crypto';

/**
 * One planned action in a golden session, named in a world-independent way so
 * the same plan resolves against the regenerated world identically on every
 * replay.
 *
 * A `wait` always resolves and advances the clock. A `travel` names its
 * destination by index into the world's Location ids (resolved against the
 * regenerated world, so both runs pick the same Location) plus the
 * countersurveillance flag that drives the resolver's only PRNG draw. Both are
 * model-free, so a golden session built from them determines its result from
 * the seed and action log alone.
 *
 * The third variant, `action`, carries a full concrete {@link Action} verbatim —
 * the exact engine action a recorder captured, entity ids and all. The
 * `04-full-game` Golden Replay (slice-integration task 19.2) uses it: the
 * win-by-arrest Scripted Full Game plays `read`/`surveil`/`intercept`/`decrypt`/
 * `cable`/`arrest` turns a `wait`/`travel` plan cannot express, and its concrete
 * actions are reproducible because generation is deterministic in `(seed,
 * inputs)` (Property 1), so a fresh replay regenerates the identical world — the
 * same Location, Document, Intercept and NPC ids the recorded actions name. The
 * recorder plays the script once (through the Fake Seams, which these actions
 * never invoke since none is a dialogue turn) and freezes the action log it
 * produced; CI replays those exact actions through the {@link ReplayGateway}.
 */
export type PlanStep =
  | { readonly kind: 'wait'; readonly phases: 1 | 2 | 3 | 4 }
  | {
      readonly kind: 'travel';
      readonly destIndex: number;
      readonly countersurveillance: boolean;
    }
  | { readonly kind: 'action'; readonly action: Action };

/**
 * The data a golden fixture carries, independent of how it is stored. The
 * recording and the models config let the replay run through a real
 * {@link ReplayGateway}; the plan is the action log the replay applies.
 */
export interface GoldenSession {
  /** The game seed the world is regenerated from. */
  readonly seed: string;
  /** The Difficulty Preset id the session was recorded under (`easy`|`standard`|`hard`). */
  readonly preset: string;
  /** The planned action log, applied in order. */
  readonly plan: readonly PlanStep[];
  /** The `models.yaml` config the session was recorded under. */
  readonly modelsConfig: ModelsConfig;
  /** The recorded model calls the {@link ReplayGateway} serves from. */
  readonly recording: RecordSource;
}

/** One entry of the reproduced action log, as the golden artifact stores it. */
export interface ReplayedLogEntry {
  readonly seq: number;
  readonly kind: string;
  readonly turn: string;
}

/**
 * The reproduced artifact of a golden replay: the final {@link WorldState}, the
 * reproduced action log, and a stable content hash of the world. The spec
 * asserts this deep-equals the checked-in golden expectation (Req 17.4).
 */
export interface ReplayArtifact {
  /** The generator version the world was produced under, so a bump is caught. */
  readonly generatorVersion: string;
  /** The final reproduced WorldState (the "identical final state" of Req 17.4). */
  readonly finalState: WorldState;
  /** A stable SHA-256 of the final WorldState over canonical JSON. */
  readonly stateHash: string;
  /** The reproduced action log, in `seq` order. */
  readonly actionLog: readonly ReplayedLogEntry[];
}

/** A stable SHA-256 of a WorldState over canonical (key-sorted) JSON. */
export function hashState(state: WorldState): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}

/** The Content Pack the golden sessions regenerate from, and its directory. */
const GOLDEN_PACK = 'core';
const GOLDEN_PACK_DIR = 'packages/content/packs/core';

/** The save name the runner snapshots the reproduced session under. */
const REPLAY_SAVE_NAME = 'golden-replay';

/**
 * The live {@link WorldState} the Composition Root's facade carries. The public
 * {@link EngineApi} is view-safe and does not expose the raw world; the concrete
 * `PlayerViewEngine` the Composition Root returns as `api` does, through its
 * `state` getter. The runner reads it to pick each plan step's travel
 * destination and to build the final artifact — the same cast the REPL session
 * driver uses. This is replay/CI tooling, not a player-facing projection, so
 * reading the live state here is legitimate.
 */
interface FacadeInternals {
  readonly state: WorldState;
}

/** Read the live World State off the Composition Root's facade. */
function liveState(api: EngineApi): WorldState {
  return (api as unknown as FacadeInternals).state;
}

/**
 * Turn a {@link PlanStep} into the concrete engine {@link Action} to play against
 * the live world. A `wait` is passed through; a `travel` names its destination
 * by index into the live world's Location ids, so both the recorder and a fresh
 * replay resolve the same Location from the regenerated world; an `action`
 * carries its concrete {@link Action} verbatim (the recorder froze it from a
 * deterministically-regenerated world, so its ids resolve identically here).
 */
function planToAction(step: PlanStep, world: WorldState): Action {
  if (step.kind === 'wait') {
    return { kind: 'wait', phases: step.phases };
  }
  if (step.kind === 'action') {
    return step.action;
  }
  const locIds = Object.keys(world.city.locations) as LocId[];
  const to = locIds[step.destIndex % locIds.length];
  return { kind: 'travel', to, countersurveillance: step.countersurveillance };
}

/** Drain one turn stream to completion, so the whole pipeline runs for the step. */
async function drive(stream: AsyncIterable<TurnChunk>): Promise<void> {
  for await (const _chunk of stream) {
    void _chunk;
  }
}

/**
 * The subset of a {@link import('@tradecraft/player-view').SaveSnapshot} the
 * runner reads back for the reproduced action log. The in-memory store returns
 * the parsed save value, whose `actionLog.entries` are the pipeline's own
 * ordered entries, so reading them back gives the reproduced log without
 * reconstructing it from the plan.
 */
interface SavedActionLog {
  readonly actionLog: {
    readonly entries: ReadonlyArray<{ readonly seq: number; readonly kind: string; readonly turn: string }>;
  };
}

/**
 * Replay a golden session end to end through the Composition Root and return the
 * reproduced artifact.
 *
 * Builds the game with {@link createGame} over a {@link ReplayGateway} serving
 * the fixture's recording (so the model-serving seam is wired through and
 * reaches no live endpoint), starts a new game on `(seed, preset)` through
 * `api.newGame`, folds the plan through `api.act`, and reads the final world and
 * the reproduced action log off the assembled game. A `ReplayMismatchError`
 * thrown by the gateway for an unrecorded call propagates, failing the replay
 * loudly.
 *
 * `repoRoot` is the repository root the scenario's pack directories resolve
 * against (the fixtures compute it from their own location). The scenario is the
 * one the inputs were built under, carrying the Content Packs to load.
 */
export async function replayGoldenSession(
  session: GoldenSession,
  inputs: GenerateInputs,
  repoRoot: string,
): Promise<ReplayArtifact> {
  // The Composition Root loads the Content Set from `scenario.packs`, resolving
  // each pack directory against `repoRoot` and expecting it to hold a
  // `pack.yaml`. The inputs' scenario carries the schema-default packs (the
  // packs *parent* directory), so the runner points `packs.dirs` at the core
  // pack directory itself — the same shape the REPL session driver uses — while
  // keeping every other scenario field the inputs were generated under.
  const scenario: ScenarioConfig = {
    ...inputs.scenario,
    packs: { dirs: [GOLDEN_PACK_DIR], load: [GOLDEN_PACK] },
  };
  const saveStore = new InMemorySaveStore();

  const game = createGame({
    repoRoot,
    scenario,
    models: session.modelsConfig,
    gateway: { replay: session.recording },
    saveStore,
  });

  try {
    const { api } = game;

    // Start a new game. Generation is deterministic in `(seed, inputs)`, so this
    // is the replay's fixed determinism key. The preset is the one the session
    // was recorded under (`04-full-game` records on `easy`; the slice fixtures
    // on `standard`).
    await api.newGame({
      seed: session.seed,
      preset: session.preset,
      mole: scenario.mole,
      narration: scenario.narration,
    });

    // Fold the plan through the public turn surface, draining each stream so the
    // whole Turn Pipeline runs for every step.
    for (const step of session.plan) {
      const action = planToAction(step, liveState(api));
      await drive(api.act(action));
    }

    // Snapshot the reproduced session once, so the pipeline's own action log is
    // read back rather than reconstructed from the plan.
    await api.saves.save(REPLAY_SAVE_NAME);
    const actionLog = readActionLog(saveStore);

    const finalState = liveState(api);
    return {
      generatorVersion: GENERATOR_VERSION,
      finalState,
      stateHash: hashState(finalState),
      actionLog,
    };
  } finally {
    await game.close();
  }
}

/** Read the reproduced action log back off the in-memory save the runner wrote. */
function readActionLog(saveStore: InMemorySaveStore): readonly ReplayedLogEntry[] {
  const read = saveStore.read(REPLAY_SAVE_NAME);
  if (
    read === null ||
    typeof read !== 'object' ||
    'error' in (read as Record<string, unknown>)
  ) {
    throw new Error('the reproduced golden session failed to save for its action log');
  }
  const snapshot = read as SavedActionLog;
  return snapshot.actionLog.entries.map((entry) => ({
    seq: entry.seq,
    kind: entry.kind,
    turn: entry.turn,
  }));
}
