/**
 * Feature: slice-integration, Property 37: Daily stream independence.
 *
 * **Validates: Requirements 5.1**
 *
 * The design states (slice-integration design, "Property 37: Daily stream
 * independence"): for any reachable state and turn crossing a Day Boundary,
 * replacing the Draft's runtime PRNG state with any other state leaves that
 * day's weather, newspaper article selection and Walk-in outcome unchanged.
 * This is the Req 5.1 split: every random value comes from a named stream —
 * the **daily** stream (`derive(seed, DAILY_STREAM_BASE + day)`) for weather,
 * newspaper selection and Walk-ins, and the **runtime** stream (the `rng`
 * threaded through `advanceWorld` and `resolve`) for everything else.
 *
 * ## What the two properties observe
 *
 * `advanceWorld` draws the day's weather itself from the daily stream and runs
 * the four production {@link buildWorldHooks} hooks; the `schedules` hook rolls
 * the day's Walk-in on the daily stream and the `newspaper` hook composes the
 * day's edition's article selection on the daily stream, while the Plot hook,
 * the Hostile tick and every Phase Step draw ride the runtime `rng`. So:
 *
 * - **Property A — the runtime seed does not perturb the daily-stream
 *   outputs.** Run `advanceWorld` twice over the *same* pre-turn state, across
 *   a span that crosses one or more Day Boundaries, differing **only** in the
 *   runtime `rng` seed. Every daily-stream-derived output is identical: each
 *   boundary day's `day-start` weather, each day's published newspaper edition
 *   Document (`newspapers[day]` id and the whole Document — its asserted
 *   Propositions and body), and the Walk-in events the `schedules` hook rolled
 *   (same NPC, same day) with the Contact Channel each Walk-in created. Only
 *   runtime-stream effects (the Hostile tick, Plot, Phase Step draws) may
 *   differ, and the runtime stream's own end state does.
 *
 * - **Property B — the daily stream is a pure function of `(seed, day)`.** The
 *   boundary weather equals the oracle `weatherForDay(seed, city, cityData,
 *   day)` (the slice's own daily-stream weather function) regardless of the
 *   runtime seed, and re-running the same world seed and day yields the same
 *   edition and Walk-in outcome. Its converse — the daily stream cannot perturb
 *   a runtime-only draw — is observed on a span that crosses **no** Day
 *   Boundary: there `advanceWorld` runs only the Phase Step on the runtime
 *   stream and never reads the daily seed, so replacing the world seed (hence
 *   the daily seed `derive(seed, DAILY_STREAM_BASE + day)`) leaves the whole
 *   result unchanged.
 *
 * ## Why the full-edition equality in Property A is sound and non-vacuous
 *
 * The slice `newspaper` hook composes the edition from `dailyMaterial(day)`
 * (drawn on the daily stream) plus any Hostile-tick plants and arrest articles
 * handed through the day scratch (a runtime-stream contribution). From a
 * pristine generated world with no prior player action — the states this
 * property reaches — the Hostile tick plants nothing and arrests no Asset, so
 * the scratch contributions are empty and the whole edition is daily-derived.
 * Full-Document equality across runtime seeds therefore holds for every
 * reachable state here, and it is non-vacuous: it would catch a daily-selection
 * draw that leaked onto the runtime stream (the exact bug this property guards).
 * Walk-ins do land across the sampled starts, so the Walk-in clause is
 * exercised rather than held vacuously.
 *
 * The core-pack load and `GenerateInputs`/`ScenarioConfig` construction mirror
 * `advance-world.spec.ts`, `world-hooks.spec.ts` and
 * `clock-coverage.property.spec.ts`; the fast-check shape (a seeded `fc.record`,
 * a bounded `numRuns`) mirrors the engine's other `*.property.spec.ts` files.
 * `numRuns` is kept modest because every run does real hook work (Plot
 * execution, the Hostile Full Tick and newspaper composition).
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

import { DAILY_STREAM_BASE, weatherForDay } from '../city/city.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { PHASES_PER_DAY, type GameTime, type NpcId, type Phase } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { createPrng, derive } from '../prng/prng.js';
import type { TruthStore } from '../truth/truth.js';
import { addPhases } from './clock.js';
import { buildWorldHooks } from './world-hooks.js';
import type { AdvanceWorldDeps } from './world-types.js';
import { advanceWorld, type AdvanceWorldResult } from './advance-world.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors advance-world.spec.ts / clock-coverage.property.spec.ts)
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
const SEED = 'daily-stream-alpha';
const GAME = generateGame(SEED, INPUTS);
const BASE: WorldState = GAME.world;
const TRUTH: TruthStore = GAME.truth;

/** The production dependencies: the four hooks, real content, keys and Truth. */
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

/** The world moved to `start`, with its world seed overridden to `seed`. */
function atTime(state: WorldState, start: GameTime, seed = state.meta.seed): WorldState {
  return { ...state, time: start, meta: { ...state.meta, seed } };
}

/** Run `advanceWorld` with a fresh runtime stream from `runtimeSeed`. */
function run(state: WorldState, phases: number, runtimeSeed: string): AdvanceWorldResult {
  return advanceWorld(state, phases, createPrng(runtimeSeed), DEPS);
}

/** The days whose phase-0 boundary a `phases`-span from `start` enters, in order. */
function boundaryDays(start: GameTime, phases: number): number[] {
  const days: number[] = [];
  for (let i = 1; i <= phases; i += 1) {
    const t = addPhases(start, i);
    if (t.phase === 0) {
      days.push(t.day);
    }
  }
  return days;
}

/** The `day-start` weather summary for each boundary day, keyed by day. */
function weatherByDay(result: AdvanceWorldResult): Record<number, string> {
  const out: Record<number, string> = {};
  for (const e of result.events) {
    if (e.kind === 'day-start') {
      out[e.at.day] = e.weather.summary;
    }
  }
  return out;
}

/** The Walk-in events `(day, npc)` the span rolled, in event order. */
function walkIns(result: AdvanceWorldResult): Array<{ day: number; npc: NpcId }> {
  const out: Array<{ day: number; npc: NpcId }> = [];
  for (const e of result.events) {
    if (e.kind === 'walk-in') {
      out.push({ day: e.at.day, npc: e.npc });
    }
  }
  return out;
}

/** The whole published edition Document for `day`, or `undefined` if none. */
function edition(result: AdvanceWorldResult, day: number): unknown {
  const id = result.state.newspapers[day];
  return id === undefined ? undefined : result.state.documents[id];
}

/** Only the events a hook raised at a boundary (not Phase Step events). */
function dayStartKinds(events: readonly SimEvent[]): string[] {
  return events.filter((e) => e.kind === 'day-start').map((e) => e.kind);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 90;

/** A start time over a handful of early days, every phase. */
const startArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 4 }),
  phase: fc.integer({ min: 0, max: PHASES_PER_DAY - 1 }).map((p) => p as Phase),
});

/** A phase count that always crosses at least one Day Boundary (up to ~2 days). */
const crossingPhasesArb = fc.integer({ min: PHASES_PER_DAY, max: PHASES_PER_DAY * 2 });

/** Two distinct runtime stream seeds. */
const twoSeedsArb = fc
  .tuple(fc.string({ minLength: 1, maxLength: 12 }), fc.string({ minLength: 1, maxLength: 12 }))
  .filter(([a, b]) => a !== b);

const crossingCaseArb = fc.record({
  start: startArb,
  phases: crossingPhasesArb,
  seeds: twoSeedsArb,
});

// ---------------------------------------------------------------------------
// Property A — the runtime seed does not perturb the daily-stream outputs
// ---------------------------------------------------------------------------

describe('Property 37: Daily stream independence (Req 5.1)', () => {
  it('A: changing only the runtime seed leaves weather, newspaper and Walk-ins unchanged', () => {
    let sawWalkIn = false;
    fc.assert(
      fc.property(crossingCaseArb, ({ start, phases, seeds: [sa, sb] }) => {
        const state = atTime(BASE, start);
        const a = run(state, phases, sa);
        const b = run(state, phases, sb);

        // The span crosses at least one boundary, so both runs raised a
        // `day-start` — the daily-stream clause is never held vacuously.
        expect(dayStartKinds(a.events).length).toBeGreaterThan(0);

        // Weather: identical per boundary day across the two runtime seeds.
        expect(weatherByDay(a)).toEqual(weatherByDay(b));

        // Newspaper: the id and the whole published edition Document (asserted
        // Propositions and body) are identical per day.
        for (const day of boundaryDays(start, phases)) {
          expect(a.state.newspapers[day]).toBe(b.state.newspapers[day]);
          expect(edition(a, day)).toEqual(edition(b, day));
        }

        // Walk-ins: the same NPC on the same day, and each Walk-in NPC's Contact
        // Channel (the daily-stream effect of the roll) is set in both runs.
        const wa = walkIns(a);
        expect(wa).toEqual(walkIns(b));
        for (const { npc } of wa) {
          sawWalkIn = true;
          expect(a.state.relationships[npc]?.channel).toBe(true);
          expect(b.state.relationships[npc]?.channel).toBe(true);
          expect(a.state.player.contacts).toContain(npc);
          expect(b.state.player.contacts).toContain(npc);
        }

        // The runtime stream itself did advance — the daily draws rode their own
        // stream and did not consume the runtime stream in its place.
        expect(a.state.rng).not.toEqual(state.rng);
      }),
      { numRuns: RUNS },
    );
    // At least one sampled case actually landed a Walk-in, so the Walk-in clause
    // was exercised rather than held vacuously across the whole run.
    expect(sawWalkIn).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Property B — the daily stream is a pure function of (seed, day)
  // ---------------------------------------------------------------------------

  it('B: the boundary weather equals weatherForDay(seed, city, day) for any runtime seed', () => {
    fc.assert(
      fc.property(crossingCaseArb, ({ start, phases, seeds: [sa, sb] }) => {
        const state = atTime(BASE, start);
        for (const runtimeSeed of [sa, sb]) {
          const result = run(state, phases, runtimeSeed);
          const got = weatherByDay(result);
          for (const day of boundaryDays(start, phases)) {
            const oracle = weatherForDay(
              state.meta.seed,
              state.city,
              INPUTS.cityData,
              day,
              state.meta.setting.startDate,
            );
            expect(got[day]).toBe(oracle.label);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('B: the same world seed and day reproduce the same edition and Walk-in outcome', () => {
    fc.assert(
      fc.property(crossingCaseArb, ({ start, phases, seeds: [sa, sb] }) => {
        const state = atTime(BASE, start);
        // Two different runtime seeds, same world seed and day: the daily-stream
        // selection (edition and Walk-in roll) is reproduced exactly.
        const a = run(state, phases, sa);
        const b = run(state, phases, sb);
        for (const day of boundaryDays(start, phases)) {
          expect(edition(a, day)).toEqual(edition(b, day));
        }
        expect(walkIns(a)).toEqual(walkIns(b));
      }),
      { numRuns: RUNS },
    );
  });

  // The converse of Property B: the daily stream cannot perturb a runtime-only
  // draw. On a span that crosses NO Day Boundary, `advanceWorld` runs only the
  // Phase Step on the runtime stream and never reads the daily seed, so
  // replacing the world seed (hence the daily seed `derive(seed,
  // DAILY_STREAM_BASE + day)`) leaves the entire result unchanged.
  it('B: changing the daily (world) seed does not change a runtime-only draw', () => {
    // Phases within a single day: start phase p, +(k) phases with p + k < 4.
    const subBoundaryArb = fc
      .record({
        day: fc.integer({ min: 0, max: 4 }),
        phase: fc.integer({ min: 0, max: PHASES_PER_DAY - 2 }).map((p) => p as Phase),
        extra: fc.integer({ min: 1, max: PHASES_PER_DAY - 1 }),
        seed: fc.string({ minLength: 1, maxLength: 12 }),
        worldSeedB: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s !== SEED),
      })
      .map((r) => ({
        start: { day: r.day, phase: r.phase } as GameTime,
        phases: Math.min(r.extra, PHASES_PER_DAY - 1 - r.phase),
        runtimeSeed: r.seed,
        worldSeedB: r.worldSeedB,
      }));

    fc.assert(
      fc.property(subBoundaryArb, ({ start, phases, runtimeSeed, worldSeedB }) => {
        // Sanity: this span crosses no boundary (no daily hook runs at all).
        expect(boundaryDays(start, phases)).toEqual([]);
        // The daily seed differs between the two world seeds for this day …
        expect(derive(SEED, DAILY_STREAM_BASE + start.day)).not.toBe(
          derive(worldSeedB, DAILY_STREAM_BASE + start.day),
        );

        const a = run(atTime(BASE, start, SEED), phases, runtimeSeed);
        const b = run(atTime(BASE, start, worldSeedB), phases, runtimeSeed);

        // … yet the runtime-only advance is byte-for-byte identical: the daily
        // stream never touched a runtime draw.
        expect(b.events.map((e) => ({ ...e, id: '' }))).toEqual(
          a.events.map((e) => ({ ...e, id: '' })),
        );
        expect(b.state.rng).toEqual(a.state.rng);
        expect(b.phasesSpent).toBe(a.phasesSpent);
      }),
      { numRuns: RUNS },
    );
  });
});
