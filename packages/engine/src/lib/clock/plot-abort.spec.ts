/**
 * Tests for Plot abort (task 7.4; Requirements 19.4, 38.1, 38.2, 38.4, 38.5,
 * 38.6).
 *
 * These pin the design's "Plot abort (Req 38)" machinery:
 *
 * - {@link abortTolerance} and {@link leaderAbortThreshold} match the design's
 *   doctrine formulas across the whole `riskTolerance` range;
 * - {@link abortCheck} is pure and returns the right {@link AbortTrigger}:
 *   `pressure` when `abortPressure` exceeds the tolerance, `leader-suspicion`
 *   at/over the leader threshold, `materiel-seized` when seized, `null`
 *   otherwise;
 * - distinct-key pressure accounting dedupes (the same key twice adds 1 — the
 *   core of Property 27);
 * - a 7.2 `abort` draw / `reroute`-with-no-alternative (outcome `aborted`)
 *   drives the Plot to `status: 'aborted'` with the right `abortCause`, a
 *   hidden `plot-aborted` event carrying the trigger, and an `ended` intent of
 *   outcome `success`;
 * - the belief-pressure hook adds once per belief key;
 * - determinism.
 *
 * They build a real {@link PlotState} via the full core stream (mirroring
 * plot-execution.spec.ts's loader) and drive {@link executePlotDay} to produce
 * the real {@link PlotDayResult}s {@link considerPlotDay} consumes.
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
  type DifficultyPreset,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { revealTruth, type GameTime, type NpcId } from '../model/core.js';
import { generateCity } from '../city/generate.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';
import { generatePlot, type PlotState } from '../city/plot.js';
import { generateComms } from '../city/comms.js';
import { type City } from '../city/city.js';

import {
  executePlotDay,
  NO_DISRUPTION,
  type DisruptionContext,
  type PlotWorld,
} from './plot-execution.js';
import {
  ABORT_END_OUTCOME,
  abortCheck,
  abortTolerance,
  accruePressure,
  applyAbort,
  applyBeliefPressure,
  considerPlotDay,
  disruptionKey,
  leaderAbortThreshold,
  type Doctrine,
} from './plot-abort.js';

// ---------------------------------------------------------------------------
// Core pack loader (mirrors plot-execution.spec.ts)
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
    throw new Error('core pack failed to load');
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

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');
const START: GameTime = { day: 0, phase: 0 };

interface Generated {
  readonly plot: PlotState;
  readonly world: PlotWorld;
}

/** Run the full core stream for a seed and build the Plot + its world context. */
function gen(seed: string): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs: GeneratedOrgs = generateOrgs(prng);
  const principals: GeneratedPrincipals = generatePrincipals(
    prng,
    content,
    descriptors,
    city,
    orgs,
  );
  const { plot } = generatePlot(prng, content, STANDARD, city, orgs, principals, START);
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const world: PlotWorld = {
    city,
    npcs: principals.npcs,
    channels: comms.channels,
    deadDrops: comms.deadDrops,
  };
  return { plot, world };
}

const DAY_ONE: GameTime = { day: 1, phase: 0 };

/** A Doctrine with the given risk tolerance. */
const doc = (riskTolerance: number): Doctrine => ({ riskTolerance });

/** A context with no materiel seizure and the given suspicion / doctrine. */
function ctx(
  leaderSuspicion: number,
  materielSeized: boolean,
  riskTolerance: number,
): { leaderSuspicion: number; materielSeized: boolean; doctrine: Doctrine } {
  return { leaderSuspicion, materielSeized, doctrine: doc(riskTolerance) };
}

/** The leader NPC of a generated Plot. */
function leaderOf(plot: PlotState): NpcId {
  return revealTruth(plot.leader);
}

/** A disruption context that arrests exactly the given NPCs. */
function arrests(...npcs: NpcId[]): DisruptionContext {
  const set = new Set<NpcId>(npcs);
  return { ...NO_DISRUPTION, isArrested: (n) => set.has(n) };
}

/** Force the first stage onto a fixed `onDisrupted` weighting. */
function forceFirstStage(
  plot: PlotState,
  onDisrupted: { delay: number; reroute: number; abort: number },
): PlotState {
  return {
    ...plot,
    stages: plot.stages.map((s, i) => (i === 0 ? { ...s, onDisrupted } : s)),
  };
}

/** A day on which the first stage of the Plot is due. */
function dayOf(plot: PlotState): GameTime {
  return { day: plot.stages[0].deadline.day, phase: 0 };
}

// ---------------------------------------------------------------------------
// Doctrine thresholds (design formulas)
// ---------------------------------------------------------------------------

describe('abortTolerance / leaderAbortThreshold (Req 38)', () => {
  it('matches the design formula 1 + round(3·riskTolerance)', () => {
    expect(abortTolerance(doc(0))).toBe(1);
    expect(abortTolerance(doc(0.5))).toBe(1 + Math.round(1.5)); // 3
    expect(abortTolerance(doc(1))).toBe(4);
  });

  it('matches the design formula 0.9 − 0.3·riskTolerance', () => {
    expect(leaderAbortThreshold(doc(0))).toBeCloseTo(0.9);
    expect(leaderAbortThreshold(doc(0.5))).toBeCloseTo(0.75);
    expect(leaderAbortThreshold(doc(1))).toBeCloseTo(0.6);
  });

  it('is exactly the design formulas across the whole riskTolerance range', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (r) => {
          expect(abortTolerance(doc(r))).toBe(1 + Math.round(3 * r));
          expect(leaderAbortThreshold(doc(r))).toBe(0.9 - 0.3 * r);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// abortCheck — the pure decision (Req 38.4)
// ---------------------------------------------------------------------------

describe('abortCheck (Req 38.4)', () => {
  it('returns null for an untouched Plot under no pressure', () => {
    const { plot } = gen('check-null');
    // standard doctrine (risk ~ 0.45); low suspicion, no seizure.
    expect(abortCheck(plot, ctx(0.1, false, 0.5))).toBeNull();
  });

  it("returns 'pressure' when abortPressure exceeds the doctrine tolerance", () => {
    const { plot } = gen('check-pressure');
    const r = 0; // tolerance = 1
    const over: PlotState = { ...plot, abortPressure: abortTolerance(doc(r)) + 1 };
    expect(abortCheck(over, ctx(0, false, r))).toBe('pressure');
    // Exactly at tolerance does NOT abort (strictly greater).
    const at: PlotState = { ...plot, abortPressure: abortTolerance(doc(r)) };
    expect(abortCheck(at, ctx(0, false, r))).toBeNull();
  });

  it("returns 'leader-suspicion' at or over the leader threshold", () => {
    const { plot } = gen('check-leader');
    const r = 0.5; // threshold = 0.75
    expect(abortCheck(plot, ctx(leaderAbortThreshold(doc(r)), false, r))).toBe(
      'leader-suspicion',
    );
    expect(abortCheck(plot, ctx(0.76, false, r))).toBe('leader-suspicion');
    expect(abortCheck(plot, ctx(0.74, false, r))).toBeNull();
  });

  it("returns 'materiel-seized' when the materiel is seized", () => {
    const { plot } = gen('check-seized');
    expect(abortCheck(plot, ctx(0, true, 0.5))).toBe('materiel-seized');
  });

  it('prioritises materiel seizure, then pressure, then leader suspicion', () => {
    const { plot } = gen('check-priority');
    const r = 0;
    const loaded: PlotState = { ...plot, abortPressure: abortTolerance(doc(r)) + 1 };
    // All three conditions hold; materiel seizure wins.
    expect(abortCheck(loaded, ctx(1, true, r))).toBe('materiel-seized');
    // Pressure + leader; pressure wins.
    expect(abortCheck(loaded, ctx(1, false, r))).toBe('pressure');
  });

  it('does not mutate the Plot', () => {
    const { plot } = gen('check-immut');
    const before = JSON.stringify(plot);
    abortCheck(plot, ctx(1, true, 1));
    expect(JSON.stringify(plot)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Pressure accounting — distinct keys only (Req 38.1, 38.2; Property 27)
// ---------------------------------------------------------------------------

describe('accruePressure — distinct keys only (Property 27)', () => {
  it('adds 1 and records the key for a new distinct key', () => {
    const { plot } = gen('accrue-new');
    const next = accruePressure(plot, 'participant-arrested:npc:a');
    expect(next.abortPressure).toBe(plot.abortPressure + 1);
    expect(next.pressureKeys).toContain('participant-arrested:npc:a');
  });

  it('dedupes: the same key twice adds only 1', () => {
    const { plot } = gen('accrue-dup');
    const once = accruePressure(plot, 'materiel-seized');
    const twice = accruePressure(once, 'materiel-seized');
    expect(twice.abortPressure).toBe(plot.abortPressure + 1);
    expect(twice).toBe(once); // a repeat is a no-op, same value returned
  });

  it('abortPressure always equals the number of distinct keys (Property 27)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 20 }),
        (keys) => {
          const { plot } = gen('accrue-prop');
          let p = plot;
          for (const k of keys) {
            p = accruePressure(p, k);
          }
          const distinct = new Set(keys).size;
          expect(p.abortPressure).toBe(plot.abortPressure + distinct);
          expect(new Set(p.pressureKeys).size).toBe(p.pressureKeys.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('does not mutate the input Plot', () => {
    const { plot } = gen('accrue-immut');
    const before = JSON.stringify(plot);
    accruePressure(plot, 'k');
    expect(JSON.stringify(plot)).toEqual(before);
  });
});

describe('applyBeliefPressure — belief hook (wired by 19.6)', () => {
  it('adds once per belief key', () => {
    const { plot } = gen('belief-once');
    const once = applyBeliefPressure(plot, 'knows-target');
    const twice = applyBeliefPressure(once, 'knows-target');
    expect(once.abortPressure).toBe(plot.abortPressure + 1);
    expect(twice.abortPressure).toBe(plot.abortPressure + 1);
    expect(once.pressureKeys).toContain('belief:knows-target');
  });

  it('a belief key and a disruption key of the same text do not collide', () => {
    const { plot } = gen('belief-ns');
    const a = applyBeliefPressure(plot, 'materiel-seized');
    const b = accruePressure(a, 'materiel-seized');
    // Belief namespacing keeps the two distinct, so pressure is 2.
    expect(b.abortPressure).toBe(plot.abortPressure + 2);
  });
});

describe('disruptionKey — strips the 7.2 response prefix', () => {
  it('recovers the bare key from any response prefix', () => {
    expect(disruptionKey('abort:materiel-seized')).toBe('materiel-seized');
    expect(disruptionKey('no-reroute:participant-arrested:npc:x')).toBe(
      'participant-arrested:npc:x',
    );
    expect(disruptionKey('delay:channel-compromised:chan:y')).toBe(
      'channel-compromised:chan:y',
    );
    expect(disruptionKey('materiel-seized')).toBe('materiel-seized');
  });
});

// ---------------------------------------------------------------------------
// applyAbort — the Turn-Pipeline seam (Req 38.5, 38.6)
// ---------------------------------------------------------------------------

describe('applyAbort (Req 38.5, 38.6)', () => {
  it("aborts the Plot, sets abortCause and emits a plot-aborted event with the trigger", () => {
    const { plot } = gen('apply-abort');
    const decision = applyAbort(plot, 'pressure', DAY_ONE);
    expect(decision.plot.status).toBe('aborted');
    expect(decision.plot.abortCause).toBe('pressure');
    expect(decision.event.kind).toBe('plot-aborted');
    expect(decision.event.visibility).toBe('hidden');
    if (decision.event.kind === 'plot-aborted') {
      expect(decision.event.trigger).toBe('pressure');
    }
  });

  it("sets the ended intent to outcome 'success'", () => {
    const { plot } = gen('apply-ended');
    const decision = applyAbort(plot, 'leader-suspicion', DAY_ONE);
    expect(decision.ended.outcome).toBe(ABORT_END_OUTCOME);
    expect(decision.ended.outcome).toBe('success');
    expect(decision.ended.cause).toBe('leader-suspicion');
    expect(decision.ended.at).toEqual(DAY_ONE);
  });

  it('does not mutate the input Plot', () => {
    const { plot } = gen('apply-immut');
    const before = JSON.stringify(plot);
    applyAbort(plot, 'materiel-seized', DAY_ONE);
    expect(JSON.stringify(plot)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// considerPlotDay — composing the seams against real 7.2 output (Req 38.4)
// ---------------------------------------------------------------------------

describe('considerPlotDay — abort on a 7.2 abort draw (Req 38.4)', () => {
  it("drives the Plot to aborted with cause 'disruption-draw' on an abort draw", () => {
    const { plot, world } = gen('abort-draw');
    const forced = forceFirstStage(plot, { delay: 0, reroute: 0, abort: 1 });
    const day = executePlotDay(forced, dayOf(forced), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(day.outcome).toBe('aborted');

    const result = considerPlotDay(day, DAY_ONE, ctx(0, false, 0.5));
    expect(result.decision).not.toBeNull();
    const decision = result.decision!;
    expect(decision.plot.status).toBe('aborted');
    expect(decision.plot.abortCause).toBe('disruption-draw');
    expect(decision.event.kind).toBe('plot-aborted');
    expect(decision.ended.outcome).toBe('success');
    // Pressure was still accrued for the distinct disruption.
    expect(result.plot.abortPressure).toBe(plot.abortPressure + 1);
  });

  it("maps a reroute-with-no-alternative to cause 'no-reroute'", () => {
    const { plot, world } = gen('no-reroute');
    const forced = forceFirstStage(plot, { delay: 0, reroute: 1, abort: 0 });
    // Arrest every bound NPC and strip the city to one Location: no alternative.
    const everyBound = new Set<NpcId>();
    for (const role of plot.roles) {
      if (role.npc !== undefined) {
        everyBound.add(role.npc);
      }
    }
    everyBound.add(leaderOf(plot));
    const locIds = Object.keys(world.city.locations);
    const onlyOne = locIds[0];
    const singleLocCity: City = {
      ...world.city,
      locations: { [onlyOne]: world.city.locations[onlyOne as never] } as never,
    };
    const narrowWorld: PlotWorld = { ...world, city: singleLocCity };
    const day = executePlotDay(forced, dayOf(forced), narrowWorld, createPrng('p'), {
      disruption: { ...NO_DISRUPTION, isArrested: (n) => everyBound.has(n) },
    });
    expect(day.outcome).toBe('aborted');

    const result = considerPlotDay(day, DAY_ONE, ctx(0, false, 0.5));
    expect(result.decision?.plot.abortCause).toBe('no-reroute');
    expect(result.decision?.ended.outcome).toBe('success');
  });

  it('accrues pressure on a delay but does not abort when thresholds hold', () => {
    const { plot, world } = gen('delay-pressure');
    const forced = forceFirstStage(plot, { delay: 1, reroute: 0, abort: 0 });
    const day = executePlotDay(forced, dayOf(forced), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(day.outcome).toBe('delayed');

    // High risk tolerance so a single pressure unit stays under tolerance.
    const result = considerPlotDay(day, DAY_ONE, ctx(0, false, 1));
    expect(result.decision).toBeNull();
    expect(result.plot.abortPressure).toBe(plot.abortPressure + 1);
    expect(result.plot.status).toBe('running');
  });

  it('aborts on a threshold even when 7.2 only delayed (materiel seized in ctx)', () => {
    const { plot, world } = gen('delay-then-seize');
    const forced = forceFirstStage(plot, { delay: 1, reroute: 0, abort: 0 });
    const day = executePlotDay(forced, dayOf(forced), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(day.outcome).toBe('delayed');

    const result = considerPlotDay(day, DAY_ONE, ctx(0, true, 0.5));
    expect(result.decision?.plot.abortCause).toBe('materiel-seized');
    expect(result.decision?.ended.outcome).toBe('success');
  });

  it('leaves a clean day running when nothing is disrupted', () => {
    const { plot, world } = gen('clean-day');
    const day = executePlotDay(plot, dayOf(plot), world, createPrng('p'));
    const result = considerPlotDay(day, DAY_ONE, ctx(0, false, 0.5));
    expect(result.decision).toBeNull();
    expect(result.plot.abortPressure).toBe(plot.abortPressure);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('plot-abort — determinism', () => {
  it('considerPlotDay is a pure function of its inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (seed, suspicion, risk) => {
          const a = gen(seed);
          const forcedA = forceFirstStage(a.plot, { delay: 0, reroute: 0, abort: 1 });
          const dayA = executePlotDay(forcedA, dayOf(forcedA), a.world, createPrng('d'), {
            disruption: arrests(leaderOf(a.plot)),
          });
          const b = gen(seed);
          const forcedB = forceFirstStage(b.plot, { delay: 0, reroute: 0, abort: 1 });
          const dayB = executePlotDay(forcedB, dayOf(forcedB), b.world, createPrng('d'), {
            disruption: arrests(leaderOf(b.plot)),
          });
          const ra = considerPlotDay(dayA, DAY_ONE, ctx(suspicion, false, risk));
          const rb = considerPlotDay(dayB, DAY_ONE, ctx(suspicion, false, risk));
          expect(JSON.stringify(ra)).toEqual(JSON.stringify(rb));
        },
      ),
      { numRuns: 25 },
    );
  });
});
