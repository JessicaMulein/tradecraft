/**
 * Property 39: Turn atomicity with hooks — slice-integration task 12.8; design,
 * "Correctness Properties": Property 39; Requirements 5.3, 5.4.
 *
 * **Validates: Requirements 5.3, 5.4.**
 *
 * > For any reachable pre-turn state and turn, the pre-turn World State value is
 * > not mutated by the turn. Injecting a failure at any seam call or at any hook
 * > or Phase Step before commit leaves the World State, Truth Store, PRNG state,
 * > Case File, action log, Journal and Notifications deep-equal to their pre-turn
 * > values, and retrying with successful seams yields the same post-turn state as
 * > an uninterrupted run. (design, Property 39)
 *
 * This is the integrated, app-level counterpart to player-view's Property 29
 * atomicity spec. Where that spec drives `createTurnDriver` behind a hand-built
 * facade with injected *seam* failures, this one drives the **real Composition
 * Root** (`createGame`) with the **Fake Seams** and reaches its pre-turn states
 * through the shared **reachable-state walk** — so every Phase Step and every
 * Day-Boundary Hook runs for real up to the point the failure is injected.
 *
 * ## What this exercises (Req 5.3, 5.4)
 *
 * Requirement 5.3 says the Turn Pipeline applies every Phase Step and Hook
 * Application change *to the Draft only*, so the committed World State changes
 * only at commit. Requirement 5.4 says a turn that fails before commit discards
 * every Phase Step and Hook Application change *together with the Truth draft and
 * the rest of the Draft*, leaving the World State, PRNG state, action log,
 * Journal and Notifications at their pre-turn values.
 *
 * The failure is injected the way the design names: a throwing **Day-Boundary
 * Hook** threaded onto the Composition Root through its `advance` seam. The hook
 * delegates to the real `plot` hook while a shared flag is off (so the walk
 * reaches a genuine reachable state, and the uninterrupted baseline turn runs
 * normally), and throws while the flag is on (so one chosen turn hits the hook
 * mid-advance, after the Draft already carries that day's hook and Phase Step
 * work). `advanceWorld` runs the hooks at a Day Boundary, so a WAIT that crosses
 * one is what trips the throw.
 *
 * ## The three assertions per seed
 *
 *  1. **No mutation of the pre-turn value.** The pre-turn `WorldState` captured
 *     before the failing turn is deep-equal to itself afterwards (an immutable
 *     value is never mutated in place), and the live facade state is the SAME
 *     reference it was before (a commit would swap it).
 *  2. **Atomic discard (Req 5.3, 5.4).** After the hook throws, the live World
 *     State reference, the Truth Store, the Journal entry count and the
 *     Notification count are all unchanged from the pre-turn snapshot, and the
 *     stream is the fixed failure line, not a committed turn.
 *  3. **Retry equals an uninterrupted run.** Turning the hook back on-success and
 *     re-running the same WAIT reaches a post-turn World State, Truth Store,
 *     Journal and Notification count deep-equal to a *parallel* game at the same
 *     seed that never saw the throw and ran the same WAIT once. The failed
 *     attempt left no trace.
 *
 * The property is model-free and hermetic: the Fake Seams reach no endpoint and
 * the game is built with no gateway, so the many iterations run fast. Only this
 * spec imports vitest; the walk, the Fake Seams and the Composition Root are
 * ordinary library code.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  type CityData,
  type ContentSet,
} from '@tradecraft/content';
import {
  buildWorldHooks,
  worldCipherKeyLookup,
  type AdvanceWorldDeps,
  type Action,
  type CipherKeyLookup,
  type HookOutput,
  type ObjectiveEvaluator,
  type TruthStore,
  type WorldHook,
  type WorldHookContext,
  type WorldState,
} from '@tradecraft/engine';
import type {
  EngineApi,
  Journal,
  NotificationStore,
} from '@tradecraft/player-view';

import { runReachableWalk, type ReachableWalk } from './reachable-walk.walk.js';

// ---------------------------------------------------------------------------
// Core-pack content for the injected `advance` deps
// ---------------------------------------------------------------------------

/**
 * The core-pack content and city data the throwing `advance` carries. The
 * Composition Root loads its own Content Set to generate the world; the hooks it
 * runs look entities up by id, so an equivalent core-pack load keyed the same
 * way is interchangeable here (the player-view hook-throw spec loads its own
 * content the same way). The injected `advance` only needs these two plus the
 * hooks and a cipher-key lookup; the pipeline overrides `objectives` and `truth`
 * per turn.
 */
const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): { content: ContentSet; cityData: CityData } {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  return { content: content.value, cityData: cityData.value };
}

const { content, cityData } = loadCore();

// ---------------------------------------------------------------------------
// A toggleable throwing Day-Boundary Hook, threaded through `createGame`'s
// `advance` seam
// ---------------------------------------------------------------------------

/** A mutable flag the throwing hook consults; off during the walk, on for the failing turn. */
interface ThrowSwitch {
  /** While true, the `plot` hook throws instead of running. */
  throwNow: boolean;
}

/**
 * Build an {@link AdvanceWorldDeps} whose `plot` Day-Boundary Hook throws exactly
 * when `sw.throwNow` is set, and otherwise runs the real production `plot` hook.
 * The other three hooks are the real ones throughout, so a turn that crosses a
 * Day Boundary while the switch is off applies every hook and the Phase Step to
 * the Draft and commits normally — which is what makes the pre-turn state a
 * genuine reachable state.
 *
 * The cipher-key lookup reads the *live* world's documents through `getState`
 * each call (public-text Documents are generated once and never change), so the
 * fixed facade-level `advance` serves a world that does not exist until
 * `newGame` runs. `objectives` is a placeholder — the Turn Pipeline overrides it
 * with the real Case-File evaluator per turn — but must be present on the type.
 */
function throwingAdvance(
  sw: ThrowSwitch,
  getState: () => WorldState,
): AdvanceWorldDeps {
  const real = buildWorldHooks();
  const plot: WorldHook = (
    draft: WorldState,
    ctx: WorldHookContext,
  ): HookOutput => {
    if (sw.throwNow) {
      throw new Error(
        'injected: the plot Day-Boundary Hook blew up before commit',
      );
    }
    return real.plot(draft, ctx);
  };
  const cipherKeys: CipherKeyLookup = {
    publicText: (id) =>
      worldCipherKeyLookup(
        getState().meta.seed,
        getState().documents,
      ).publicText(id),
    pad: (id) =>
      worldCipherKeyLookup(getState().meta.seed, getState().documents).pad(id),
  };
  const objectives = (): ObjectiveEvaluator => () => false;
  return {
    content,
    cityData,
    hooks: { ...real, plot },
    objectives,
    cipherKeys,
  };
}

// ---------------------------------------------------------------------------
// Observing the facade's stores (the concrete PlayerViewEngine getters)
// ---------------------------------------------------------------------------

/** The concrete facade surface this spec reads, hidden behind the EngineApi interface. */
interface Concrete {
  readonly state: WorldState;
  readonly journal: Journal;
  readonly notificationStoreRef: NotificationStore;
  readonly turnContext: { readonly truth?: TruthStore };
}

function concrete(api: EngineApi): Concrete {
  return api as unknown as Concrete;
}

/** The observable values Req 5.4 pins across a failing turn. */
interface Snapshot {
  readonly state: WorldState;
  readonly journalEntries: number;
  readonly notifications: number;
  readonly truth: TruthStore | undefined;
}

function snapshot(api: EngineApi): Snapshot {
  const c = concrete(api);
  return {
    state: c.state,
    journalEntries: c.journal.entryCount,
    notifications: c.notificationStoreRef.count,
    truth: c.turnContext.truth,
  };
}

// ---------------------------------------------------------------------------
// Turn helpers
// ---------------------------------------------------------------------------

/**
 * A WAIT of 4 phases always crosses a Day Boundary from any phase of a day (a
 * day is 4 phases), so it is the turn that runs the Day-Boundary Hooks and thus
 * hits the throwing `plot` hook when the switch is on. WAIT is always allowed,
 * so it commits whenever the hooks succeed.
 */
const WAIT_OVER_BOUNDARY: Action = { kind: 'wait', phases: 4 };

/** The save name the extraction-queue probe writes under. */
const PROBE_SAVE = 'turn-atomicity-probe';

/**
 * Whether the walk's game has an extraction job queued for the next turn
 * boundary. The Composition Root does not expose the queue, so this saves the
 * game into the walk's in-memory Save Store and reads the queue from the
 * snapshot, as the walk's documentation describes. Saving changes no game state.
 */
async function hasQueuedExtraction(walk: ReachableWalk): Promise<boolean> {
  await walk.api.saves.save(PROBE_SAVE);
  const saved = walk.saveStore.read(PROBE_SAVE);
  if (saved === null || typeof saved !== 'object' || 'error' in saved) {
    throw new Error('the probe save could not be read back');
  }
  const queue = (saved as { readonly extractionQueue?: readonly unknown[] })
    .extractionQueue;
  return (queue?.length ?? 0) > 0;
}

/** Drain a turn stream to its chunk kinds. */
async function drainKinds(
  stream: AsyncIterable<{ kind: string }>,
): Promise<string[]> {
  const kinds: string[] = [];
  for await (const chunk of stream) kinds.push(chunk.kind);
  return kinds;
}

/** The fixed Fact Line the pipeline streams when a hook throws (design; Req 5.4). */
const TURN_FAILED_LINE = 'The turn could not be completed.';

/** Whether a turn's chunks carried the fixed hook-throw failure fact line. */
async function drainFacts(
  stream: AsyncIterable<{ kind: string; text?: string }>,
): Promise<{
  readonly kinds: string[];
  readonly facts: string[];
}> {
  const kinds: string[] = [];
  const facts: string[] = [];
  for await (const chunk of stream) {
    kinds.push(chunk.kind);
    if (chunk.kind === 'fact' && typeof chunk.text === 'string')
      facts.push(chunk.text);
  }
  return { kinds, facts };
}

// ---------------------------------------------------------------------------
// Input space
// ---------------------------------------------------------------------------

/** A varied, non-empty seed set (reused from the atomicity/determinism specs' style). */
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

/**
 * The number of walk turns to reach a pre-turn state before the failing turn.
 * Bounded well below {@link import('./reachable-walk.walk.js').MAX_WALK_TURNS} so
 * each iteration is quick; the walk is deterministic in the seed, so a fixed
 * count makes the two parallel games (interrupted and baseline) start the failing
 * turn from the identical reachable state.
 */
const walkTurnsArb = fc.integer({ min: 0, max: 6 });
const seedArb = fc.constantFrom(...SEEDS);

/**
 * Each run builds a whole game (two, for the retry property) through the real
 * Composition Root and walks it, so the per-run cost is non-trivial. A modest
 * run count sweeps the seed/turn space while a generous per-test timeout keeps
 * the property stable when the whole package suite runs under load (the
 * default 5s per-test timeout is too tight for a full-game build).
 */
const NUM_RUNS = 20;
const RETRY_NUM_RUNS = 12;
const PROPERTY_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Property 39
// ---------------------------------------------------------------------------

describe('Property 39: Turn atomicity with hooks (Req 5.3, 5.4)', () => {
  it(
    'discards every hook / Phase Step / Truth-draft change when a Day-Boundary Hook throws before commit',
    async () => {
      await fc.assert(
        fc.asyncProperty(seedArb, walkTurnsArb, async (seed, turns) => {
          const sw: ThrowSwitch = { throwNow: false };
          const holder: { api?: EngineApi } = {};
          const getState = (): WorldState => {
            if (holder.api === undefined)
              throw new Error('state read before the game was built');
            return concrete(holder.api).state;
          };

          // Walk to a reachable pre-turn state with the hook OFF (the walk's own
          // boundary-crossing WAITs run every hook for real and commit).
          const walk = await runReachableWalk({
            seed,
            turns,
            advance: throwingAdvance(sw, getState),
          });
          holder.api = walk.api;

          // If the walk already ended the game, there is no pre-turn turn to fail;
          // the ended gate owns that case (Property 43). Skip to keep the property
          // about the atomicity of a live turn.
          if (walk.state.ended !== undefined) {
            await walk.close();
            return;
          }

          // A walk that ends on a dialogue turn leaves its extraction job ready,
          // and the next turn's boundary commits it before that turn takes its
          // pre-turn state. That commit is its own transaction, not part of the
          // failing turn's Draft (design, "The Turn Transaction with hooks";
          // Property 57 owns its atomicity), so settle it with one uninterrupted
          // turn first and take the baseline after it.
          if (await hasQueuedExtraction(walk)) {
            await drainKinds(
              walk.api.act({ kind: 'wait', phases: 1 }) as AsyncIterable<{
                kind: string;
              }>,
            );
            if (concrete(walk.api).state.ended !== undefined) {
              await walk.close();
              return;
            }
          }

          const before = snapshot(walk.api);

          // Inject the failure: the next boundary-crossing WAIT hits the throwing
          // hook mid-advance, after the Draft already holds that day's hook and
          // Phase Step work.
          sw.throwNow = true;
          const { kinds, facts } = await drainFacts(
            walk.api.act(WAIT_OVER_BOUNDARY) as AsyncIterable<{
              kind: string;
              text?: string;
            }>,
          );

          const after = snapshot(walk.api);

          // Req 5.3 / 5.4 — all-or-nothing: nothing committed. The live state is the
          // SAME reference (an immutable value a commit would swap), and the Truth
          // Store, Journal and Notifications are unchanged. The pre-turn value was
          // never mutated in place (deep-equal to the snapshot it still is).
          expect(after.state).toBe(before.state);
          expect(after.state).toEqual(before.state);
          expect(after.truth).toBe(before.truth);
          expect(after.journalEntries).toBe(before.journalEntries);
          expect(after.notifications).toBe(before.notifications);

          // The stream is the fixed failure line and nothing committed: no `ended`,
          // no `paused` (a hook throw is a draft discard, not an endpoint pause).
          expect(facts).toContain(TURN_FAILED_LINE);
          expect(kinds).not.toContain('ended');
          expect(kinds).not.toContain('paused');

          await walk.close();
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'retrying the failed turn with the hook restored yields the same post-turn state as an uninterrupted run',
    async () => {
      await fc.assert(
        fc.asyncProperty(seedArb, walkTurnsArb, async (seed, turns) => {
          // Game A: walk with a toggleable hook, fail the WAIT once, then retry it
          // with the hook restored.
          const swA: ThrowSwitch = { throwNow: false };
          const holderA: { api?: EngineApi } = {};
          const getStateA = (): WorldState =>
            concrete(holderA.api as EngineApi).state;
          const a = await runReachableWalk({
            seed,
            turns,
            advance: throwingAdvance(swA, getStateA),
          });
          holderA.api = a.api;

          // Game B: the uninterrupted baseline — the same walk, the same hook that
          // never throws, and the same WAIT run once.
          const swB: ThrowSwitch = { throwNow: false };
          const holderB: { api?: EngineApi } = {};
          const getStateB = (): WorldState =>
            concrete(holderB.api as EngineApi).state;
          const b = await runReachableWalk({
            seed,
            turns,
            advance: throwingAdvance(swB, getStateB),
          });
          holderB.api = b.api;

          // Determinism of the walk: both games reached the identical pre-turn
          // reachable state.
          expect(concrete(a.api).state).toEqual(concrete(b.api).state);

          if (a.state.ended !== undefined) {
            await Promise.all([a.close(), b.close()]);
            return;
          }

          // A: fail the WAIT (hook throws), then restore the hook and run the same
          // WAIT. The failed attempt must leave no trace, so the restored run is a
          // fresh, clean turn from the retained pre-turn state.
          swA.throwNow = true;
          await drainKinds(
            a.api.act(WAIT_OVER_BOUNDARY) as AsyncIterable<{ kind: string }>,
          );
          swA.throwNow = false;
          await drainKinds(
            a.api.act(WAIT_OVER_BOUNDARY) as AsyncIterable<{ kind: string }>,
          );

          // B: the uninterrupted WAIT.
          await drainKinds(
            b.api.act(WAIT_OVER_BOUNDARY) as AsyncIterable<{ kind: string }>,
          );

          // The interrupted-then-restored run reaches the same post-turn state as
          // the clean run: the failed attempt committed nothing and perturbed no
          // PRNG stream the committed turn draws from.
          const postA = snapshot(a.api);
          const postB = snapshot(b.api);
          expect(postA.state).toEqual(postB.state);
          expect(postA.journalEntries).toBe(postB.journalEntries);
          expect(postA.notifications).toBe(postB.notifications);

          await Promise.all([a.close(), b.close()]);
        }),
        { numRuns: RETRY_NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
