/**
 * Feature: slice-integration, Property 34: Clock coverage.
 *
 * **Validates: Requirements 1.1, 1.9, 1.10, 2.1, 2.5, 2.6, 2.7, 2.8**
 *
 * The design states (slice-integration design, "Property 34: Clock coverage"):
 * for any reachable state and any action quoting *k* phases, the turn enters
 * `phasesSpent ≤ k` phases and runs the Phase Step exactly once per phase
 * entered, in time order; for each Day Boundary crossed it emits exactly one
 * `day-start` carrying that day's daily-stream weather, runs the four hooks
 * once in `DAY_BOUNDARY_HOOK_ORDER` before that day's phase-0 Phase Step, and
 * publishes exactly one newspaper Document for that day; a zero-phase turn runs
 * no Phase Step and no hook; and the turn's Notifications are in non-decreasing
 * event-time order.
 *
 * ## How the property observes the clock
 *
 * `advanceWorld` imports {@link phaseStep} directly, so the Phase Step cannot be
 * stubbed. The hooks, however, are injected through `deps.hooks`, so this spec
 * drives the clock with four **counting spy hooks** rather than the production
 * {@link buildWorldHooks} set. Each spy:
 *
 * - records the `(key, ctx.time)` it was called with into a shared log, so hook
 *   coverage (once per boundary) and order (`DAY_BOUNDARY_HOOK_ORDER`, and all
 *   of one boundary before the next) read straight off the log; and
 * - emits one marker event (a hidden `plot-adapted` carrying `change:
 *   'spy:<key>'`) and returns the Draft **unchanged** — so a spy never ends the
 *   game or opens a scene, and the only state the advance changes is whatever
 *   the real Phase Step does.
 *
 * Because the spies neither end the game nor open a scene, the advance always
 * runs to completion: `phasesSpent === phases` and the final time is
 * `addPhases(start, phases)`, which is the Phase-Step-coverage observable (one
 * loop iteration — one Phase Step — per phase entered, in time order; Req 1.1).
 * The returned event stream carries the clock's own `day-start` events and the
 * spy markers interleaved with the real Phase Step's events, which is what the
 * ordering clause of Req 2.8 reads: at each boundary `{d,0}`, `day-start` comes
 * first, then the four spy markers in order, then every Phase Step event the
 * boundary phase produced.
 *
 * The weather clause of Req 2.6 and the one-newspaper-per-boundary clause of
 * Req 2.5 are covered by `advance-world.spec.ts` and `world-hooks.spec.ts`
 * against the real hooks; this property focuses on the coverage, order and
 * per-phase/per-boundary scheduling the stepping core owns.
 *
 * The core-pack load and `GenerateInputs`/`ScenarioConfig` construction mirror
 * `advance-world.spec.ts` and `world-hooks.spec.ts`; the fast-check shape (a
 * seeded `fc.record`, a bounded `numRuns`) mirrors the engine's other
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
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { PHASES_PER_DAY, type GameTime, type Phase } from '../model/core.js';
import type { EventId, SimEvent, WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import type { TruthStore } from '../truth/truth.js';
import { addPhases, DAY_BOUNDARY_HOOK_ORDER } from './clock.js';
import type {
  AdvanceWorldDeps,
  WorldHook,
  WorldHooks,
} from './world-types.js';
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
const SEED = 'clock-coverage-alpha';
const GAME = generateGame(SEED, INPUTS);
const BASE: WorldState = GAME.world;
const TRUTH: TruthStore = GAME.truth;
const CIPHER_KEYS = worldCipherKeyLookup(SEED, BASE.documents);

// ---------------------------------------------------------------------------
// Counting spy hooks
// ---------------------------------------------------------------------------

/** One recorded hook invocation: which hook, and the Day Boundary time it ran at. */
interface HookCall {
  readonly key: (typeof DAY_BOUNDARY_HOOK_ORDER)[number];
  readonly time: GameTime;
}

/**
 * Build the four spy hooks and the shared call log. Every spy records its
 * `(key, ctx.time)` and emits one marker `plot-adapted` event
 * (`change: 'spy:<key>'`); each returns the Draft unchanged, so no spy ends the
 * game, opens a scene or perturbs the state the real Phase Step reads.
 */
function spyHooks(): { hooks: WorldHooks; calls: HookCall[] } {
  const calls: HookCall[] = [];
  const make = (key: (typeof DAY_BOUNDARY_HOOK_ORDER)[number]): WorldHook => {
    return (draft, ctx) => {
      calls.push({ key, time: ctx.time });
      const marker: SimEvent = {
        id: '' as EventId,
        at: ctx.time,
        visibility: 'hidden',
        kind: 'plot-adapted',
        change: `spy:${key}`,
      };
      return { state: draft, events: [marker] };
    };
  };
  const hooks: WorldHooks = {
    plot: make('plot'),
    schedules: make('schedules'),
    hostileTick: make('hostileTick'),
    newspaper: make('newspaper'),
  };
  return { hooks, calls };
}

/** The dependencies for a run: the spy hooks, with real content, keys and Truth. */
function depsWith(hooks: WorldHooks): AdvanceWorldDeps {
  return {
    content: INPUTS.content,
    cityData: INPUTS.cityData,
    hooks,
    objectives: () => () => false,
    cipherKeys: CIPHER_KEYS,
    truth: TRUTH,
  };
}

/** The marker's hook key, or `undefined` for any non-marker event. */
function markerKey(event: SimEvent): string | undefined {
  if (event.kind === 'plot-adapted' && event.change.startsWith('spy:')) {
    return event.change.slice('spy:'.length);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Expected schedule from (start, phases)
// ---------------------------------------------------------------------------

/**
 * The days whose phase-0 boundary the advance enters, in day order: for each
 * step `i` in `1..phases`, `t = addPhases(start, i)`; a boundary is any entered
 * `t` with `t.phase === 0`. Because a day is {@link PHASES_PER_DAY} phases and
 * the advance steps one phase at a time, each such day appears exactly once.
 */
function expectedBoundaryDays(start: GameTime, phases: number): number[] {
  const days: number[] = [];
  for (let i = 1; i <= phases; i += 1) {
    const t = addPhases(start, i);
    if (t.phase === 0) {
      days.push(t.day);
    }
  }
  return days;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 200;

/** A start time: a handful of early days, every phase. */
const startArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 4 }),
  phase: fc.integer({ min: 0, max: PHASES_PER_DAY - 1 }).map((p) => p as Phase),
});

/**
 * A phase count up to 20 — five full days — so a single advance crosses several
 * Day Boundaries. `0` is included so the zero-phase clause is exercised.
 */
const phasesArb = fc.integer({ min: 0, max: 20 });

/** The runtime stream seed. */
const seedArb = fc.string({ minLength: 1, maxLength: 16 });

const caseArb = fc.record({
  start: startArb,
  phases: phasesArb,
  seed: seedArb,
});

/** The world moved to `start` (nothing else changes). */
function atTime(state: WorldState, start: GameTime): WorldState {
  return { ...state, time: start };
}

// ---------------------------------------------------------------------------
// Property 34 — Clock coverage
// ---------------------------------------------------------------------------

describe('Property 34: Clock coverage (Req 1.1, 1.9, 1.10, 2.1, 2.5, 2.6, 2.7, 2.8)', () => {
  // Phase-Step coverage (Req 1.1, 1.10): one Phase Step per phase entered, in
  // time order. With spies that never stop the advance, this is exactly
  // `phasesSpent === phases` and `final time === addPhases(start, phases)`; a
  // zero-phase turn spends nothing and raises no event.
  it('enters exactly the requested phases in time order, nothing on zero', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const { hooks, calls } = spyHooks();
        const result = advanceWorld(
          atTime(BASE, start),
          phases,
          createPrng(seed),
          depsWith(hooks),
        );

        // phasesSpent ≤ k, and with no early stop, exactly k (Req 1.1).
        expect(result.phasesSpent).toBeLessThanOrEqual(phases);
        expect(result.phasesSpent).toBe(phases);
        expect(result.openScene).toBeUndefined();
        expect(result.ended).toBeUndefined();

        // The final time is the last phase entered: start + phases.
        expect(result.state.time).toEqual(addPhases(start, phases));

        // Zero phases runs no Phase Step and no hook (Req 1.10).
        if (phases === 0) {
          expect(calls).toEqual([]);
          expect(result.events).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
  });

  // Hook coverage and day order (Req 2.1, 2.7): each hook runs exactly once per
  // Day Boundary entered, carrying that boundary's `{day, phase:0}` time, and
  // the boundaries run in day order.
  it('runs each hook exactly once per boundary, carrying the boundary time, in day order', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const { hooks, calls } = spyHooks();
        advanceWorld(atTime(BASE, start), phases, createPrng(seed), depsWith(hooks));

        const boundaryDays = expectedBoundaryDays(start, phases);

        // One call to each of the four hooks per boundary, so the log length is
        // 4 × the number of boundaries (Req 2.1, 2.7).
        expect(calls.length).toBe(boundaryDays.length * DAY_BOUNDARY_HOOK_ORDER.length);

        // Per boundary day, each hook was called exactly once, at `{day, 0}`.
        for (const day of boundaryDays) {
          for (const key of DAY_BOUNDARY_HOOK_ORDER) {
            const forHook = calls.filter(
              (c) => c.key === key && c.time.day === day && c.time.phase === 0,
            );
            expect(forHook.length).toBe(1);
          }
        }

        // The boundary days, read off the call log in call order, are the
        // expected days in day order — all of one boundary before the next.
        const daysInCallOrder: number[] = [];
        for (let i = 0; i < calls.length; i += DAY_BOUNDARY_HOOK_ORDER.length) {
          daysInCallOrder.push(calls[i].time.day);
        }
        expect(daysInCallOrder).toEqual(boundaryDays);
      }),
      { numRuns: RUNS },
    );
  });

  // Hook order within a boundary (Req 2.7): the four hooks of each boundary run
  // in `DAY_BOUNDARY_HOOK_ORDER`.
  it('runs the hooks in DAY_BOUNDARY_HOOK_ORDER within every boundary', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const { hooks, calls } = spyHooks();
        advanceWorld(atTime(BASE, start), phases, createPrng(seed), depsWith(hooks));

        // Walk the log in fixed-size windows of four; each window is one
        // boundary and must be exactly the hook order.
        for (let i = 0; i < calls.length; i += DAY_BOUNDARY_HOOK_ORDER.length) {
          const window = calls.slice(i, i + DAY_BOUNDARY_HOOK_ORDER.length);
          expect(window.map((c) => c.key)).toEqual([...DAY_BOUNDARY_HOOK_ORDER]);
          // Every call in the window shares the one boundary time.
          const t = window[0].time;
          for (const c of window) {
            expect(c.time).toEqual(t);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  // Boundary event order (Req 2.5, 2.6, 2.8): each boundary emits exactly one
  // `day-start` for its day, then its four hooks in order, and the Phase Step
  // for the boundary phase runs *after* those hooks — so in the event stream,
  // for the boundary time `{day, 0}`, `day-start` is first, the four spy
  // markers follow in order, and every other event stamped `{day, 0}` (a Phase
  // Step event) comes after the last marker.
  it('emits day-start then the ordered hooks before the boundary Phase Step', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const { hooks } = spyHooks();
        const result = advanceWorld(
          atTime(BASE, start),
          phases,
          createPrng(seed),
          depsWith(hooks),
        );

        const boundaryDays = expectedBoundaryDays(start, phases);

        // Exactly one `day-start` per boundary, carrying that day (Req 2.6),
        // and in day order.
        const dayStarts = result.events.filter((e) => e.kind === 'day-start');
        expect(dayStarts.map((e) => e.at.day)).toEqual(boundaryDays);

        for (const day of boundaryDays) {
          // The events of this boundary's phase-0, in stream order.
          const atBoundary = result.events.filter(
            (e) => e.at.day === day && e.at.phase === 0,
          );

          // day-start is the first event of the boundary phase (Req 2.6).
          expect(atBoundary[0]?.kind).toBe('day-start');
          // Exactly one day-start at this time.
          expect(atBoundary.filter((e) => e.kind === 'day-start').length).toBe(1);

          // The spy markers, in stream order, are the four hooks in order
          // (Req 2.1, 2.7) and sit between day-start and any Phase Step event.
          const markerKeys = atBoundary
            .map((e) => markerKey(e))
            .filter((k): k is string => k !== undefined);
          expect(markerKeys).toEqual([...DAY_BOUNDARY_HOOK_ORDER]);

          // The index of the last hook marker and the first non-(day-start,
          // non-marker) event: the Phase Step runs after the hooks (Req 2.8).
          const lastMarkerIndex = atBoundary.reduce(
            (acc, e, idx) => (markerKey(e) !== undefined ? idx : acc),
            -1,
          );
          atBoundary.forEach((e, idx) => {
            const isHookOrDayStart =
              e.kind === 'day-start' || markerKey(e) !== undefined;
            if (!isHookOrDayStart) {
              // A Phase Step event: it must come after every hook marker.
              expect(idx).toBeGreaterThan(lastMarkerIndex);
            }
          });
        }
      }),
      { numRuns: RUNS },
    );
  });

  // Event-time order (Req 1.9): the turn's events are in non-decreasing
  // event-time order, so the Notifications built from them arrive in order.
  it('returns events in non-decreasing event-time order', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const { hooks } = spyHooks();
        const result = advanceWorld(
          atTime(BASE, start),
          phases,
          createPrng(seed),
          depsWith(hooks),
        );

        const flat = (t: GameTime): number => t.day * PHASES_PER_DAY + t.phase;
        for (let i = 1; i < result.events.length; i += 1) {
          expect(flat(result.events[i].at)).toBeGreaterThanOrEqual(
            flat(result.events[i - 1].at),
          );
        }
      }),
      { numRuns: RUNS },
    );
  });

  // Determinism (a corollary the stepping core guarantees): the same inputs and
  // seed give deep-equal results and an identical hook call log.
  it('is deterministic across repeat runs', () => {
    fc.assert(
      fc.property(caseArb, ({ start, phases, seed }) => {
        const a = spyHooks();
        const ra = advanceWorld(atTime(BASE, start), phases, createPrng(seed), depsWith(a.hooks));
        const b = spyHooks();
        const rb = advanceWorld(atTime(BASE, start), phases, createPrng(seed), depsWith(b.hooks));

        expect(rb.state).toEqual(ra.state);
        expect(rb.events).toEqual(ra.events);
        expect(rb.phasesSpent).toBe(ra.phasesSpent);
        expect(b.calls).toEqual(a.calls);
      }),
      { numRuns: 60 },
    );
  });
});
