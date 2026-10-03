/**
 * Smoke and behaviour tests for the world-advancing clock (slice-integration
 * task 5.1; Requirements 1.1, 1.4, 1.9, 1.10, 2.1, 2.6, 2.7, 2.8, 7.1, 7.5).
 * They run {@link advanceWorld} over a world generated from the real core pack
 * and check the headline behaviours: phase-by-phase stepping, the Day Boundary
 * running the hooks then the Phase Step, the `day-start` weather drawn on the
 * daily stream, early stop on an End Condition and on an opened scene, and
 * determinism for a seed. The section-5 property tests (5.3–5.10) are separate
 * later tasks.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import type { Meeting } from '../action/types.js';
import { weatherForDay } from '../city/city.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { asTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { newRelationship, type Relationship } from '../recruit/asset.js';
import type { TruthStore } from '../truth/truth.js';
import { addPhases } from './clock.js';
import { scheduledLocationAt } from './schedules.js';
import { buildWorldHooks } from './world-hooks.js';
import type { AdvanceWorldDeps } from './world-types.js';
import { advanceWorld } from './advance-world.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors phase-step.spec.ts / world-hooks.spec.ts)
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
const SEED = 'advance-world-alpha';
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

/** The state moved to `time` (nothing else changes). */
function atTime(state: WorldState, time: GameTime): WorldState {
  return { ...state, time };
}

/** Run `advanceWorld` with a fresh runtime stream from `runtimeSeed`. */
function run(
  state: WorldState,
  phases: number,
  runtimeSeed = 'runtime',
  deps: AdvanceWorldDeps = DEPS,
) {
  return advanceWorld(state, phases, createPrng(runtimeSeed), deps);
}

/** The NPC ids, sorted. */
function npcIds(state: WorldState): NpcId[] {
  return (Object.keys(state.npcs) as NpcId[]).sort();
}

/** An NPC its schedule places somewhere at `t`, with that Location. */
function scheduledSomewhere(state: WorldState, t: GameTime): { npc: NpcId; loc: LocId } {
  for (const npc of npcIds(state)) {
    const loc = scheduledLocationAt(state.npcs[npc], t);
    if (loc !== undefined) {
      return { npc, loc };
    }
  }
  throw new Error('no NPC is scheduled anywhere at that time');
}

/** A running Asset with a Contact Channel, at trust 0.5 (mirrors phase-step.spec). */
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

// ---------------------------------------------------------------------------
// Zero phases and basic stepping (Req 1.1, 1.10)
// ---------------------------------------------------------------------------

describe('advanceWorld — stepping (Req 1.1, 1.10)', () => {
  it('advancing zero phases runs nothing and leaves the state at its time', () => {
    const start = atTime(BASE, { day: 1, phase: 2 });
    const result = run(start, 0);
    expect(result.phasesSpent).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.state.time).toEqual({ day: 1, phase: 2 });
    expect(result.openScene).toBeUndefined();
    expect(result.ended).toBeUndefined();
  });

  it('steps phase by phase within a day and reports the phases spent', () => {
    // From day 0 phase 0, +2 phases lands on day 0 phase 2 (no boundary).
    const result = run(BASE, 2);
    expect(result.phasesSpent).toBe(2);
    expect(result.state.time).toEqual({ day: 0, phase: 2 });
    // No Day Boundary crossed, so no day-start event.
    expect(result.events.some((e) => e.kind === 'day-start')).toBe(false);
  });

  it('rejects negative or fractional phases', () => {
    expect(() => run(BASE, -1)).toThrow(RangeError);
    expect(() => run(BASE, 1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Day Boundary: weather, hooks, then the Phase Step (Req 2.1, 2.6, 2.7, 2.8)
// ---------------------------------------------------------------------------

describe('advanceWorld — Day Boundary (Req 2.1, 2.6, 2.7, 2.8)', () => {
  it('emits day-start first, then runs the hooks (a newspaper is published)', () => {
    // From day 0 phase 3, +1 phase crosses into day 1 phase 0.
    const start = atTime(BASE, { day: 0, phase: 3 });
    const result = run(start, 1);

    expect(result.state.time).toEqual({ day: 1, phase: 0 });
    expect(result.events[0]?.kind).toBe('day-start');
    // The newspaper hook ran at the boundary: the day's edition is published.
    expect(result.state.newspapers[1]).toBeDefined();
    expect(result.events.some((e) => e.kind === 'newspaper')).toBe(true);
  });

  it('runs the full hook sequence once per boundary across a multi-day advance (Req 2.7)', () => {
    // From day 0 phase 3, +5 phases crosses day 1 (phase 0) and day 2 (phase 0).
    const start = atTime(BASE, { day: 0, phase: 3 });
    const result = run(start, 5);

    expect(result.state.time).toEqual({ day: 2, phase: 0 });
    const dayStarts = result.events.filter((e) => e.kind === 'day-start');
    expect(dayStarts.map((e) => e.at.day)).toEqual([1, 2]);
    expect(result.state.newspapers[1]).toBeDefined();
    expect(result.state.newspapers[2]).toBeDefined();
  });

  it('sets the day-start weather from the daily stream and the city tables (Req 2.6)', () => {
    const start = atTime(BASE, { day: 0, phase: 3 });
    const expected = weatherForDay(SEED, BASE.city, INPUTS.cityData, 1);

    const result = run(start, 1);
    const dayStart = result.events.find((e) => e.kind === 'day-start');
    expect(dayStart).toBeDefined();
    if (dayStart?.kind === 'day-start') {
      expect(dayStart.weather.summary).toBe(expected.label);
    }
  });

  it('draws the weather on the daily stream, not the runtime stream', () => {
    const start = atTime(BASE, { day: 0, phase: 3 });
    const a = run(start, 1, 'runtime-a');
    const b = run(start, 1, 'runtime-b');
    const weatherOf = (r: typeof a): string | undefined => {
      const e = r.events.find((x) => x.kind === 'day-start');
      return e?.kind === 'day-start' ? e.weather.summary : undefined;
    };
    // A different runtime seed must not change the day's weather.
    expect(weatherOf(a)).toBe(weatherOf(b));
  });
});

// ---------------------------------------------------------------------------
// Event ids (design "Event ids")
// ---------------------------------------------------------------------------

describe('advanceWorld — event ids', () => {
  it('re-ids every event as evt:<day>:<phase>:<seq> with one sequence per call', () => {
    const start = atTime(BASE, { day: 0, phase: 3 });
    const result = run(start, 1);
    expect(result.events.length).toBeGreaterThan(0);
    result.events.forEach((e, seq) => {
      expect(e.id).toBe(`evt:${e.at.day}:${e.at.phase}:${seq}`);
    });
    // Ids are unique within the call.
    expect(new Set(result.events.map((e) => e.id)).size).toBe(result.events.length);
  });
});

// ---------------------------------------------------------------------------
// Early stop: End Condition (Req 7.1, 7.5)
// ---------------------------------------------------------------------------

describe('advanceWorld — early stop on an End Condition (Req 7.1, 7.5)', () => {
  it('stops at the phase where detectEnd reports an end and writes WorldState.ended', () => {
    // A Plot already aborted makes detectEnd report a WIN after the first phase.
    const aborted: WorldState = {
      ...BASE,
      plot: { ...BASE.plot, status: 'aborted', abortCause: 'pressure' },
    };
    const result = run(aborted, 3);

    expect(result.ended).toBeDefined();
    expect(result.ended?.outcome).toBe('success');
    expect(result.state.ended).toEqual(result.ended);
    // Stopped at the first phase, not all three.
    expect(result.phasesSpent).toBe(1);
    expect(result.state.time).toEqual({ day: 0, phase: 1 });
  });

  it('keeps the first end: a game already ended stays ended', () => {
    const start = atTime(BASE, { day: 1, phase: 0 });
    const already: WorldState = {
      ...start,
      ended: { outcome: 'success', at: { day: 1, phase: 0 }, cause: 'pressure' },
    };
    const result = run(already, 2);
    expect(result.ended).toEqual(already.ended);
    expect(result.state.ended).toEqual(already.ended);
  });
});

// ---------------------------------------------------------------------------
// Early stop: opened scene (Req 1.4)
// ---------------------------------------------------------------------------

describe('advanceWorld — early stop on a kept meeting (Req 1.4)', () => {
  it('surfaces the first openScene and stops at that slot', () => {
    // Advance one phase within day 0 (no boundary) into a slot with a meeting.
    const to = addPhases(BASE.time, 1);
    const { npc, loc } = scheduledSomewhere(BASE, to);
    const kept: Meeting = {
      id: `meeting:${npc}@${loc}#0.1`,
      npc,
      at: loc,
      slot: to,
      status: 'accepted',
      acceptance: 1,
    };
    const state: WorldState = {
      ...BASE,
      player: { ...BASE.player, loc },
      meetings: { [kept.id]: kept },
      relationships: { ...BASE.relationships, [npc]: assetRel(npc) },
    };

    const result = run(state, 3);

    expect(result.openScene).toEqual({ npc });
    expect(result.phasesSpent).toBe(1);
    expect(result.state.time).toEqual(to);
    expect(result.state.meetings[kept.id].status).toBe('kept');
  });
});

// ---------------------------------------------------------------------------
// Determinism (Req 5.1, 5.6, threaded rng)
// ---------------------------------------------------------------------------

describe('advanceWorld — determinism', () => {
  it('produces deep-equal results for the same inputs and seed', () => {
    const start = atTime(BASE, { day: 0, phase: 3 });
    const a = run(start, 6, 'runtime-seed');
    const b = run(start, 6, 'runtime-seed');
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    expect(a.phasesSpent).toBe(b.phasesSpent);
  });

  it('threads the runtime stream state back into the returned state', () => {
    const start = atTime(BASE, { day: 0, phase: 3 });
    const rng = createPrng('runtime-seed');
    const result = advanceWorld(start, 6, rng, DEPS);
    expect(result.state.rng).toEqual(rng.state());
  });
});
