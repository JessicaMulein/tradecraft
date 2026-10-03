/**
 * Feature: slice-integration, Property 36: Hook outputs persist.
 *
 * **Validates: Requirements 1.2, 2.3, 3.5, 3.9**
 *
 * The design states (slice-integration design, "Property 36: Hook outputs
 * persist"): for any reachable state and turn crossing a Day Boundary —
 *
 * 1. every `transmission` event the turn emits names an Intercept present in a
 *    committed Transmission (`transmissions`), so a minted trace's ciphertext is
 *    actually in the Draft the player can collect from (Req 2.3, 3.9);
 * 2. every `feed-delivered` event scheduled for a crossed day is removed from
 *    `scheduled` and ingested exactly once (Req 3.5, so the next boundary does
 *    not re-ingest it); and
 * 3. every NPC not pinned by arrest, flight or custody has `whereabouts` equal
 *    to its scheduled Location at the final time (Req 1.2, 2.2 — each hook reads
 *    and leaves the Draft the previous one did, so the schedules hook's
 *    `whereabouts` survives the later hooks and the Phase Step into the commit).
 *
 * ## How the property observes persistence
 *
 * `advanceWorld` runs the real {@link buildWorldHooks} set in
 * `DAY_BOUNDARY_HOOK_ORDER`, threading each hook the state the previous one
 * returned (Hook Application, Req 2.2) and then the Phase Step, and returns the
 * committed Draft and the turn's events. The three clauses above are
 * universally quantified over the turn's output: each holds vacuously when the
 * relevant event does not occur, and bites when it does. To keep the clauses
 * from passing only vacuously, two of the generated cases force the fact under
 * test to occur:
 *
 * - a **transmission** case forces a `transmission` trace due at a crossed
 *   boundary with its world-assembly-seeded Transmission removed, so the Plot
 *   hook re-mints it past the seeded horizon (mirrors `world-hooks.spec.ts`),
 *   and the run must then carry a `transmission` event whose Intercept is a
 *   committed Transmission's; and
 * - a **feed** case schedules a hidden `feed-delivered` for a crossed day, so
 *   the Hostile Full Tick ingests it and the run must remove exactly that event
 *   from `scheduled`.
 *
 * The remaining cases advance the generated world across varied spans and
 * assert all three clauses hold whatever the hooks did. The `whereabouts`
 * clause is non-vacuous on every multi-day run: the schedules hook writes a
 * `whereabouts` entry for every NPC each boundary.
 *
 * The core-pack load and `AdvanceWorldDeps` construction mirror
 * `advance-world.spec.ts` and `clock-coverage.property.spec.ts`; the fast-check
 * shape (a seeded `fc.record`, a bounded `numRuns`) mirrors the engine's other
 * `*.property.spec.ts` files.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { plotTransmissionId, worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { revealTruth, type NpcId, type Proposition } from '../model/core.js';
import { PHASES_PER_DAY, type GameTime, type Phase } from '../model/core.js';
import type { EventId, SimEvent, WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import type { TruthStore } from '../truth/truth.js';
import { addPhases } from './clock.js';
import { pinnedWhereabouts } from './phase-step.js';
import { scheduledLocationAt } from './schedules.js';
import { buildWorldHooks } from './world-hooks.js';
import type { AdvanceWorldDeps } from './world-types.js';
import { advanceWorld } from './advance-world.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors advance-world.spec.ts / world-hooks.spec.ts)
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

function loadCore(): GenerateInputs {
  const content = loadContent([CORE_DIR], ['core']);
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!content.ok || !cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('the core pack failed to load');
  }
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content: content.value,
    preset: presetOf(content.value, 'standard'),
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function presetOf(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const INPUTS = loadCore();
const SEED = 'hook-persistence-alpha';
const GAME = generateGame(SEED, INPUTS);
const BASE: WorldState = GAME.world;
const TRUTH: TruthStore = GAME.truth;

/** The production dependencies: the four real hooks, content, keys and Truth. */
const DEPS: AdvanceWorldDeps = {
  content: INPUTS.content,
  cityData: INPUTS.cityData,
  hooks: buildWorldHooks(),
  objectives: () => () => false,
  cipherKeys: worldCipherKeyLookup(SEED, BASE.documents),
  truth: TRUTH,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The state moved to `time` (nothing else changes). */
function atTime(state: WorldState, time: GameTime): WorldState {
  return { ...state, time };
}

/** Run `advanceWorld` from a fresh runtime stream. */
function run(state: WorldState, phases: number, runtimeSeed: string) {
  return advanceWorld(state, phases, createPrng(runtimeSeed), DEPS);
}

/** The last day the advance crossed a Day Boundary into, or `undefined` for none. */
function lastBoundaryDay(start: GameTime, phases: number): number | undefined {
  let last: number | undefined;
  for (let i = 1; i <= phases; i += 1) {
    const t = addPhases(start, i);
    if (t.phase === 0) {
      last = t.day;
    }
  }
  return last;
}

/** A hidden `feed-delivered` scheduled at `at`, carrying one real Proposition. */
function feedEvent(id: string, agent: NpcId, at: GameTime, prop: Proposition): SimEvent {
  return {
    id: id as EventId,
    at,
    visibility: 'hidden',
    kind: 'feed-delivered',
    agent,
    props: [prop],
  };
}

// ---------------------------------------------------------------------------
// The transmission case: a trace forced due at a crossed boundary
// ---------------------------------------------------------------------------

/**
 * The first stage carrying a `transmission` trace whose Transmission world
 * assembly seeded, discovered from the generated Plot rather than hard-coded
 * (the stage ids depend on the seed). Forcing that stage due — its earlier
 * stages in the DAG marked executed — and removing its seeded Transmission
 * makes the Plot hook re-mint the trace past the seeded horizon when the
 * advance crosses the stage's deadline day, exactly the fresh-mint path
 * `world-hooks.spec.ts` exercises for one hard-coded stage.
 */
const TX_TARGET = (() => {
  const stages = BASE.plot.stages;
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];
    const trace = stage.traces.find((t) => t.kind === 'transmission');
    if (trace === undefined) {
      continue;
    }
    const txId = plotTransmissionId(stage.id, trace.index);
    if (BASE.transmissions.some((tx) => tx.id === txId)) {
      return { stageIndex: i, stageId: stage.id, txId, deadline: stage.deadline };
    }
  }
  return undefined;
})();

/** The Draft with the target transmission stage forced due and its Transmission removed. */
function transmissionDraft(): WorldState {
  if (TX_TARGET === undefined) {
    throw new Error('the fixture Plot has no seeded transmission trace');
  }
  const stages = BASE.plot.stages.map((s, i) =>
    i < TX_TARGET.stageIndex ? { ...s, status: 'executed' as const } : s,
  );
  return {
    ...BASE,
    plot: { ...BASE.plot, stages },
    transmissions: BASE.transmissions.filter((tx) => tx.id !== TX_TARGET.txId),
    intercepts: {},
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 150;

/** A start time in the first few days, every phase. */
const startArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 4 }),
  phase: fc.integer({ min: 0, max: PHASES_PER_DAY - 1 }).map((p) => p as Phase),
});

/** A span up to five full days, so a single advance crosses several boundaries. */
const phasesArb = fc.integer({ min: 1, max: 20 });

const seedArb = fc.string({ minLength: 1, maxLength: 16 });

const caseArb = fc.record({ start: startArb, phases: phasesArb, seed: seedArb });

// ---------------------------------------------------------------------------
// Clause 1 — a transmission event names a committed Transmission (Req 2.3, 3.9)
// ---------------------------------------------------------------------------

describe('Property 36: Hook outputs persist (Req 1.2, 2.3, 3.5, 3.9)', () => {
  it('every transmission event names an Intercept carried by a committed Transmission', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const result = run(atTime(BASE, start), phases, seed);
        const ids = new Set(result.state.transmissions.map((tx) => tx.intercept.id));
        for (const event of result.events) {
          if (event.kind === 'transmission') {
            // The event's `intercept` id must be an Intercept riding a committed
            // Transmission, so the trace the hook emitted is actually collectable.
            expect(ids.has(event.intercept)).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  // The clause bites: a trace forced due at the stage's deadline day re-mints a
  // Transmission past the seeded horizon, so the run carries a `transmission`
  // event, and its Intercept is in the committed `transmissions`.
  it('a freshly minted transmission trace is both emitted and committed (non-vacuous)', () => {
    if (TX_TARGET === undefined) {
      throw new Error('the fixture Plot has no seeded transmission trace');
    }
    // Sanity: generation seeded this stage's Transmission, so removing it to
    // force a fresh mint is not a no-op.
    expect(BASE.transmissions.some((tx) => tx.id === TX_TARGET.txId)).toBe(true);

    const target = TX_TARGET;
    // Start the night before the deadline day and advance into its boundary.
    const start: GameTime = { day: target.deadline.day - 1, phase: 3 };
    fc.assert(
      fc.property(seedArb, (seed) => {
        const result = advanceWorld(
          atTime(transmissionDraft(), start),
          1,
          createPrng(seed),
          DEPS,
        );

        // The trace fired: a `transmission` event names the re-minted Intercept.
        const tx = result.events.find((e) => e.kind === 'transmission');
        expect(tx?.kind).toBe('transmission');

        // Every transmission event's Intercept is in the committed Transmissions
        // (clause 1), and the re-minted Transmission itself is present.
        const ids = new Set(result.state.transmissions.map((t) => t.intercept.id));
        for (const event of result.events) {
          if (event.kind === 'transmission') {
            expect(ids.has(event.intercept)).toBe(true);
          }
        }
        expect(result.state.transmissions.some((t) => t.id === target.txId)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  // -------------------------------------------------------------------------
  // Clause 2 — a scheduled feed-delivered leaves `scheduled` exactly once
  // -------------------------------------------------------------------------

  it('every feed-delivered scheduled for a crossed day is removed from scheduled, others remain', () => {
    const prop = revealTruth(TRUTH.facts()[0]);
    const agent = (Object.keys(BASE.npcs) as NpcId[]).sort()[0];
    if (agent === undefined) {
      throw new Error('the fixture world has no NPCs to feed');
    }

    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const lastDay = lastBoundaryDay(start, phases);
        // Only meaningful when the advance crosses a boundary; a span of ≥1
        // phase from an arbitrary start may land mid-day, so skip those.
        fc.pre(lastDay !== undefined);
        const crossed = lastDay as number;

        // One feed due on the first crossed day (removed) and one far in the
        // future (kept): the removal must be exactly the due one.
        const dueAt: GameTime = { day: crossed, phase: 0 };
        const futureAt: GameTime = { day: crossed + 50, phase: 0 };
        const due = feedEvent('feed-due', agent, dueAt, prop);
        const future = feedEvent('feed-future', agent, futureAt, prop);

        const draft: WorldState = {
          ...BASE,
          scheduled: [...BASE.scheduled, due, future],
        };

        const result = run(atTime(draft, start), phases, seed);
        const remaining = new Set(result.state.scheduled.map((e) => e.id));

        // The due feed was ingested and left the queue exactly once …
        expect(remaining.has('feed-due' as EventId)).toBe(false);
        expect(
          result.state.scheduled.filter((e) => e.id === ('feed-due' as EventId)).length,
        ).toBe(0);
        // … while a not-yet-due feed stays queued for its own future boundary.
        expect(remaining.has('feed-future' as EventId)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  // -------------------------------------------------------------------------
  // Clause 3 — free NPCs' whereabouts equal their scheduled Location at the end
  // -------------------------------------------------------------------------

  it('every unpinned NPC has whereabouts equal to its scheduled Location at the final time', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const result = run(atTime(BASE, start), phases, seed);
        // The Phase Step writes `whereabouts` for the entered phase on every
        // phase, so the clause holds at the final time whether or not a boundary
        // was crossed; no `fc.pre` guard is needed.
        const final = result.state.time;
        for (const id of (Object.keys(result.state.npcs) as NpcId[]).sort()) {
          const pin = pinnedWhereabouts(result.state, id, final);
          if (pin !== undefined) {
            // A pinned NPC (arrested, fled, in custody) is held where the pin
            // says, not at its schedule — the clause excludes it.
            expect(result.state.whereabouts[id]).toBe(pin);
            continue;
          }
          const scheduled = scheduledLocationAt(result.state.npcs[id], final) ?? 'absent';
          expect(result.state.whereabouts[id]).toBe(scheduled);
        }
      }),
      { numRuns: RUNS },
    );
  });

  // -------------------------------------------------------------------------
  // Determinism corollary: the committed outputs are stable across repeats.
  // -------------------------------------------------------------------------

  it('is deterministic across repeat runs', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const a = run(atTime(BASE, start), phases, seed);
        const b = run(atTime(BASE, start), phases, seed);
        expect(b.state.transmissions).toEqual(a.state.transmissions);
        expect(b.state.scheduled).toEqual(a.state.scheduled);
        expect(b.state.whereabouts).toEqual(a.state.whereabouts);
        expect(b.events).toEqual(a.events);
      }),
      { numRuns: 40 },
    );
  });
});
