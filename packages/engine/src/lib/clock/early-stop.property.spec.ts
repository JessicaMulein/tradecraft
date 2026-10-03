/**
 * Feature: slice-integration, Property 35: Early stop.
 *
 * **Validates: Requirements 1.4, 7.5**
 *
 * The design states (slice-integration design, "Property 35: Early stop"):
 * for any reachable state and multi-phase action, if a kept meeting opens a
 * scene or an End Condition arises at phase *t* inside the span, the turn's
 * final time is *t*, no Phase Step or hook runs after *t*, `phasesSpent`
 * equals the offset of *t*, and the committed state has `player.scene` set to
 * the meeting NPC or `ended.at = t` respectively.
 *
 * This spec drives {@link advanceWorld} over the two early-stop paths the
 * stepping core owns, each over arbitraries of (start time, phases, seed):
 *
 * 1. **End via a hook.** A spy `plot` hook is injected that, on a chosen
 *    boundary day picked deterministically from the span, writes
 *    `plot.status = 'aborted'` to the Draft. `advanceWorld` runs `detectEnd`
 *    after each hook, so the game ends at that boundary. The three later spy
 *    hooks and a Phase-Step counter let the test assert that nothing ran past
 *    the stop: `ended` is surfaced (a success abort), `state.ended` equals it,
 *    `state.time` is the boundary time, and `phasesSpent` is the offset of the
 *    boundary from the start.
 *
 * 2. **Scene via the real Phase Step.** `advanceWorld` imports
 *    {@link phaseStep} directly, so the scene path cannot be stubbed. The test
 *    stages an accepted meeting at a reachable within-day slot (a scheduled
 *    NPC plus an asset Relationship, as `advance-world.spec.ts`'s kept-meeting
 *    test does) and drives it with the real {@link buildWorldHooks}. The real
 *    Phase Step opens the scene, so `openScene` is surfaced, `state.time` is
 *    the slot, and `phasesSpent` stops at the slot's offset.
 *
 * A light **no-early-stop control** anchors the contrast: with spies that
 * never end or open, `phasesSpent === phases` (the full coverage case lives in
 * `clock-coverage.property.spec.ts`, task 5.3).
 *
 * The core-pack load, the `GenerateInputs`/`ScenarioConfig` construction, the
 * spy-hook pattern and the fast-check shape mirror `advance-world.spec.ts` and
 * `clock-coverage.property.spec.ts`.
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

import type { Meeting } from '../action/types.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  PHASES_PER_DAY,
  timeToPhases,
  type GameTime,
  type LocId,
  type NpcId,
  type Phase,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { newRelationship, type Relationship } from '../recruit/asset.js';
import type { TruthStore } from '../truth/truth.js';
import { addPhases, DAY_BOUNDARY_HOOK_ORDER } from './clock.js';
import { scheduledLocationAt } from './schedules.js';
import { buildWorldHooks } from './world-hooks.js';
import type {
  AdvanceWorldDeps,
  WorldHook,
  WorldHooks,
} from './world-types.js';
import { advanceWorld } from './advance-world.js';

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
const SEED = 'early-stop-alpha';
const GAME = generateGame(SEED, INPUTS);
const BASE: WorldState = GAME.world;
const TRUTH: TruthStore = GAME.truth;
const CIPHER_KEYS = worldCipherKeyLookup(SEED, BASE.documents);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The state moved to `time` (nothing else changes). */
function atTime(state: WorldState, time: GameTime): WorldState {
  return { ...state, time };
}

/** The offset in phases of `t` from `start` (`t` is at or after `start`). */
function offset(start: GameTime, t: GameTime): number {
  return timeToPhases(t) - timeToPhases(start);
}

/**
 * The days whose phase-0 boundary the advance enters, in day order: for each
 * step `i` in `1..phases`, `t = addPhases(start, i)` is a boundary when
 * `t.phase === 0`. (Mirrors `clock-coverage.property.spec.ts`.)
 */
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

// ---------------------------------------------------------------------------
// Spy hooks: an ender on a chosen day, counters on the rest
// ---------------------------------------------------------------------------

/** One recorded hook invocation: which hook, and the boundary time it ran at. */
interface HookCall {
  readonly key: (typeof DAY_BOUNDARY_HOOK_ORDER)[number];
  readonly time: GameTime;
}

/**
 * Build the four spy hooks and the shared call log. The `plot` hook ends the
 * game the first time it runs on `endDay`, exactly as the production Plot hook
 * does on an abort: it aborts the Plot *and* writes `WorldState.ended` with
 * `at = ctx.time` (the boundary time), the {@link EndedIntent} the real
 * `applyAbort` produces. `advanceWorld` runs `detectEnd` after the hook;
 * `detectEnd` is idempotent once `ended` is set, so it returns the hook's own
 * End Condition unchanged — the boundary time, matching the stop time.
 *
 * Before `endDay`, and the other three hooks always, each records its
 * `(key, ctx.time)` and returns the Draft unchanged. So the only state the
 * advance changes is the end on the chosen boundary, and the call log shows
 * exactly which hooks ran up to and including the stop.
 */
function endingSpies(endDay: number): { hooks: WorldHooks; calls: HookCall[] } {
  const calls: HookCall[] = [];
  const record = (key: (typeof DAY_BOUNDARY_HOOK_ORDER)[number]): WorldHook => {
    return (draft, ctx) => {
      calls.push({ key, time: ctx.time });
      return { state: draft, events: [] };
    };
  };
  const plot: WorldHook = (draft, ctx) => {
    calls.push({ key: 'plot', time: ctx.time });
    if (ctx.time.day === endDay) {
      // Mirror the production abort: set the Plot aborted and write
      // `WorldState.ended` at the boundary time, as `applyAbort(plot, trigger,
      // ctx.time)` does, so `detectEnd` reports the end at the stop phase.
      const ended: WorldState = {
        ...draft,
        plot: { ...draft.plot, status: 'aborted', abortCause: 'pressure' },
        ended: { outcome: 'success', at: ctx.time, cause: 'pressure' },
      };
      return { state: ended, events: [] };
    }
    return { state: draft, events: [] };
  };
  const hooks: WorldHooks = {
    plot,
    schedules: record('schedules'),
    hostileTick: record('hostileTick'),
    newspaper: record('newspaper'),
  };
  return { hooks, calls };
}

/** Four counting spies that never end or open, for the control. */
function inertSpies(): { hooks: WorldHooks; calls: HookCall[] } {
  const calls: HookCall[] = [];
  const record = (key: (typeof DAY_BOUNDARY_HOOK_ORDER)[number]): WorldHook => {
    return (draft, ctx) => {
      calls.push({ key, time: ctx.time });
      return { state: draft, events: [] };
    };
  };
  return {
    hooks: {
      plot: record('plot'),
      schedules: record('schedules'),
      hostileTick: record('hostileTick'),
      newspaper: record('newspaper'),
    },
    calls,
  };
}

/** The dependencies for a run: the given hooks, with real content, keys and Truth. */
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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 200;

/** A start time: a handful of early days, every phase. */
const startArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 4 }),
  phase: fc.integer({ min: 0, max: PHASES_PER_DAY - 1 }).map((p) => p as Phase),
});

/** The runtime stream seed. */
const seedArb = fc.string({ minLength: 1, maxLength: 16 });

/**
 * A (start, phases, seed) case whose span crosses at least one Day Boundary,
 * so the ending-hook path has a boundary to stop on. `phases` is chosen large
 * enough (up to 20, five full days) to always reach the next day.
 */
const crossingArb = fc
  .record({
    start: startArb,
    phases: fc.integer({ min: 1, max: 20 }),
    seed: seedArb,
  })
  .filter(({ start, phases }) => boundaryDays(start, phases).length > 0);

/**
 * A crossing case whose span reaches past its first Day Boundary, so ending on
 * that first boundary is a *genuine* early stop (`phasesSpent < phases`). The
 * filter keeps cases where the first boundary's offset is strictly below the
 * requested phases.
 */
const earlyEndArb = crossingArb.filter(({ start, phases }) => {
  const first = boundaryDays(start, phases)[0];
  return offset(start, { day: first, phase: 0 as Phase }) < phases;
});

// ---------------------------------------------------------------------------
// Path 1 — Early stop on an End Condition from a hook (Req 7.5)
// ---------------------------------------------------------------------------

describe('Property 35: Early stop on an End Condition (Req 7.5)', () => {
  it('stops at the boundary a hook ends on, surfacing the end and the stop time', () => {
    fc.assert(
      fc.property(earlyEndArb, ({ start, phases, seed }) => {
        // End on the first boundary crossed, strictly inside the span.
        const endDay = boundaryDays(start, phases)[0];
        const stopTime: GameTime = { day: endDay, phase: 0 as Phase };

        const { hooks } = endingSpies(endDay);
        const result = advanceWorld(
          atTime(BASE, start),
          phases,
          createPrng(seed),
          depsWith(hooks),
        );

        // The end is surfaced as a success abort, and written to the state.
        expect(result.ended).toBeDefined();
        expect(result.ended?.outcome).toBe('success');
        expect(result.ended?.cause).toBe('pressure');
        expect(result.ended?.at).toEqual(stopTime);
        expect(result.state.ended).toEqual(result.ended);

        // No scene opened on the end path.
        expect(result.openScene).toBeUndefined();

        // The committed state's time is the stop phase, and phasesSpent is its
        // offset from the start — strictly fewer than the requested phases, a
        // genuine early stop (Req 7.5).
        expect(result.state.time).toEqual(stopTime);
        expect(result.phasesSpent).toBe(offset(start, stopTime));
        expect(result.phasesSpent).toBeLessThan(phases);
      }),
      { numRuns: RUNS },
    );
  });

  it('runs no hook after the ending hook, and no later boundary at all', () => {
    fc.assert(
      fc.property(earlyEndArb, ({ start, phases, seed }) => {
        const endDay = boundaryDays(start, phases)[0];

        const { hooks, calls } = endingSpies(endDay);
        advanceWorld(atTime(BASE, start), phases, createPrng(seed), depsWith(hooks));

        // The abort fires inside the `plot` hook; `detectEnd` runs right after
        // it, so the sequence stops before `schedules`. On the ending boundary
        // only `plot` ran; the three later hooks never ran there.
        const onEndDay = calls.filter((c) => c.time.day === endDay);
        expect(onEndDay).toEqual([{ key: 'plot', time: { day: endDay, phase: 0 } }]);

        // No hook ran on any day after the ending boundary — the advance stopped.
        expect(calls.every((c) => c.time.day <= endDay)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Path 2 — Early stop on a scene the real Phase Step opens (Req 1.4)
// ---------------------------------------------------------------------------

/** The NPC ids, sorted. */
function npcIds(state: WorldState): NpcId[] {
  return (Object.keys(state.npcs) as NpcId[]).sort();
}

/** An NPC its schedule places somewhere at `t`, with that Location, or undefined. */
function scheduledSomewhere(
  state: WorldState,
  t: GameTime,
): { npc: NpcId; loc: LocId } | undefined {
  for (const npc of npcIds(state)) {
    const loc = scheduledLocationAt(state.npcs[npc], t);
    if (loc !== undefined) {
      return { npc, loc };
    }
  }
  return undefined;
}

/** A running Asset with a Contact Channel, at trust 0.5 (mirrors advance-world.spec). */
function assetRel(npc: NpcId): Relationship {
  return {
    ...newRelationship(npc),
    recruited: true,
    channel: true,
    trust: 0.5,
    asset: {
      access: asTruth({ locs: [], orgs: [], npcs: [] }),
      reliability: asTruth(0.8),
      turned: false,
      hostileControlled: asTruth(false),
    },
  };
}

/**
 * A within-day start time (so the single step to the meeting slot crosses no
 * Day Boundary and the real Phase Step opens the scene cleanly): day 0–4, any
 * phase but the last.
 */
const sceneStartArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: 4 }),
  phase: fc.integer({ min: 0, max: PHASES_PER_DAY - 2 }).map((p) => p as Phase),
});

const sceneCaseArb = fc.record({
  start: sceneStartArb,
  // Several phases requested, so stopping at the slot is a genuine early stop.
  phases: fc.integer({ min: 1, max: 6 }),
  seed: seedArb,
});

describe('Property 35: Early stop on an opened scene (Req 1.4)', () => {
  it('surfaces the first openScene from the real Phase Step and stops at the slot', () => {
    fc.assert(
      fc.property(sceneCaseArb, ({ start, phases, seed }) => {
        const slot = addPhases(start, 1);
        const scheduled = scheduledSomewhere(BASE, slot);
        // Only the states where some NPC is scheduled at the slot can stage a
        // meeting; skip the rest (fc.pre discards without failing).
        fc.pre(scheduled !== undefined);
        if (scheduled === undefined) {
          return;
        }
        const { npc, loc } = scheduled;

        const kept: Meeting = {
          id: `meeting:${npc}@${loc}#0.1`,
          npc,
          at: loc,
          slot,
          status: 'accepted',
          acceptance: 1,
        };
        const state: WorldState = {
          ...atTime(BASE, start),
          player: { ...BASE.player, loc },
          meetings: { [kept.id]: kept },
          relationships: { ...BASE.relationships, [npc]: assetRel(npc) },
        };

        const result = advanceWorld(
          state,
          phases,
          createPrng(seed),
          depsWith(buildWorldHooks()),
        );

        // The scene is surfaced for the meeting NPC, with no End Condition.
        expect(result.openScene).toEqual({ npc });
        expect(result.ended).toBeUndefined();

        // Stopped at the slot: time is the slot, one phase spent (its offset),
        // at most the requested phases (Req 1.4).
        expect(result.state.time).toEqual(slot);
        expect(result.phasesSpent).toBe(offset(start, slot));
        expect(result.phasesSpent).toBe(1);
        expect(result.phasesSpent).toBeLessThanOrEqual(phases);

        // The meeting the Phase Step kept is recorded as kept at commit.
        expect(result.state.meetings[kept.id].status).toBe('kept');
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Control — no early stop (anchors the contrast; full coverage in task 5.3)
// ---------------------------------------------------------------------------

describe('Property 35: No early stop runs the full span (control)', () => {
  it('spends every requested phase when no hook ends and nothing opens a scene', () => {
    fc.assert(
      fc.property(crossingArb, ({ start, phases, seed }) => {
        const { hooks } = inertSpies();
        const result = advanceWorld(
          atTime(BASE, start),
          phases,
          createPrng(seed),
          depsWith(hooks),
        );
        expect(result.ended).toBeUndefined();
        expect(result.openScene).toBeUndefined();
        expect(result.phasesSpent).toBe(phases);
        expect(result.state.time).toEqual(addPhases(start, phases));
      }),
      { numRuns: 60 },
    );
  });
});
