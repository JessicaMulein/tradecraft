/**
 * The first-live-session REPL's session-driving logic (checkpoint 17), now on
 * the Composition Root (slice-integration task 17.1).
 *
 * This is the testable core behind the `pnpm repl` CLI. It assembles a playable
 * game through `@tradecraft/app`'s {@link createGame} — the single Composition
 * Root the launcher also uses — and drives one scripted operator session end to
 * end through the returned {@link EngineApi}, exactly as the TUI would:
 *
 *   1. start a new game (`api.newGame`) on the seed and preset — the brief
 *      Cable's leads are seeded into the Case File by `newGame` itself,
 *   2. show the brief Cable the game opens on,
 *   3. `act` a `read` of that brief Cable through the pipeline,
 *   4. `act` a travel to a Location where a contact is present,
 *   5. run an in-person briefing beat (a dialogue `say` to that contact),
 *   6. `act` a surveil of the current Location, streaming the Narrator's
 *      Flavour,
 *   7. `say` a line to one NPC in a fresh scene (the voice model under the
 *      guards), then `endScene` to close the beat.
 *
 * The REPL no longer wires its own {@link PlayerViewEngine}, Turn Pipeline or
 * Live Seams: the Composition Root does all of that from the loaded Content Set,
 * the Gateway and (optionally) injected seams. The CLI passes a recording
 * Gateway (`{ record }`); the test injects a fake Gateway or Fake Seams. Either
 * way the session drives the same assembled game the launcher does.
 *
 * Every {@link TurnChunk} is pushed to an injected {@link SessionSink} so the
 * CLI can style them to stdout (facts plain, flavour/speech styled) while the
 * test asserts the chunk kinds. After the session the core inspects the Case
 * File (`listClaims`), the Journal (`journalView`) and the ground-truth records
 * (the reveal dump), returning them as rendered text so the CLI prints them and
 * the test asserts they are non-empty.
 *
 * The logic imports no vitest and reads no process state; it is deterministic in
 * `(seed, preset)` for the engine side, with the model-side behaviour whatever
 * the injected Gateway/seams produce.
 */

import {
  ScenarioConfigSchema,
  visibleNpcsAt,
  type Action,
  type DocId,
  type LocId,
  type ScenarioConfig,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';
import {
  type ClaimView,
  type EngineApi,
  type JournalView,
  type TurnChunk,
  type TurnPipelineConfig,
} from '@tradecraft/player-view';
import type { ModelsConfig } from '@tradecraft/llm';
import { createGame, type GatewayOption } from '@tradecraft/app';

import type { DifficultyPresetId } from '../replays/fixtures.js';
import { renderWorldDump } from '../debug/world-dump.js';

/** The lines the briefing and NPC beats speak. */
const BRIEFING_LINE = 'What should I know before I go out there?';
const NPC_LINE = 'I was told you might have something for me.';

/**
 * The live {@link WorldState} and seeded {@link TruthStore} the Composition
 * Root's facade carries. The public {@link EngineApi} is view-safe and exposes
 * neither — they live on the concrete `PlayerViewEngine` the Composition Root
 * returns as `api`. The REPL reads them (the state to pick a destination and
 * open a scene, the Truth Store for the operator ground-truth dump) through this
 * cast, the same one the shared reachable-state walk uses. This is REPL/debug
 * tooling, not a player-facing projection, so reading the hidden state here is
 * legitimate.
 */
interface FacadeInternals {
  readonly state: WorldState;
  readonly turnContext: { readonly truth?: TruthStore };
}

/** Read the live World State off the Composition Root's facade. */
function liveState(api: EngineApi): WorldState {
  return (api as unknown as FacadeInternals).state;
}

/** Read the seeded Truth Store off the facade, if one is in reach. */
function liveTruth(api: EngineApi): TruthStore | undefined {
  return (api as unknown as FacadeInternals).turnContext.truth;
}

/** A labelled turn stream chunk, carrying which beat produced it. */
export interface SessionEvent {
  /** The beat the chunk came from (`briefing`, `travel`, `surveil`, `talk`). */
  readonly beat: SessionBeat;
  /** The streamed chunk. */
  readonly chunk: TurnChunk;
}

/** The beats the scripted session runs, in order. */
export type SessionBeat =
  | 'read-brief'
  | 'briefing'
  | 'travel'
  | 'surveil'
  | 'talk'
  | 'endScene';

/** A sink the session pushes every chunk to as it streams. */
export type SessionSink = (event: SessionEvent) => void;

/** The options the session driver accepts. */
export interface SessionOptions {
  /** The game seed to generate the world from. */
  readonly seed: string;
  /** The difficulty preset. Defaults to `standard`. */
  readonly preset?: DifficultyPresetId;
  /**
   * How the Composition Root obtains its LLM Gateway. The CLI passes
   * `{ record }` (the live gateway, recorded to a file); a test may pass its own
   * recording-wrapped fake Gateway. Omitted, `createGame` defaults to `'live'`
   * (unless `seams` is given, in which case it builds no gateway at all).
   */
  readonly gateway?: GatewayOption;
  /**
   * Turn Pipeline seams to inject instead of the Live Seams built over the
   * Gateway (`createGame`'s `seams`). The offline test passes Fake Seams here so
   * it reaches no endpoint; the CLI omits it and gets the Live Seams.
   */
  readonly seams?: Partial<TurnPipelineConfig>;
  /** The validated models config (the endpoint and per-role model ids). */
  readonly models: ModelsConfig;
  /** The repository root the scenario's pack directories resolve against. */
  readonly repoRoot: string;
  /**
   * The scenario the game is generated under. Omitted, the session builds a
   * fully-specified, deterministic scenario from the preset (the core pack with
   * unit recruitment weights and `full` narration), like the golden fixtures.
   */
  readonly scenario?: ScenarioConfig;
  /** A sink for the streamed chunks. Optional; omitted means they are dropped. */
  readonly sink?: SessionSink;
}

/** The post-session inspection, as both structured data and rendered text. */
export interface SessionInspection {
  /** The Case File Claims the session recorded (`listClaims`). */
  readonly claims: readonly ClaimView[];
  /** The Journal view (fact log + notes). */
  readonly journal: JournalView;
  /** The rendered ground-truth reveal dump (truth records for the session). */
  readonly truthDump: string;
  /** The brief Cable's rendered body (shown at the top of the session). */
  readonly brief: string;
}

/** The full result of a driven session. */
export interface SessionResult {
  /** The seed the world was generated from. */
  readonly seed: string;
  /** Every labelled chunk the session streamed, in order. */
  readonly events: readonly SessionEvent[];
  /** The post-session inspection. */
  readonly inspection: SessionInspection;
  /** The final world state after the session. */
  readonly finalState: WorldState;
}

/**
 * A fully-specified, deterministic {@link ScenarioConfig} the session generates
 * a world from when the caller gives none: the core pack with unit recruitment
 * weights and full narration, like the golden replay fixtures. No randomness and
 * no fs beyond the pack load, so a given seed regenerates the same world.
 */
function defaultScenario(preset: DifficultyPresetId): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset },
    mole: true,
    narration: 'full',
    packs: { dirs: ['packages/content/packs/core'], load: ['core'] },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

/**
 * Find a travel destination the engine will allow from the player's start.
 * Prefers a reachable Location that has a visible NPC this phase, so the
 * briefing and talk beats can open a Talk Scene there (task 8.2 gates `say`
 * behind an open scene, and the scripted start Location has no one present).
 * Falls back to the first reachable Location, then `undefined` when nowhere is
 * reachable — the session then skips the travel beat rather than emit a
 * rejected no-op.
 */
function pickDestination(api: EngineApi): LocId | undefined {
  const state = liveState(api);
  const here = state.player.loc;
  let firstReachable: LocId | undefined;
  for (const id of Object.keys(state.city.locations)) {
    if (id === here) {
      continue;
    }
    const loc = id as LocId;
    const action: Action = { kind: 'travel', to: loc, countersurveillance: false };
    if (!api.quote(action).allowed) {
      continue;
    }
    firstReachable ??= loc;
    if (visibleNpcsAt(state, loc).length > 0) {
      return loc;
    }
  }
  return firstReachable;
}

/** The brief Cable the game opens on, rendered for display. */
function renderBrief(api: EngineApi): string {
  const list = api.views.documents();
  const cableEntry = list.documents.find((d) => d.kind === 'cable');
  if (cableEntry === undefined) {
    return '(no brief Cable in this world)';
  }
  const doc = api.views.document(cableEntry.id);
  if (doc === undefined) {
    return `(brief Cable ${cableEntry.id} not readable)`;
  }
  return `${doc.title}\n${doc.body}`;
}

/** The brief Cable's DocId, if the world opens on one. */
function briefCableId(state: WorldState): DocId | undefined {
  const cable = Object.values(state.documents).find((d) => d.kind === 'cable');
  return cable?.id;
}

/** Drain one turn stream into the sink under a beat label, collecting chunks. */
async function drive(
  beat: SessionBeat,
  stream: AsyncIterable<TurnChunk>,
  sink: SessionSink | undefined,
  events: SessionEvent[],
): Promise<void> {
  for await (const chunk of stream) {
    const event: SessionEvent = { beat, chunk };
    events.push(event);
    sink?.(event);
  }
}

/**
 * Open a Talk Scene with a present NPC so the following `say` beat reaches the
 * voice seam. Task 8.2 added a "no open Talk Scene" gate to the dialogue turn:
 * a `say` with no scene open is refused with a fixed Fact Line and makes no
 * model call. The scripted session therefore runs a `talk` action first — on
 * the first NPC the scene shows as present — to open the Dialogue Loop, draining
 * its chunks under the same beat label. Returns whether a scene was opened; when
 * no one is present the caller still runs the `say` (it will be refused, which
 * the session treats as a benign no-op for that beat).
 */
async function openSceneWith(
  api: EngineApi,
  beat: SessionBeat,
  sink: SessionSink | undefined,
  events: SessionEvent[],
): Promise<boolean> {
  const state = liveState(api);
  const present = visibleNpcsAt(state, state.player.loc).at(0);
  if (present === undefined) {
    return false;
  }
  const talk: Action = { kind: 'talk', npc: present };
  if (!api.quote(talk).allowed) {
    return false;
  }
  await drive(beat, api.act(talk), sink, events);
  return true;
}

/**
 * Run the scripted first-live session (checkpoint 17) on the Composition Root.
 * Builds the game with {@link createGame}, starts a new game on the seed, drives
 * the beats through `api.newGame`/`act`/`say`/`endScene`, and returns every
 * streamed chunk plus the post-session inspection. Deterministic in
 * `(seed, preset)` for the engine side; the model-side behaviour is whatever the
 * injected Gateway/seams produce.
 */
export async function runSession(options: SessionOptions): Promise<SessionResult> {
  const preset = options.preset ?? 'standard';
  const scenario = options.scenario ?? defaultScenario(preset);

  const game = createGame({
    repoRoot: options.repoRoot,
    scenario,
    models: options.models,
    ...(options.gateway !== undefined ? { gateway: options.gateway } : {}),
    ...(options.seams !== undefined ? { seams: options.seams } : {}),
  });

  try {
    const { api } = game;

    // Start a new game. `newGame` generates the world, swaps in a fresh set of
    // stores and seeds the Case File with the brief Cable's lead Claims — the
    // opening leads the REPL used to file by hand (task 9.1), now owned by the
    // facade.
    await api.newGame({
      seed: options.seed,
      preset,
      mole: scenario.mole,
      narration: scenario.narration,
    });

    // The brief Cable is shown before any turn (independent of the model).
    const brief = renderBrief(api);

    const events: SessionEvent[] = [];
    const sink = options.sink;

    // Beat 1: read the brief Cable through the pipeline. The committed read
    // records the Cable's Fact Lines into the Journal; its asserted Propositions
    // are already in the Case File (seeded by `newGame`), so the beat exercises
    // the read turn end to end without a second claim-filing step.
    const cableId = briefCableId(liveState(api));
    if (cableId !== undefined) {
      const read: Action = { kind: 'read', doc: cableId };
      await drive('read-brief', api.act(read), sink, events);
    }

    // Beat 2: travel to a Location where a contact is present. The scripted
    // start Location has no one to speak to, so the session moves to a reachable
    // Location with a visible NPC first; the briefing and talk beats then open a
    // Talk Scene there (task 8.2 gates `say` behind an open scene).
    const destination = pickDestination(api);
    if (destination !== undefined) {
      const travel: Action = { kind: 'travel', to: destination, countersurveillance: false };
      await drive('travel', api.act(travel), sink, events);
    }

    // Beat 3: in-person briefing — open a scene with a present contact, then a
    // dialogue line to them (the `say` reaches the voice seam only with a scene
    // open; task 8.2's gate).
    await openSceneWith(api, 'briefing', sink, events);
    await drive('briefing', api.say(BRIEFING_LINE), sink, events);

    // Beat 4: close the briefing scene before the surveil so the surveil runs in
    // the open and the later talk opens a fresh scene.
    await drive('endScene', api.endScene(), sink, events);

    // Beat 5: surveil the current Location with streaming narration.
    const surveil: Action = { kind: 'surveil', at: liveState(api).player.loc, phases: 1 };
    await drive('surveil', api.act(surveil), sink, events);

    // Beat 6: open a scene with a present NPC, then talk to them (the voice model
    // under the guards). The `talk` action opens the Dialogue Loop so the `say`
    // reaches the seam rather than the no-scene gate (task 8.2).
    await openSceneWith(api, 'talk', sink, events);
    await drive('talk', api.say(NPC_LINE), sink, events);

    // Beat 7: close the scene (applies the extraction boundary and commits).
    await drive('endScene', api.endScene(), sink, events);

    const inspection: SessionInspection = {
      claims: api.caseFile.list({}),
      journal: api.views.journal(),
      truthDump: renderTruthDump(liveState(api), liveTruth(api)),
      brief,
    };

    return { seed: options.seed, events, inspection, finalState: liveState(api) };
  } finally {
    await game.close();
  }
}

/**
 * Render the ground-truth reveal dump for the session, if the facade exposes the
 * Truth Store (it does for a game started through the Composition Root). With no
 * Truth Store in reach the dump is a one-line note rather than a throw, so the
 * session stays total.
 */
function renderTruthDump(state: WorldState, truth: TruthStore | undefined): string {
  if (truth === undefined) {
    return '(no Truth Store available for the ground-truth reveal)';
  }
  return renderWorldDump(state, truth, { reveal: true });
}

/**
 * Render a {@link SessionResult}'s post-session inspection as sectioned text
 * for stdout: the Case File Claims, the Journal fact log and notes, and the
 * ground-truth reveal. The brief and the streamed chunks are printed live by
 * the CLI as the session runs; this is the end-of-session summary.
 */
export function renderInspection(inspection: SessionInspection): string {
  const claimLines =
    inspection.claims.length === 0
      ? ['  (no claims recorded)']
      : inspection.claims.map(
          (c) =>
            `  [${c.relation}] (${c.source.kind}) ${c.prop.subject} --${c.prop.predicate}--> ${formatObject(
              c.prop.object,
            )}`,
        );

  const journalLines =
    inspection.journal.entries.length === 0
      ? ['  (no fact log entries)']
      : inspection.journal.entries.flatMap((e) =>
          e.factLines.map((line) => `  d${e.at.day}.p${e.at.phase}  ${line}`),
        );

  const noteLines = inspection.journal.notes.map((n) => `  note: ${n.text}`);

  return [
    '== Case File ==',
    ...claimLines,
    '',
    '== Journal ==',
    ...journalLines,
    ...noteLines,
    '',
    '== Truth records (ground truth) ==',
    inspection.truthDump.trimEnd(),
    '',
  ].join('\n');
}

/** Format a Claim's object (an entity id or a literal) for a one-line render. */
function formatObject(object: ClaimView['prop']['object']): string {
  if (typeof object === 'string') {
    return object;
  }
  return `${object.kind}(${String(object.value)})`;
}
