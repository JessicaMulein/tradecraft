/**
 * Tests for NPC schedule advancement and Walk-ins on the daily stream (task
 * 7.3; Requirements 3.5, 22.7).
 *
 * These load the real core pack and run the step-1→3 core stream (city, orgs,
 * principals) on one PRNG stream to build real {@link Npc}s with concrete
 * schedules, then check the invariants the design fixes:
 *
 * - {@link advanceSchedules} emits a hidden `npc-moved` exactly for NPCs whose
 *   scheduled Location changed between two times, and nothing for those that
 *   did not; the emitted `from`/`to` match {@link scheduledLocationAt} at the
 *   two times (Req 3.5);
 * - {@link rollWalkIn} always fires at probability 1 and never at 0, and the
 *   drawn NPC and genuineness are deterministic for a seed/day (Req 22.7);
 * - the day-boundary hook adapter returns the day's movements plus the walk-in
 *   events;
 * - determinism: same seed+day ⇒ identical events (Req 1.2).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  type CityData,
  type ContentSet,
  type DescriptorData,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { revealTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import { generateCity } from '../city/generate.js';
import { generateOrgs, generatePrincipals } from '../city/principals.js';
import { type Npc } from '../city/npc.js';
import { dailyStreamSeed } from '../city/city.js';
import type { SimEvent } from '../model/state.js';

import {
  advanceSchedules,
  rollWalkIn,
  scheduledLocationAt,
  schedulesDayBoundaryHook,
  whereaboutsAt,
  DEFAULT_WALK_IN_PROBABILITY,
  DEFAULT_GENUINE_PROBABILITY,
} from './schedules.js';

// ---------------------------------------------------------------------------
// Core pack loader (mirrors plot-execution.spec.ts / background.spec.ts)
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

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
  };
}

const { content, cityData, descriptors } = loadCore();
const locationTypes = [...content.locationTypes.values()];

/** Run the step-1→3 core stream for a seed and build the Principal NPCs. */
function genNpcs(seed: string): Readonly<Record<NpcId, Npc>> {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  return principals.npcs;
}

const NPCS = genNpcs('schedule-seed');
const NPC_IDS = (Object.keys(NPCS) as NpcId[]).sort();

/** All times across one representative week (7 days × 4 phases). */
function weekTimes(): GameTime[] {
  const out: GameTime[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (let phase = 0 as GameTime['phase']; phase <= 3; phase = (phase + 1) as GameTime['phase']) {
      out.push({ day, phase });
    }
  }
  return out;
}

const WEEK = weekTimes();

// ---------------------------------------------------------------------------
// scheduledLocationAt
// ---------------------------------------------------------------------------

describe('scheduledLocationAt', () => {
  it('is a pure function of the NPC and time (deterministic)', () => {
    for (const npc of Object.values(NPCS)) {
      for (const t of WEEK) {
        expect(scheduledLocationAt(npc, t)).toBe(scheduledLocationAt(npc, t));
      }
    }
  });

  it('returns a Location that appears in the NPC schedule, or undefined', () => {
    for (const npc of Object.values(NPCS)) {
      const scheduleLocs = new Set<LocId>(npc.schedule.entries.map((e) => e.loc));
      for (const t of WEEK) {
        const loc = scheduledLocationAt(npc, t);
        if (loc !== undefined) {
          expect(scheduleLocs.has(loc)).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// whereaboutsAt (the shape of WorldState.whereabouts)
// ---------------------------------------------------------------------------

describe('whereaboutsAt', () => {
  it("gives every NPC its scheduled Location, or 'absent' when the schedule names none", () => {
    let placed = 0;
    let absent = 0;
    for (const t of WEEK) {
      const where = whereaboutsAt(NPCS, t);
      expect(Object.keys(where).sort()).toEqual(NPC_IDS);
      for (const id of NPC_IDS) {
        const loc = scheduledLocationAt(NPCS[id], t);
        expect(where[id]).toBe(loc ?? 'absent');
        if (loc === undefined) {
          absent += 1;
        } else {
          placed += 1;
        }
      }
    }
    // The week exercises both branches, so neither assertion above is vacuous.
    expect(placed).toBeGreaterThan(0);
    expect(absent).toBeGreaterThan(0);
  });

  it("marks an NPC with an empty schedule 'absent'", () => {
    const id = NPC_IDS[0];
    const unscheduled: Npc = { ...NPCS[id], schedule: { entries: [] } };
    expect(whereaboutsAt({ [id]: unscheduled }, { day: 0, phase: 0 })).toEqual({
      [id]: 'absent',
    });
  });

  it('returns an empty record for no NPCs', () => {
    expect(whereaboutsAt({}, { day: 3, phase: 2 })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// advanceSchedules (Requirement 3.5)
// ---------------------------------------------------------------------------

describe('advanceSchedules', () => {
  it('emits npc-moved exactly for NPCs whose scheduled Location changed', () => {
    for (let i = 0; i < WEEK.length - 1; i += 1) {
      const from = WEEK[i];
      const to = WEEK[i + 1];
      const events = advanceSchedules(NPCS, from, to);
      const moved = new Set(events.map((e) => (e.kind === 'npc-moved' ? e.npc : undefined)));

      for (const id of NPC_IDS) {
        const before = scheduledLocationAt(NPCS[id], from);
        const after = scheduledLocationAt(NPCS[id], to);
        const shouldMove =
          before !== undefined && after !== undefined && before !== after;
        expect(moved.has(id)).toBe(shouldMove);
      }
    }
  });

  it('emits from/to that match scheduledLocationAt at the two times', () => {
    for (let i = 0; i < WEEK.length - 1; i += 1) {
      const from = WEEK[i];
      const to = WEEK[i + 1];
      for (const e of advanceSchedules(NPCS, from, to)) {
        expect(e.kind).toBe('npc-moved');
        if (e.kind === 'npc-moved') {
          expect(e.from).toBe(scheduledLocationAt(NPCS[e.npc], from));
          expect(e.to).toBe(scheduledLocationAt(NPCS[e.npc], to));
          expect(e.from).not.toBe(e.to);
          expect(e.visibility).toBe('hidden');
          expect(e.at).toEqual(to);
        }
      }
    }
  });

  it('emits nothing when from and to are the same time (no NPC moved)', () => {
    for (const t of WEEK) {
      expect(advanceSchedules(NPCS, t, t)).toEqual([]);
    }
  });

  it('is deterministic: same inputs produce identical events', () => {
    const from: GameTime = { day: 0, phase: 0 };
    const to: GameTime = { day: 0, phase: 1 };
    expect(advanceSchedules(NPCS, from, to)).toEqual(advanceSchedules(NPCS, from, to));
  });

  it('emits events in id-sorted NPC order', () => {
    // Find a transition that moves at least two NPCs, then check order.
    for (let i = 0; i < WEEK.length - 1; i += 1) {
      const events = advanceSchedules(NPCS, WEEK[i], WEEK[i + 1]);
      const movedIds = events.map((e) => (e.kind === 'npc-moved' ? e.npc : '')).filter(Boolean);
      if (movedIds.length >= 2) {
        expect(movedIds).toEqual([...movedIds].sort());
        return;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// rollWalkIn (Requirement 22.7)
// ---------------------------------------------------------------------------

const DAY: GameTime = { day: 3, phase: 0 };

describe('rollWalkIn', () => {
  it('always fires at probability 1 and emits approach + walk-in', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const r = rollWalkIn(createPrng(seed), NPCS, DAY, {
          walkInProbability: 1,
          genuineProbability: 0.5,
        });
        expect(r.events).toHaveLength(2);
        const approach = r.events[0];
        const visible = r.events[1];
        expect(approach.kind).toBe('walk-in-approach');
        expect(visible.kind).toBe('walk-in');
        expect(approach.visibility).toBe('hidden');
        expect(visible.visibility).toBe('player');
        if (approach.kind === 'walk-in-approach' && visible.kind === 'walk-in') {
          // The visible notification names the same NPC as the hidden approach.
          expect(visible.npc).toBe(approach.npc);
          // The hidden approach carries the ground-truth genuineness.
          expect(typeof revealTruth(approach.genuine)).toBe('boolean');
          expect(r.npc).toBe(approach.npc);
          expect(r.genuine).toBe(revealTruth(approach.genuine));
        }
      }),
      { numRuns: 40 },
    );
  });

  it('never fires at probability 0', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const r = rollWalkIn(createPrng(seed), NPCS, DAY, { walkInProbability: 0 });
        expect(r.events).toEqual([]);
        expect(r.npc).toBeUndefined();
        expect(r.genuine).toBeUndefined();
      }),
      { numRuns: 40 },
    );
  });

  it('draws an eligible NPC from the pool', () => {
    const pool = new Set(NPC_IDS);
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const r = rollWalkIn(createPrng(seed), NPCS, DAY, { walkInProbability: 1 });
        expect(r.npc).toBeDefined();
        if (r.npc !== undefined) {
          expect(pool.has(r.npc)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('restricts the drawn NPC to a provided candidate list', () => {
    const candidates = NPC_IDS.slice(0, 2);
    const set = new Set(candidates);
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const r = rollWalkIn(createPrng(seed), NPCS, DAY, {
          walkInProbability: 1,
          candidates,
        });
        if (r.npc !== undefined) {
          expect(set.has(r.npc)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('emits nothing when the candidate pool is empty, even if the roll succeeds', () => {
    const r = rollWalkIn(createPrng('empty'), NPCS, DAY, {
      walkInProbability: 1,
      candidates: [],
    });
    expect(r.events).toEqual([]);
  });

  it('genuine=1 is always genuine, genuine=0 never genuine', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const yes = rollWalkIn(createPrng(seed), NPCS, DAY, {
          walkInProbability: 1,
          genuineProbability: 1,
        });
        const no = rollWalkIn(createPrng(seed), NPCS, DAY, {
          walkInProbability: 1,
          genuineProbability: 0,
        });
        expect(yes.genuine).toBe(true);
        expect(no.genuine).toBe(false);
      }),
      { numRuns: 30 },
    );
  });

  it('is deterministic: same seed and day produce identical NPC and genuineness', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (seed, walkInProbability, genuineProbability) => {
          const a = rollWalkIn(createPrng(seed), NPCS, DAY, {
            walkInProbability,
            genuineProbability,
          });
          const b = rollWalkIn(createPrng(seed), NPCS, DAY, {
            walkInProbability,
            genuineProbability,
          });
          expect(a.npc).toBe(b.npc);
          expect(a.genuine).toBe(b.genuine);
          expect(a.events).toEqual(b.events);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('rejects probabilities outside [0, 1]', () => {
    expect(() => rollWalkIn(createPrng('x'), NPCS, DAY, { walkInProbability: 1.5 })).toThrow();
    expect(() => rollWalkIn(createPrng('x'), NPCS, DAY, { genuineProbability: -0.1 })).toThrow();
  });

  it('exposes sane default probabilities', () => {
    expect(DEFAULT_WALK_IN_PROBABILITY).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_WALK_IN_PROBABILITY).toBeLessThanOrEqual(1);
    expect(DEFAULT_GENUINE_PROBABILITY).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_GENUINE_PROBABILITY).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// schedulesDayBoundaryHook
// ---------------------------------------------------------------------------

describe('schedulesDayBoundaryHook', () => {
  const SEED = 'world-seed';
  const makePrng = (s: string): ReturnType<typeof createPrng> => createPrng(s);

  it('returns the boundary movements plus the day walk-in events', () => {
    const hook = schedulesDayBoundaryHook({ npcs: NPCS }, makePrng, {
      walkInProbability: 1,
    });
    const time: GameTime = { day: 2, phase: 0 };
    const dss = dailyStreamSeed(SEED, time.day);
    const events = hook({ time, dailyStreamSeed: dss });

    // Boundary movements = advanceSchedules across the night->morning boundary.
    const prevNight: GameTime = { day: time.day - 1, phase: 3 };
    const movements = advanceSchedules(NPCS, prevNight, time);
    const walkIn = rollWalkIn(createPrng(dss), NPCS, time, { walkInProbability: 1 });

    const moveEvents = events.filter((e) => e.kind === 'npc-moved');
    const walkEvents = events.filter(
      (e) => e.kind === 'walk-in' || e.kind === 'walk-in-approach',
    );
    expect(moveEvents).toHaveLength(movements.length);
    expect(walkEvents).toHaveLength(walkIn.events.length);
    expect(walkEvents).toHaveLength(2);
  });

  it('emits no boundary movements on day 0 (no previous day)', () => {
    const hook = schedulesDayBoundaryHook({ npcs: NPCS }, makePrng, {
      walkInProbability: 0,
    });
    const time: GameTime = { day: 0, phase: 0 };
    const events = hook({ time, dailyStreamSeed: dailyStreamSeed(SEED, 0) });
    expect(events).toEqual([]);
  });

  it('is deterministic: same seed+day produce identical events', () => {
    const hook = schedulesDayBoundaryHook({ npcs: NPCS }, makePrng, {
      walkInProbability: 0.5,
    });
    const time: GameTime = { day: 5, phase: 0 };
    const dss = dailyStreamSeed(SEED, time.day);
    const a = hook({ time, dailyStreamSeed: dss });
    const b = hook({ time, dailyStreamSeed: dss });
    expect(a).toEqual(b);
  });

  it('produces events that are either hidden npc-moved/walk-in-approach or player walk-in', () => {
    const hook = schedulesDayBoundaryHook({ npcs: NPCS }, makePrng, {
      walkInProbability: 1,
    });
    const time: GameTime = { day: 4, phase: 0 };
    const events: readonly SimEvent[] = hook({
      time,
      dailyStreamSeed: dailyStreamSeed(SEED, time.day),
    });
    for (const e of events) {
      expect(['npc-moved', 'walk-in-approach', 'walk-in']).toContain(e.kind);
    }
  });
});
