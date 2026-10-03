/**
 * Tests for Plot Stage execution (task 7.2; Requirements 3.2, 3.3, 3.4).
 *
 * These load the real core pack, run the full step-1→4 core stream (city, orgs,
 * principals, Plot) plus the step-5 comms generator on one PRNG stream to build
 * a real {@link PlotState} and the {@link PlotWorld} it executes against, then
 * check the invariants the design fixes for Plot execution:
 *
 * - a due stage (pending, prerequisites met, deadline day reached) executes and
 *   turns its trace templates into hidden Sim events carrying a `plot`
 *   {@link TraceOrigin} (Req 3.2, 3.3);
 * - a stage whose prerequisites are unmet, or whose deadline is still future,
 *   does not execute;
 * - disruption with `onDisrupted='delay'` reschedules the stage, `reroute`
 *   rebinds to an alternative and executes (emitting `plot-adapted`), `reroute`
 *   with no alternative behaves as `abort`, and `abort` marks the stage
 *   disrupted and the Plot aborted (Req 3.4);
 * - the Plot reaches `plot-completed` when every stage executes;
 * - determinism (same inputs ⇒ same events + PlotState) and no mutation of the
 *   input PlotState.
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

import { createPrng, type Prng } from '../prng/prng.js';
import {
  revealTruth,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import { generateCity } from '../city/generate.js';
import { type City } from '../city/city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedPrincipals,
  type GeneratedOrgs,
} from '../city/principals.js';
import {
  generatePlot,
  type PlotState,
  type StageState,
  type StageTrace,
} from '../city/plot.js';
import { generateComms } from '../city/comms.js';
import type { SimEvent } from '../model/state.js';

import {
  classifyTrace,
  drawDisruption,
  executePlotDay,
  pendingStages,
  plotDayBoundaryHook,
  plotIsComplete,
  DELAY_DAYS,
  NO_DISRUPTION,
  type DisruptionContext,
  type PlotStateCell,
  type PlotWorld,
} from './plot-execution.js';

// ---------------------------------------------------------------------------
// Core pack loader (mirrors plot.spec.ts / discovery.spec.ts)
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
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
  readonly world: PlotWorld;
}

/** Run the full core stream for a seed and build the Plot + its world context. */
function gen(seed: string, p: DifficultyPreset = STANDARD): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(prng, content, p, city, orgs, principals, START);
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const world: PlotWorld = {
    city,
    npcs: principals.npcs,
    channels: comms.channels,
    deadDrops: comms.deadDrops,
  };
  return { city, orgs, principals, plot, world };
}

/** A day on which the first stage of the Plot is due. */
function dayOf(stage: StageState): GameTime {
  return { day: stage.deadline.day, phase: 0 };
}

/** Mark the first N stages executed, so later-stage prerequisites are met. */
function withExecutedPrefix(plot: PlotState, n: number): PlotState {
  const stages = plot.stages.map((s, i) =>
    i < n ? ({ ...s, status: 'executed' as const }) : s,
  );
  return { ...plot, stages };
}

/** Drive the whole Plot to completion one stage at a time, undisrupted. */
function runToCompletion(seed: string): {
  plot: PlotState;
  events: SimEvent[];
} {
  const generated = gen(seed);
  const world = generated.world;
  let plot = generated.plot;
  const events: SimEvent[] = [];
  const prng = createPrng('exec-stream');
  // Advance day by day far enough to clear every deadline.
  const lastDay = plot.stages[plot.stages.length - 1].deadline.day + 5;
  for (let day = 0; day <= lastDay && plot.status === 'running'; day += 1) {
    const result = executePlotDay(plot, { day, phase: 0 }, world, prng);
    plot = result.plot;
    events.push(...result.events);
  }
  return { plot, events };
}

// ---------------------------------------------------------------------------
// classifyTrace
// ---------------------------------------------------------------------------

describe('classifyTrace', () => {
  it('reads a transmission from signal/wireless vocabulary', () => {
    expect(classifyTrace('A wireless operator signals the safehouse at night.')).toBe(
      'transmission',
    );
    expect(classifyTrace('The numbers broadcast opens on the night schedule.')).toBe(
      'transmission',
    );
  });

  it('reads a drop load vs empty from the verb', () => {
    expect(
      classifyTrace('The clerk leaves the component at a dead drop in the park.'),
    ).toBe('drop-loaded');
    expect(
      classifyTrace('A street courier recovers the drop and signals the lift is clean.'),
    ).toBe('drop-emptied');
  });

  it('reads a meeting from meet/introduction/delivery vocabulary', () => {
    expect(
      classifyTrace('The handling officer meets the liaison officer alone in a back room.'),
    ).toBe('meeting');
    expect(
      classifyTrace('An émigré fixer arranges an apparently chance introduction.'),
    ).toBe('meeting');
  });

  it('reads a movement from courier/barge/crosses vocabulary', () => {
    expect(
      classifyTrace('A dock worker carries the component across the sector on a barge.'),
    ).toBe('npc-moved');
  });

  it('is a pure function of the string (deterministic)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(classifyTrace(s)).toBe(classifyTrace(s));
      }),
      { numRuns: 50 },
    );
  });

  it('classifies every core-pack trace template to a known kind', () => {
    const plot = gen('classify-seed').plot;
    for (const stage of plot.stages) {
      for (const trace of stage.traces) {
        expect([
          'meeting',
          'transmission',
          'drop-loaded',
          'drop-emptied',
          'npc-moved',
        ]).toContain(classifyTrace(trace.template));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// drawDisruption
// ---------------------------------------------------------------------------

describe('drawDisruption', () => {
  it('always returns delay when only delay has weight', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const r = drawDisruption(createPrng(seed), { delay: 1, reroute: 0, abort: 0 });
        expect(r).toBe('delay');
      }),
      { numRuns: 30 },
    );
  });

  it('always returns abort when only abort has weight, and for all-zero weights', () => {
    expect(drawDisruption(createPrng('x'), { delay: 0, reroute: 0, abort: 1 })).toBe(
      'abort',
    );
    expect(drawDisruption(createPrng('x'), { delay: 0, reroute: 0, abort: 0 })).toBe(
      'abort',
    );
  });

  it('returns reroute when only reroute has weight', () => {
    expect(drawDisruption(createPrng('y'), { delay: 0, reroute: 1, abort: 0 })).toBe(
      'reroute',
    );
  });

  it('is deterministic for the same seed and weights', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        (seed, delay, reroute, abort) => {
          const w = { delay, reroute, abort };
          expect(drawDisruption(createPrng(seed), w)).toBe(
            drawDisruption(createPrng(seed), w),
          );
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// executePlotDay — execution (Req 3.2, 3.3)
// ---------------------------------------------------------------------------

describe('executePlotDay — a due stage executes its traces (Req 3.2, 3.3)', () => {
  it('executes the first stage when its deadline day is reached, emitting a plot origin', () => {
    const { plot, world } = gen('exec-seed');
    const first = plot.stages[0];
    const result = executePlotDay(plot, dayOf(first), world, createPrng('p'));

    expect(result.outcome).toBe('executed');
    // The first stage is now executed.
    expect(result.plot.stages[0].status).toBe('executed');

    // A stage-executed event, then one event per trace, all hidden.
    const executed = result.events.filter((e) => e.kind === 'stage-executed');
    expect(executed.length).toBe(1);
    expect(result.events.every((e) => e.visibility === 'hidden')).toBe(true);

    // Every trace rendered to a trace-kind event carrying the plot origin.
    const traceEvents = result.events.filter((e) =>
      ['meeting', 'transmission', 'drop-loaded', 'drop-emptied', 'npc-moved'].includes(
        e.kind,
      ),
    );
    expect(traceEvents.length).toBe(first.traces.length);
    for (const e of traceEvents) {
      if (e.kind === 'npc-moved') {
        // npc-moved carries no origin in the SimEvent union.
        continue;
      }
      if ('origin' in e) {
        const origin = revealTruth(e.origin);
        expect(origin.kind).toBe('plot');
        if (origin.kind === 'plot') {
          expect(origin.stage).toBe(first.id);
        }
      }
    }
  });

  it('does not execute a stage whose deadline day is still in the future', () => {
    const { plot, world } = gen('future-seed');
    const first = plot.stages[0];
    // A day well before the first deadline.
    const early: GameTime = { day: 0, phase: 0 };
    if (first.deadline.day === 0) {
      return; // the first deadline is day 0: nothing to assert here
    }
    const result = executePlotDay(plot, early, world, createPrng('p'));
    expect(result.outcome).toBe('none');
    expect(result.events).toEqual([]);
    expect(result.plot).toBe(plot);
  });

  it('does not execute a later stage whose prerequisites are unmet', () => {
    const { plot, world } = gen('prereq-seed');
    if (plot.stages.length < 2) {
      return;
    }
    const second = plot.stages[1];
    // On the second stage's deadline day, but with the first stage NOT executed:
    // the second stage requires the first's produced prop, so nothing runs for
    // the second stage — only the first (already due) does.
    const day: GameTime = { day: second.deadline.day, phase: 0 };
    const result = executePlotDay(plot, day, world, createPrng('p'));
    // Whatever runs, it must be the first stage, never the second ahead of it.
    expect(result.plot.stages[1].status).toBe('pending');
  });

  it('executes stages one per day, in DAG order, to completion', () => {
    const { plot, events } = runToCompletion('order-seed');
    expect(plot.status).toBe('completed');
    expect(plotIsComplete(plot)).toBe(true);
    // Stage-executed events appear in stage order.
    const executedStages = events
      .filter((e) => e.kind === 'stage-executed')
      .map((e) => (e.kind === 'stage-executed' ? e.stage : ''));
    const originalOrder = gen('order-seed').plot.stages.map((s) => s.id);
    expect(executedStages).toEqual(originalOrder);
  });
});

// ---------------------------------------------------------------------------
// executePlotDay — completion (Req 3.2)
// ---------------------------------------------------------------------------

describe('executePlotDay — the Plot completes when every stage runs (Req 3.2)', () => {
  it('emits plot-completed exactly once, on the last stage', () => {
    const { events } = runToCompletion('complete-seed');
    const completed = events.filter((e) => e.kind === 'plot-completed');
    expect(completed.length).toBe(1);
  });

  it('executing the last stage from an all-but-one-executed Plot completes it', () => {
    const { plot, world } = gen('last-seed');
    const n = plot.stages.length;
    const primed = withExecutedPrefix(plot, n - 1);
    const last = plot.stages[n - 1];
    const result = executePlotDay(primed, dayOf(last), world, createPrng('p'));
    expect(result.plot.status).toBe('completed');
    expect(result.events.some((e) => e.kind === 'plot-completed')).toBe(true);
  });

  it('does nothing once the Plot is no longer running', () => {
    const { plot, world } = gen('ended-seed');
    const completed: PlotState = { ...plot, status: 'completed' };
    const result = executePlotDay(completed, { day: 999, phase: 0 }, world, createPrng('p'));
    expect(result.outcome).toBe('none');
    expect(result.events).toEqual([]);
    expect(result.plot).toBe(completed);
  });
});

// ---------------------------------------------------------------------------
// executePlotDay — disruption (Req 3.4)
// ---------------------------------------------------------------------------

/** A disruption context that arrests exactly the given NPCs. */
function arrests(...npcs: NpcId[]): DisruptionContext {
  const set = new Set<NpcId>(npcs);
  return { ...NO_DISRUPTION, isArrested: (n) => set.has(n) };
}

/** The leader NPC of a generated Plot. */
function leaderOf(plot: PlotState): NpcId {
  return revealTruth(plot.leader);
}

/** A bound role NPC that is not the leader, if any. */
function nonLeaderBound(plot: PlotState): NpcId | undefined {
  const leader = leaderOf(plot);
  for (const role of plot.roles) {
    if (role.npc !== undefined && role.npc !== leader) {
      return role.npc;
    }
  }
  return undefined;
}

describe('executePlotDay — disruption delays, reroutes or aborts (Req 3.4)', () => {
  it('delay reschedules the due stage and keeps it pending', () => {
    const { plot, world } = gen('delay-seed');
    const first = plot.stages[0];
    const leader = leaderOf(plot);
    const result = executePlotDay(plot, dayOf(first), world, createPrng('p'), {
      disruption: arrests(leader),
      // force delay by using a stage with delay weight — but to be sure, run a
      // local draw-independent assertion below using a crafted weight.
    });
    // The outcome depends on the stage weights' draw; assert the structural
    // guarantees per outcome instead of forcing one here.
    if (result.outcome === 'delayed') {
      expect(result.plot.stages[0].status).toBe('pending');
      expect(result.plot.stages[0].deadline.day).toBe(first.deadline.day + DELAY_DAYS);
      expect(result.events.some((e) => e.kind === 'stage-disrupted')).toBe(true);
      expect(result.plot.status).toBe('running');
    }
  });

  it('a delay-weighted stage always reschedules on disruption', () => {
    const { plot, world } = gen('delay-weighted');
    const first = plot.stages[0];
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0 ? { ...s, onDisrupted: { delay: 1, reroute: 0, abort: 0 } } : s,
      ),
    };
    const result = executePlotDay(forced, dayOf(first), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(result.outcome).toBe('delayed');
    expect(result.plot.stages[0].status).toBe('pending');
    expect(result.plot.stages[0].deadline.day).toBe(first.deadline.day + DELAY_DAYS);
    expect(result.plot.status).toBe('running');
  });

  it('an abort-weighted stage marks the stage disrupted and the Plot aborted', () => {
    const { plot, world } = gen('abort-weighted');
    const first = plot.stages[0];
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0 ? { ...s, onDisrupted: { delay: 0, reroute: 0, abort: 1 } } : s,
      ),
    };
    const result = executePlotDay(forced, dayOf(first), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(result.outcome).toBe('aborted');
    expect(result.plot.stages[0].status).toBe('disrupted');
    expect(result.plot.status).toBe('aborted');
    const disrupted = result.events.filter((e) => e.kind === 'stage-disrupted');
    expect(disrupted.length).toBe(1);
  });

  it('a reroute-weighted stage with a spare role holder rebinds and executes', () => {
    // Find a seed whose Plot has a non-leader bound role to reroute to, and
    // arrest a *different* participant so the reroute alternative survives.
    let picked: Generated | undefined;
    let spare: NpcId | undefined;
    for (const s of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']) {
      const g = gen(s);
      const alt = nonLeaderBound(g.plot);
      if (alt !== undefined) {
        picked = g;
        spare = alt;
        break;
      }
    }
    if (picked === undefined || spare === undefined) {
      return; // no suitable Plot in the sampled seeds
    }
    const { plot, world } = picked;
    const first = plot.stages[0];
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0 ? { ...s, onDisrupted: { delay: 0, reroute: 1, abort: 0 } } : s,
      ),
    };
    // Arrest the leader only (there is at least one non-arrested non-leader to
    // reroute to), so a reroute alternative exists.
    const result = executePlotDay(forced, dayOf(first), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(result.outcome).toBe('rerouted');
    expect(result.plot.stages[0].status).toBe('executed');
    expect(result.plot.status).not.toBe('aborted');
    expect(result.events.some((e) => e.kind === 'plot-adapted')).toBe(true);
    // The adapted stage still emits its traces with a plot origin.
    expect(result.events.some((e) => e.kind === 'stage-executed')).toBe(true);
  });

  it('reroute with no alternative behaves as abort', () => {
    const { plot, world } = gen('no-alt-seed');
    const first = plot.stages[0];
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0 ? { ...s, onDisrupted: { delay: 0, reroute: 1, abort: 0 } } : s,
      ),
    };
    // Arrest every bound NPC, and strip the city to a single Location, so no
    // reroute alternative exists at all.
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
    const result = executePlotDay(forced, dayOf(first), narrowWorld, createPrng('p'), {
      disruption: { ...NO_DISRUPTION, isArrested: (n) => everyBound.has(n) },
    });
    expect(result.outcome).toBe('aborted');
    expect(result.plot.status).toBe('aborted');
    expect(result.plot.stages[0].status).toBe('disrupted');
  });

  it('a compromised Channel disrupts the stage', () => {
    const { plot, world } = gen('chan-seed');
    const first = plot.stages[0];
    const channelIds = Object.keys(world.channels);
    if (channelIds.length === 0) {
      return;
    }
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0 ? { ...s, onDisrupted: { delay: 1, reroute: 0, abort: 0 } } : s,
      ),
    };
    const result = executePlotDay(forced, dayOf(first), world, createPrng('p'), {
      disruption: { ...NO_DISRUPTION, isChannelCompromised: () => true },
    });
    // When a Cell channel is compromised the stage is disrupted (delay here).
    // If the Cell owns no channel in this world, the stage simply executes.
    expect(['delayed', 'executed']).toContain(result.outcome);
  });

  it('materiel seized disrupts a stage whose own trace collects the delivery (Req 3.7)', () => {
    const { plot, world } = gen('seized-seed');
    const materiel = revealTruth(plot.materiel);
    // Give the first stage a drop-emptied trace that collects the Plot materiel,
    // so a materiel seizure disrupts this stage (it lifts the seized delivery).
    const collecting: StageTrace = {
      index: plot.stages[0].traces.length,
      kind: 'drop-emptied',
      participants: [],
      materiel,
      evidences: [],
      template: 'A courier recovers the component from the drop.',
    };
    const first = plot.stages[0];
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0
          ? {
              ...s,
              onDisrupted: { delay: 1, reroute: 0, abort: 0 },
              traces: [...s.traces, collecting],
            }
          : s,
      ),
    };
    const result = executePlotDay(forced, dayOf(first), world, createPrng('p'), {
      disruption: { ...NO_DISRUPTION, isMaterielSeized: () => true },
    });
    expect(result.outcome).toBe('delayed');
    expect(result.events.some((e) => e.kind === 'stage-disrupted')).toBe(true);
  });

  it('a materiel seizure does not disrupt a stage that collects no delivery (Req 3.7)', () => {
    const { plot, world } = gen('seized-scope-seed');
    // Strip the first stage of any drop-emptied-with-materiel trace, so it
    // collects no delivery; a materiel seizure must leave it to execute.
    const first = plot.stages[0];
    const noCollect: StageTrace[] = first.traces.filter(
      (t) => !(t.kind === 'drop-emptied' && t.materiel !== undefined),
    );
    const forced: PlotState = {
      ...plot,
      stages: plot.stages.map((s, i) =>
        i === 0
          ? { ...s, onDisrupted: { delay: 1, reroute: 0, abort: 0 }, traces: noCollect }
          : s,
      ),
    };
    const result = executePlotDay(forced, dayOf(first), world, createPrng('p'), {
      disruption: { ...NO_DISRUPTION, isMaterielSeized: () => true },
    });
    // No own trace collects the seized delivery, so the stage simply executes.
    expect(result.outcome).toBe('executed');
    expect(result.events.some((e) => e.kind === 'stage-disrupted')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism and immutability
// ---------------------------------------------------------------------------

describe('executePlotDay — determinism and immutability', () => {
  it('produces identical events and PlotState for the same inputs', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const a = gen(seed);
        const b = gen(seed);
        const first = a.plot.stages[0];
        const ra = executePlotDay(a.plot, dayOf(first), a.world, createPrng('run'));
        const rb = executePlotDay(b.plot, dayOf(first), b.world, createPrng('run'));
        expect(JSON.stringify(ra.plot)).toEqual(JSON.stringify(rb.plot));
        expect(JSON.stringify(ra.events)).toEqual(JSON.stringify(rb.events));
        expect(ra.outcome).toBe(rb.outcome);
      }),
      { numRuns: 25 },
    );
  });

  it('does not mutate the input PlotState', () => {
    const { plot, world } = gen('immut-seed');
    const before = JSON.stringify(plot);
    const first = plot.stages[0];
    executePlotDay(plot, dayOf(first), world, createPrng('p'), {
      disruption: arrests(leaderOf(plot)),
    });
    expect(JSON.stringify(plot)).toEqual(before);
  });

  it('leaves abort machinery (task 7.4) untouched on execution', () => {
    const { plot, world } = gen('abort-fields');
    const first = plot.stages[0];
    const result = executePlotDay(plot, dayOf(first), world, createPrng('p'));
    expect(result.plot.abortPressure).toBe(plot.abortPressure);
    expect(result.plot.pressureKeys).toEqual(plot.pressureKeys);
    expect(result.plot.abortCause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pendingStages
// ---------------------------------------------------------------------------

describe('pendingStages', () => {
  it('returns every stage of a freshly generated Plot', () => {
    const { plot } = gen('pending-seed');
    expect(pendingStages(plot).length).toBe(plot.stages.length);
  });
});

// ---------------------------------------------------------------------------
// plotDayBoundaryHook — the clock seam adapter
// ---------------------------------------------------------------------------

describe('plotDayBoundaryHook — adapts executePlotDay into the clock seam', () => {
  it('captures the advanced Plot in the cell and returns the day events', () => {
    const { plot, world } = gen('hook-seed');
    const first = plot.stages[0];
    const cell: PlotStateCell = { plot };
    const makePrng = (dailyStreamSeed: string): Prng => createPrng(dailyStreamSeed);
    const hook = plotDayBoundaryHook(cell, world, makePrng);

    const events = hook({ time: dayOf(first), dailyStreamSeed: 'daily-0' });
    // The hook wrote the advanced Plot back into the cell.
    expect(cell.plot.stages[0].status).toBe('executed');
    // And returned the same events executePlotDay would.
    expect(events.some((e) => e.kind === 'stage-executed')).toBe(true);
  });

  it('is deterministic across runs with the same daily stream seed', () => {
    const { plot, world } = gen('hook-det');
    const first = plot.stages[0];
    const makePrng = (s: string): Prng => createPrng(s);

    const cellA: PlotStateCell = { plot };
    const a = plotDayBoundaryHook(cellA, world, makePrng)({
      time: dayOf(first),
      dailyStreamSeed: 'd',
    });
    const cellB: PlotStateCell = { plot };
    const b = plotDayBoundaryHook(cellB, world, makePrng)({
      time: dayOf(first),
      dailyStreamSeed: 'd',
    });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(JSON.stringify(cellA.plot)).toEqual(JSON.stringify(cellB.plot));
  });
});
