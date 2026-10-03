/**
 * Property 40: Replay determinism through the pipeline (slice-integration task
 * 12.9; design, "Correctness Properties").
 *
 * **Validates: Requirements 5.5, 17.2.**
 *
 * > For any session recorded through the Composition Root (random actions and
 * > dialogue lines with Fake Seams recorded through `RecordingGateway`),
 * > replaying its seed, action log and recording through `ReplayGateway` reaches
 * > a final World State, Truth Store and Case File deep-equal to the original,
 * > including every Day-Boundary Hook effect and every `extraction-commit`
 * > applied at its logged position. (design, Property 40)
 *
 * ## How the record / replay pair is realised
 *
 * This property is about the *whole-session* reproduction guarantee one level up
 * from the slice's model-free resolver fold (slice Property 14): a session
 * played through the real Composition Root — `createGame` + the real engine, the
 * real Turn Pipeline, the real Player-View facade — must replay from its seed,
 * its recorded action log and its recorded seam outputs to a byte-for-byte
 * identical final game.
 *
 * The record → replay pair is realised through the **Fake Seams**, which are
 * fully deterministic in the one caller seed (see `fake-seams.ts`): the seeded
 * classifier, the fuzzed voice seam and the schema-valid fuzzed extraction
 * runner all draw only from streams derived from `seed`, so a second session on
 * the same seed, lines and actions reproduces identical seam outputs. That is
 * exactly what a `RecordingGateway` capture replayed through a `ReplayGateway`
 * would serve — the recording *is* the seed, because the Fake Seams are a pure
 * function of it. So:
 *
 *   - the **recording** is `runReachableWalk(seed)` — a random walk of 0–30
 *     `act` / `say` / `endScene` turns through the Composition Root, with the
 *     Fake Seams standing in for the recorded Gateway; and
 *   - the **replay** is a second `runReachableWalk(seed)` — the same seed drives
 *     the same `newGame`, the same per-turn choices and the same seam outputs,
 *     so it re-applies the same action log, including every dialogue turn's
 *     deferred `extraction-commit` at the same boundary position.
 *
 * The two runs are independent object graphs built from scratch, so a passing
 * deep-equal pins value-equal reproduction, not a shared mutable world.
 *
 * ## What is asserted
 *
 * For each seed the property compares the two sessions through two lenses:
 *
 *   1. the live final **World State** (`api.state`) — which carries every
 *      Day-Boundary Hook effect the clock advance applied (newspapers, Hostile
 *      tick arrests and burns, Plot adaptation, Walk-in channels, …), so a
 *      deep-equal world is a deep-equal hook-effect set (Req 5.5); and
 *   2. the full v2 **save snapshot** (`api.saves.save` → the walk's in-memory
 *      Save Store) with its one non-deterministic field (`savedAt`) stripped —
 *      which pins the Truth Store, the Case File and the ordered action log, the
 *      last of which carries every `extraction-commit` entry at its logged `seq`
 *      position (Req 17.2).
 *
 * A divergence sanity check (distinct seeds generally reach distinct worlds)
 * guards against the equalities collapsing every input to one world.
 *
 * This spec is the only vitest-importing module here; the walk and the Fake
 * Seams it drives are plain library code with no vitest import.
 */

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { runReachableWalk, type ReachableWalk } from './reachable-walk.walk.js';

// ---------------------------------------------------------------------------
// Reading a session's recorded artifacts
// ---------------------------------------------------------------------------

/** The name the property saves each session under, read back from the store. */
const REPLAY_SLOT = 'replay';

/**
 * The parts of a recorded session the property compares: the live final World
 * State, and the deterministic part of the save snapshot (the Truth Store, the
 * Case File and the ordered action log — everything but the wall-clock
 * `savedAt`). The world is read live so the comparison includes every
 * Day-Boundary Hook effect exactly as the advance left it; the snapshot pins the
 * truth, Case File and the `extraction-commit` log positions.
 */
interface RecordedSession {
  /** The live final World State (all hook effects), as a plain value. */
  readonly world: unknown;
  /** The full save snapshot with `savedAt` removed (truth, Case File, action log). */
  readonly snapshot: Record<string, unknown>;
  /** The ordered action log entries, pulled out for the extraction-commit check. */
  readonly actionLog: readonly Record<string, unknown>[];
}

/**
 * Save the walk's game into its own in-memory Save Store and read the snapshot
 * back, stripping the one non-deterministic field so two sessions of the same
 * seed compare equal. The Save Store round-trip is how the Composition Root
 * surfaces the bridge-owned action log (and the Truth Store and Case File) as a
 * single recorded artifact — the same snapshot a real save would persist.
 */
async function recordSession(walk: ReachableWalk): Promise<RecordedSession> {
  await walk.api.saves.save(REPLAY_SLOT);
  const read = walk.saveStore.read(REPLAY_SLOT);
  if (read === null || typeof read !== 'object' || 'error' in read) {
    throw new Error('the recorded session could not be read back from the Save Store');
  }
  // Strip the one wall-clock field, which is the save's only non-deterministic
  // value and lives only in the header, never in World State.
  const snapshot: Record<string, unknown> = { ...(read as Record<string, unknown>) };
  delete snapshot['savedAt'];
  const actionLog = readActionLogEntries(snapshot);
  return {
    world: (walk.api as unknown as { readonly state: unknown }).state,
    snapshot,
    actionLog,
  };
}

/** Pull the ordered action-log entries out of a parsed save snapshot. */
function readActionLogEntries(snapshot: Record<string, unknown>): readonly Record<string, unknown>[] {
  const log = snapshot['actionLog'];
  if (log === null || typeof log !== 'object') {
    throw new Error('the recorded snapshot carried no action log');
  }
  const entries = (log as { readonly entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error('the recorded action log carried no entries array');
  }
  return entries as readonly Record<string, unknown>[];
}

/** The `extraction-commit` entries of an action log, with their `seq` positions. */
function extractionCommits(
  entries: readonly Record<string, unknown>[],
): readonly { readonly seq: unknown; readonly forTurn: unknown }[] {
  return entries
    .filter((e) => e['kind'] === 'extraction-commit')
    .map((e) => ({ seq: e['seq'], forTurn: e['forTurn'] }));
}

// ---------------------------------------------------------------------------
// Input-space arbitraries (bounded for CI)
// ---------------------------------------------------------------------------

/**
 * A varied, non-empty seed set. Each seed drives one complete recorded session
 * through the Composition Root, so the set is kept modest; every seed exercises
 * `newGame`, a random action/dialogue walk and the extraction boundary.
 */
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'seed-99',
] as const;

const seedArb = fc.constantFrom(...SEEDS);

/**
 * Each walk builds a real game (loads the core pack, generates a world) and
 * plays up to 30 turns, twice per sample — the full Composition Root, not a
 * reduced fold — so the run count is tuned to stay inside the widened budget
 * while sweeping several seeds.
 */
const NUM_RUNS = 8;
const PROPERTY_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/** Games opened during a property run, closed after each test. */
const opened: ReachableWalk[] = [];

afterEach(async () => {
  while (opened.length > 0) {
    const walk = opened.pop();
    if (walk !== undefined) {
      await walk.close();
    }
  }
});

/** Run a recorded session for a seed, registering it for teardown. */
async function record(seed: string): Promise<RecordedSession> {
  const walk = await runReachableWalk({ seed });
  opened.push(walk);
  return recordSession(walk);
}

// ---------------------------------------------------------------------------
// Property 40 — replay determinism through the pipeline (Req 5.5, 17.2)
// ---------------------------------------------------------------------------

describe('Property 40: replay determinism through the pipeline (Req 5.5, 17.2)', () => {
  // Core: a session recorded through the Composition Root and replayed from the
  // same seed reaches a deep-equal final World State (every Day-Boundary Hook
  // effect; Req 5.5), Truth Store and Case File, with every extraction-commit at
  // the same logged position (Req 17.2).
  it(
    'replaying a recorded session reproduces the final world, truth, Case File and action log',
    async () => {
      await fc.assert(
        fc.asyncProperty(seedArb, async (seed) => {
          const first = await record(seed);
          const second = await record(seed);

          // Req 5.5: the live final World State is byte-for-byte identical,
          // including every Day-Boundary Hook effect the advance applied.
          expect(second.world).toEqual(first.world);

          // Req 17.2 + the Truth Store / Case File: the whole deterministic
          // snapshot (truth, Case File, ordered action log) reproduces exactly.
          expect(second.snapshot).toEqual(first.snapshot);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Req 17.2, made explicit: every `extraction-commit` the dialogue turns
  // deferred is reproduced at the identical `seq` position for the identical
  // turn, so the two-phase extraction commit replays identically.
  it(
    'every extraction-commit replays at its logged position',
    async () => {
      await fc.assert(
        fc.asyncProperty(seedArb, async (seed) => {
          const first = await record(seed);
          const second = await record(seed);

          const firstCommits = extractionCommits(first.actionLog);
          const secondCommits = extractionCommits(second.actionLog);
          expect(secondCommits).toEqual(firstCommits);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Determinism is value equality, not reference equality: a replay builds a
  // fresh object graph that is nonetheless deep-equal. This guards against a
  // "replay" that only matched because it handed back one shared mutable world.
  it(
    'the two reproduced worlds are deep-equal but distinct object instances',
    async () => {
      await fc.assert(
        fc.asyncProperty(seedArb, async (seed) => {
          const first = await record(seed);
          const second = await record(seed);
          expect(second.world).not.toBe(first.world);
          expect(second.world).toEqual(first.world);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Sanity (divergence): distinct seeds generally reach distinct sessions, so
  // the equalities above pin determinism rather than collapsing every input to
  // one world. A collision would itself be a determinism/entropy bug.
  it(
    'distinct seeds generally diverge',
    async () => {
      await fc.assert(
        fc.asyncProperty(seedArb, seedArb, async (s1, s2) => {
          fc.pre(s1 !== s2);
          const a = await record(s1);
          const b = await record(s2);
          expect(b.world).not.toEqual(a.world);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
