/**
 * Feature: slice-integration, Property 55: Dialogue effects precede the reply
 * (task 12.10).
 *
 * **Validates: Requirements 15.5, 15.7, 15.10**
 *
 * The design states (slice-integration design, "Property 55: Dialogue effects
 * precede the reply"):
 *
 * > For any reachable state with an open Talk Scene, any line, any Intent and
 * > any money offer the Budget covers, the state the voice seam observes has the
 * > scene NPC's Relationship equal to `applyIntent` (and, for a pitch,
 * > `resolvePitch`'s effects) applied to the pre-turn Relationship; the committed
 * > Budget equals the pre-turn Budget minus the offer; and every `speech`
 * > chunk's speaker equals the namer's player-facing name for the scene NPC.
 *
 * This drives the real {@link createGame} Composition Root behind the real
 * {@link EngineApi}, with the model-touching steps replaced by Fake Seams
 * (Req 18.3): a *controlled* classify seam (so the property picks the Intent),
 * an *instrumented* voice seam (so the property observes exactly when the reply
 * is produced), the fact-only narrate seam, and the real pure
 * `evaluateExtraction` for the extraction boundary. Nothing reaches an endpoint.
 *
 * ## What the pipeline promises, and how this observes it
 *
 * On a dialogue turn the Turn Pipeline (`player-view/turn-pipeline.ts`) runs, in
 * order: classify the line → `applyDialogueTurn` on the Draft (the Intent moves
 * the scene NPC's Relationship, a `pitch-*` resolves on the Draft PRNG and
 * debits a money offer, Req 15.5/15.7) → the voice seam produces the reply →
 * `engine.commit(draft)` → the `speech` chunks stream. So the effects are
 * applied to the Draft *before* the reply is produced, and the reply only
 * reaches the player (as `speech` chunks) *after* the commit that carries those
 * effects. The property pins both halves:
 *
 *  1. **The reply is produced before it streams, and after the effects
 *     (ordering).** The instrumented voice seam records the number of `speech`
 *     chunks that had streamed to the player when it ran — always 0, because the
 *     pipeline streams `speech` only after the commit that follows voice. With
 *     the committed-state check below, this witnesses that the Draft already
 *     carried the Intent/pitch/offer effects by the time the reply was built,
 *     and that the reply reached the player only after that commit.
 *  2. **The committed Relationship and Budget equal the oracle.** The oracle is
 *     the engine's own pure `applyDialogueTurn` replayed on the pre-turn state
 *     with a PRNG seeded identically to the one the pipeline opens
 *     (`createPrng(pre.rng)`), so a pitch draws the same coin. The committed
 *     `relationships[npc]` deep-equals the oracle's, and the committed Budget
 *     equals the pre-turn Budget minus the money offer (zero for a non-money
 *     Intent, Req 15.7).
 *  3. **Every `speech` chunk is named by the namer.** Each `speech` chunk's
 *     `speaker` equals `personLabel(pre, npc).label` — the player-facing name
 *     the namer gives (name if identified, descriptor otherwise, Req 15.10).
 *
 * ## Reaching a scene
 *
 * The property needs a *reachable* state with an open Talk Scene. It builds the
 * real game, starts a new game on the seed, and plays `talk` actions against the
 * people present (the catalogue always offers one when someone is at the
 * player's Location) until a scene opens, bounded so an unlucky seed simply
 * yields no scene and is skipped. A scene reached this way is reachable by
 * construction (the Composition Root drove every turn).
 *
 * This file is the only one here that imports vitest/fast-check; the harness it
 * shares with the sibling properties (the Composition Root, the Fake Seams) is
 * library code.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  applyDialogueTurn,
  balance,
  createPrng,
  INTENTS,
  type Action,
  type Intent,
  type NpcId,
  type Prng,
  type Relationship,
  type TalkScene,
  type WorldState,
} from '@tradecraft/engine';
import { evaluateExtraction } from '@tradecraft/dialogue';
import { loadContent, type PredicateRegistry } from '@tradecraft/content';
import {
  InMemorySaveStore,
  personLabel,
  type ClassifySeam,
  type EngineApi,
  type NewGameOptions,
  type TurnChunk,
  type TurnPipelineConfig,
  type VoiceSeam,
} from '@tradecraft/player-view';

import { createGame } from './composition-root.js';
import { buildFakeSeams } from './fake-seams.js';
import { WALK_REPO_ROOT, walkModels, walkScenario } from './reachable-walk.walk.js';

// ---------------------------------------------------------------------------
// Static fixtures
// ---------------------------------------------------------------------------

/** The scenario the harness generates worlds from (the core pack, like the walk). */
const SCENARIO = walkScenario();
const MODELS = walkModels();

/** The compiled predicate registry the Fake extraction seam derives its schema from. */
function contentPredicates(): PredicateRegistry {
  const dirs = SCENARIO.packs.dirs.map((dir) => `${WALK_REPO_ROOT}/${dir}`);
  const content = loadContent([...dirs], [...SCENARIO.packs.load]);
  if (!content.ok) {
    throw new Error('the Property 55 harness failed to load the Content Packs');
  }
  return content.value.predicates;
}

const PREDICATES = contentPredicates();

/** The most navigation turns the harness plays trying to open a scene. */
const MAX_OPEN_SCENE_TURNS = 30;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Drain a turn stream to its chunks, counting `speech` as they stream. */
async function drainCounting(
  stream: AsyncIterable<TurnChunk>,
  onSpeech: () => void,
): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    if (chunk.kind === 'speech') {
      onSpeech();
    }
    chunks.push(chunk);
  }
  return chunks;
}

/** Drain a turn stream to its chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  return drainCounting(stream, () => undefined);
}

/** Read the live world state off the facade (the `state` getter the seams use). */
function stateOf(api: EngineApi): WorldState {
  return (api as unknown as { readonly state: WorldState }).state;
}

/** Whether a turn's chunks included an `ended` chunk (the game is over). */
function endedIn(chunks: readonly TurnChunk[]): boolean {
  return chunks.some((c) => c.kind === 'ended');
}

/**
 * The outcome of driving one controlled `say` turn: the chunks it streamed and
 * the number of `speech` chunks that had reached the player at the moment the
 * voice seam ran (the ordering witness, always 0).
 */
interface SayObservation {
  readonly chunks: readonly TurnChunk[];
  readonly voiceRan: boolean;
  readonly speechStreamedWhenVoiceRan: number;
}

/** A built game plus the controls the property drives it with. */
interface Harness {
  readonly api: EngineApi;
  /** Set the Intent the controlled classify seam returns for the next `say`. */
  readonly setIntent: (intent: Intent) => void;
  /** Drive one `say` turn, returning the ordering observation. */
  readonly say: (line: string, offer?: number) => Promise<SayObservation>;
  readonly close: () => Promise<void>;
}

/**
 * Build the real game through the Composition Root with the Fake Seams, with the
 * classify and voice seams swapped for a controlled/instrumented pair. The
 * controlled classify returns whatever {@link Harness.setIntent} last set; the
 * instrumented voice records how many `speech` chunks had streamed when it ran
 * (0, since the pipeline streams speech only after the post-voice commit). The
 * Fake voice is kept for its reply shape — it names only allowed aliases, so the
 * Leak Guard never trips.
 */
function buildHarness(seed: string): Harness {
  const holder: { api?: EngineApi } = {};
  const getState = (): WorldState => {
    if (holder.api === undefined) {
      throw new Error('the harness read state before the game was built');
    }
    return stateOf(holder.api);
  };

  const fake = buildFakeSeams({ seed, getState, predicates: PREDICATES });
  const fakeVoice = fake.voice as VoiceSeam;

  let intent: Intent = 'ask';
  const classify: ClassifySeam = () => Promise.resolve(intent);

  // Shared between the voice seam and the active `say` drain: the running count
  // of `speech` chunks the player has seen this turn, and what it was when voice
  // ran. A `say` call resets them.
  let speechSoFar = 0;
  let voiceRan = false;
  let speechStreamedWhenVoiceRan = -1;

  const voice: VoiceSeam = (line, classified, scene) => {
    voiceRan = true;
    speechStreamedWhenVoiceRan = speechSoFar;
    return fakeVoice(line, classified, scene);
  };

  const seams: Partial<TurnPipelineConfig> = {
    ...fake,
    classify,
    voice,
    evaluateExtraction,
  };

  const game = createGame({
    repoRoot: WALK_REPO_ROOT,
    scenario: SCENARIO,
    models: MODELS,
    seams,
    saveStore: new InMemorySaveStore(),
  });
  holder.api = game.api;

  return {
    api: game.api,
    setIntent: (next: Intent): void => {
      intent = next;
    },
    say: async (line: string, offer?: number): Promise<SayObservation> => {
      speechSoFar = 0;
      voiceRan = false;
      speechStreamedWhenVoiceRan = -1;
      const chunks = await drainCounting(
        game.api.say(line, offer === undefined ? undefined : { offer }),
        () => {
          speechSoFar += 1;
        },
      );
      return { chunks, voiceRan, speechStreamedWhenVoiceRan };
    },
    close: game.close,
  };
}

/**
 * Pick the navigation action to play next, exploring toward a Talk Scene. A
 * `talk` on a present person opens one directly, so it is strongly preferred;
 * otherwise the walk `travel`s (to reach a Location where someone is scheduled)
 * or waits a phase (to let schedules bring someone to the current Location).
 * `say`/`endScene` are never chosen, so the controlled classify/voice seams are
 * untouched before the measured `say`. Returns `undefined` when nothing is
 * allowed. Seeded by `rng` so the exploration is deterministic.
 */
function pickNavigation(api: EngineApi, rng: Prng): Action | undefined {
  const allowed = api.actions().filter((o) => o.quote.allowed);
  const byKind = (kind: Action['kind']): Action[] =>
    allowed.filter((o) => o.action.kind === kind).map((o) => o.action);

  const talks = byKind('talk');
  if (talks.length > 0) {
    return talks[rng.int(0, talks.length - 1)];
  }
  // No one here to talk to: travel to a known Location, or wait for a schedule
  // to bring someone here. Mix travel and wait so the walk both moves and lets
  // time pass; fall back to any allowed action otherwise.
  const travels = byKind('travel');
  const waits = byKind('wait');
  const pools = [travels, waits].filter((p) => p.length > 0);
  if (pools.length > 0) {
    const pool = pools[rng.int(0, pools.length - 1)];
    return pool[rng.int(0, pool.length - 1)];
  }
  return allowed.length > 0 ? allowed[rng.int(0, allowed.length - 1)].action : undefined;
}

/**
 * Start a new game on the seed and play navigation turns (travel/talk/wait,
 * never `say`) until a Talk Scene opens, bounded by {@link MAX_OPEN_SCENE_TURNS}.
 * Returns the scene NPC id, or `undefined` when no scene opened in the budget
 * (the game may also end first) — the property skips such a seed. The scene is
 * reachable by construction (the Composition Root drove every turn).
 */
async function openScene(harness: Harness, seed: string): Promise<NpcId | undefined> {
  const { api } = harness;
  const opts: NewGameOptions = {
    seed,
    preset: 'standard',
    mole: SCENARIO.mole,
    narration: SCENARIO.narration,
  };
  await api.newGame(opts);

  const navRng = createPrng(`p55-nav:${seed}`);
  for (let i = 0; i < MAX_OPEN_SCENE_TURNS; i += 1) {
    const scene = stateOf(api).player.scene;
    if (scene !== undefined) {
      return scene.npc;
    }
    const action = pickNavigation(api, navRng);
    if (action === undefined) {
      return undefined;
    }
    const chunks = await drain(api.act(action));
    if (endedIn(chunks)) {
      return undefined;
    }
  }
  return stateOf(api).player.scene?.npc;
}

/**
 * The oracle for a dialogue turn: the engine's own pure {@link applyDialogueTurn}
 * replayed on the pre-turn state with a PRNG seeded exactly as the pipeline's
 * (`createPrng(pre.rng)`), so a pitch draws the same coin. Returns the scene
 * NPC's expected Relationship and the expected Budget after the turn.
 */
function oracle(
  pre: WorldState,
  scene: TalkScene,
  intent: Intent,
  offer: number | undefined,
): { readonly rel: Relationship; readonly budget: number } {
  const rng = createPrng(pre.rng);
  const result = applyDialogueTurn(
    pre,
    scene,
    { line: 'oracle', intent, ...(offer === undefined ? {} : { offer }) },
    rng,
    pre.meta.scenario.recruitment.pitch,
  );
  const npc = scene.npc;
  const rel = result.state.relationships[npc];
  if (rel === undefined) {
    throw new Error('the oracle produced no Relationship for the scene NPC');
  }
  return { rel, budget: balance(result.state.station.ledger) };
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

const NUM_RUNS = 40;
const PROPERTY_TIMEOUT_MS = 60_000;

describe('Property 55: dialogue effects precede the reply (task 12.10)', () => {
  it(
    'applies the Intent/pitch/offer to the Draft before the reply streams, and names speech by the namer (Req 15.5, 15.7, 15.10)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 100_000 }),
          fc.constantFrom(...INTENTS),
          // A line of plain words; the controlled classify ignores it, but it is
          // what the player said and what joins the scene's recent turns.
          fc.stringMatching(/^[a-z ]{1,24}$/),
          // Whether to attach a money offer, and how much (bounded well under a
          // typical Budget; the harness clamps it to the Budget below).
          fc.option(fc.integer({ min: 1, max: 400 }), { nil: undefined }),
          async (seedN, intent, line, rawOffer) => {
            const seed = `p55:${seedN}`;
            const harness = buildHarness(seed);
            try {
              const npc = await openScene(harness, seed);
              if (npc === undefined) {
                return; // No reachable scene for this seed in the budget; skip.
              }

              const pre = stateOf(harness.api);
              const scene = pre.player.scene;
              if (scene === undefined || scene.npc !== npc) {
                return;
              }

              // Only offer what the Budget covers (Req 15.7's precondition); an
              // uncovered offer is rejected before any seam, a different path.
              const available = balance(pre.station.ledger);
              const offer =
                rawOffer === undefined || available <= 0
                  ? undefined
                  : Math.min(rawOffer, available);

              const expected = oracle(pre, scene, intent, offer);
              const speakerName = personLabel(pre, npc).label;

              harness.setIntent(intent);
              const obs = await harness.say(line, offer);

              // The reply was produced (voice ran) and streamed as `speech`.
              expect(obs.voiceRan).toBe(true);
              const speech = obs.chunks.filter((c) => c.kind === 'speech');
              expect(speech.length).toBeGreaterThan(0);

              // Ordering: no `speech` had reached the player when the reply was
              // produced — the reply streams only after the post-voice commit
              // that carries the Draft's Intent/pitch/offer effects.
              expect(obs.speechStreamedWhenVoiceRan).toBe(0);

              // The committed Relationship equals applyIntent (+ pitch) on the
              // pre-turn Relationship (Req 15.5), and the Budget equals the
              // pre-turn Budget minus the money-pitch offer (Req 15.7). Only a
              // `pitch-money` Intent debits the offer; an offer attached to any
              // other Intent moves no money.
              const post = stateOf(harness.api);
              expect(post.relationships[npc]).toEqual(expected.rel);
              expect(balance(post.station.ledger)).toBe(expected.budget);
              const moneyDebit = intent === 'pitch-money' ? (offer ?? 0) : 0;
              expect(balance(post.station.ledger)).toBe(available - moneyDebit);

              // Every `speech` chunk is named by the namer's player-facing name
              // for the scene NPC (Req 15.10).
              for (const chunk of speech) {
                if (chunk.kind === 'speech') {
                  expect(chunk.speaker).toBe(speakerName);
                }
              }
            } finally {
              await harness.close();
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
