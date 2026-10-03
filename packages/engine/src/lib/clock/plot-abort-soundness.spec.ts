/**
 * Property 27 — Abort soundness (task 7.5; design "Properties", Property 27;
 * Requirements 19.4, 38.2, 38.3, 38.4, 38.5, 38.6).
 *
 * This is the dedicated, formal property-based statement of the design's
 * Property 27. Task 7.4's `plot-abort.spec.ts` already pins the machinery with
 * worked examples; this file states the SAME invariants as fast-check
 * properties over wide input spaces, so the soundness claims hold universally
 * rather than only on the chosen examples. It deliberately does not duplicate
 * 7.4's exact test bodies — it owns a distinct filename and expresses each
 * invariant as a universally-quantified property.
 *
 * The design's Property 27, for any Plot state, doctrine and sequence of
 * disruptions, belief adoptions and leader-suspicion changes:
 *
 * 1. `abortPressure` equals the number of distinct counted disruption and
 *    belief keys (Req 38.2);
 * 2. the Plot aborts if and only if one of the Req 38.4 triggers holds —
 *    pressure strictly over tolerance, leader-suspicion at/over threshold, or
 *    materiel seized — with the documented priority (Req 38.4);
 * 3. an aborted Plot sets `status: 'aborted'`, the matching `abortCause`, emits
 *    the hidden `plot-aborted` event carrying the trigger, and produces an
 *    `ended` intent of outcome `success` (Req 38.5, 38.6);
 * 4. composing over real 7.2 output ({@link considerPlotDay} on an
 *    {@link executePlotDay} result) is sound: an `aborted` day ends the Plot, a
 *    `delayed` day accrues exactly one distinct pressure unit, a clean day
 *    leaves it running untouched (Req 38.3, 38.4);
 * 5. every function is a pure, deterministic function of its inputs — no
 *    mutation, and no draws beyond 7.2's own disruption draw (Req 19.4).
 *
 * Real {@link PlotState}s are built via the full core stream (mirroring
 * plot-abort.spec.ts's loader) so the properties run against genuine generated
 * Plots, not hand-rolled stubs.
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
import { revealTruth, type GameTime, type NpcId, type Phase } from '../model/core.js';
import { type AbortTrigger } from '../model/state.js';
import { generateCity } from '../city/generate.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';
import { generatePlot, type PlotState } from '../city/plot.js';
import { generateComms } from '../city/comms.js';

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
  leaderAbortThreshold,
  type AbortCheckContext,
  type Doctrine,
} from './plot-abort.js';

// ---------------------------------------------------------------------------
// Core pack loader (mirrors plot-abort.spec.ts)
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
const DAY_ONE: GameTime = { day: 1, phase: 0 };

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

/** A Doctrine with the given risk tolerance. */
const doc = (riskTolerance: number): Doctrine => ({ riskTolerance });

/** A context with no materiel seizure and the given suspicion / doctrine. */
function ctx(
  leaderSuspicion: number,
  materielSeized: boolean,
  riskTolerance: number,
): AbortCheckContext {
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

/** A small pool of seeds so properties run against several distinct Plots. */
const SEEDS = ['s-alpha', 's-bravo', 's-charlie', 's-delta', 's-echo'];
const seedArb = fc.constantFrom(...SEEDS);

/** A probability in `[0, 1]`, guarded against NaN / infinity. */
const unit = () =>
  fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** A phase ordinal in `0 | 1 | 2 | 3`. */
const phaseArb: fc.Arbitrary<Phase> = fc.constantFrom<Phase>(0, 1, 2, 3);

/** All five triggers, for the applyAbort property. */
const triggerArb: fc.Arbitrary<AbortTrigger> = fc.constantFrom(
  'pressure',
  'leader-suspicion',
  'materiel-seized',
  'disruption-draw',
  'no-reroute',
);

// ---------------------------------------------------------------------------
// Property 27.1 — abortPressure equals the number of distinct counted keys
// (Req 38.2)
// ---------------------------------------------------------------------------

describe('Property 27 — pressure equals distinct counted keys (Req 38.2)', () => {
  it('folding accruePressure yields initial + distinct-key count, keys unique', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 24 }),
        (seed, keys) => {
          const { plot } = gen(seed);
          let p = plot;
          for (const k of keys) {
            p = accruePressure(p, k);
          }
          const distinct = new Set(keys).size;
          expect(p.abortPressure).toBe(plot.abortPressure + distinct);
          // pressureKeys never carries a duplicate.
          expect(new Set(p.pressureKeys).size).toBe(p.pressureKeys.length);
          // Every original key is present and nothing extra was invented.
          for (const k of keys) {
            expect(p.pressureKeys).toContain(k);
          }
          expect(p.pressureKeys.length).toBe(plot.pressureKeys.length + distinct);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('interleaving belief pressure stays distinct from disruption keys', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(
          fc.record({
            kind: fc.constantFrom<'disruption' | 'belief'>('disruption', 'belief'),
            key: fc.string({ minLength: 1, maxLength: 8 }),
          }),
          { maxLength: 24 },
        ),
        (seed, ops) => {
          const { plot } = gen(seed);
          let p = plot;
          for (const op of ops) {
            p =
              op.kind === 'belief'
                ? applyBeliefPressure(p, op.key)
                : accruePressure(p, op.key);
          }
          // The canonical key a belief op counts under is namespaced.
          const canonical = ops.map((op) =>
            op.kind === 'belief' ? `belief:${op.key}` : op.key,
          );
          const distinct = new Set(canonical).size;
          expect(p.abortPressure).toBe(plot.abortPressure + distinct);
          expect(new Set(p.pressureKeys).size).toBe(p.pressureKeys.length);
          // A belief key and a disruption key of identical text never collide:
          // if both appear they contribute two distinct counted keys.
          expect(p.abortPressure).toBe(p.pressureKeys.length);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('accruePressure never mutates the input Plot and dedupes to a no-op', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.string({ minLength: 1, maxLength: 8 }),
        (seed, key) => {
          const { plot } = gen(seed);
          const before = JSON.stringify(plot);
          const once = accruePressure(plot, key);
          const twice = accruePressure(once, key);
          expect(JSON.stringify(plot)).toBe(before);
          // A repeat is a no-op returning the same reference.
          expect(twice).toBe(once);
          expect(twice.abortPressure).toBe(plot.abortPressure + 1);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27.2 — abortCheck returns a trigger IFF a condition holds (Req 38.4)
// ---------------------------------------------------------------------------

describe('Property 27 — abortCheck IFF a Req 38.4 condition holds', () => {
  it('is non-null exactly when materiel seized OR pressure>tolerance OR suspicion>=threshold', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.nat({ max: 12 }),
        unit(),
        fc.boolean(),
        unit(),
        (seed, pressure, suspicion, seized, risk) => {
          const { plot } = gen(seed);
          const loaded: PlotState = { ...plot, abortPressure: pressure };
          const context = ctx(suspicion, seized, risk);
          const trigger = abortCheck(loaded, context);

          const tol = abortTolerance(doc(risk));
          const thr = leaderAbortThreshold(doc(risk));
          const pressureHolds = pressure > tol;
          const leaderHolds = suspicion >= thr;
          const anyHolds = seized || pressureHolds || leaderHolds;

          // IFF: a trigger is returned exactly when some condition holds.
          expect(trigger !== null).toBe(anyHolds);

          // The returned trigger respects the documented priority:
          // materiel-seized > pressure > leader-suspicion.
          if (trigger !== null) {
            if (seized) {
              expect(trigger).toBe('materiel-seized');
            } else if (pressureHolds) {
              expect(trigger).toBe('pressure');
            } else {
              expect(trigger).toBe('leader-suspicion');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exactly at the pressure tolerance does not abort (strictly greater)', () => {
    fc.assert(
      fc.property(seedArb, unit(), (seed, risk) => {
        const { plot } = gen(seed);
        const tol = abortTolerance(doc(risk));
        const at: PlotState = { ...plot, abortPressure: tol };
        // No leader/materiel pressure, suspicion well under any threshold.
        expect(abortCheck(at, ctx(0, false, risk))).toBeNull();
        const over: PlotState = { ...plot, abortPressure: tol + 1 };
        expect(abortCheck(over, ctx(0, false, risk))).toBe('pressure');
      }),
      { numRuns: 50 },
    );
  });

  it('does not mutate the Plot or the context', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.nat({ max: 12 }),
        unit(),
        fc.boolean(),
        unit(),
        (seed, pressure, suspicion, seized, risk) => {
          const { plot } = gen(seed);
          const loaded: PlotState = { ...plot, abortPressure: pressure };
          const context = ctx(suspicion, seized, risk);
          const plotBefore = JSON.stringify(loaded);
          const ctxBefore = JSON.stringify(context);
          abortCheck(loaded, context);
          expect(JSON.stringify(loaded)).toBe(plotBefore);
          expect(JSON.stringify(context)).toBe(ctxBefore);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27.3 — applyAbort soundness (Req 38.5, 38.6)
// ---------------------------------------------------------------------------

describe('Property 27 — applyAbort soundness (Req 38.5, 38.6)', () => {
  it('aborts with the right cause, hidden event and success ended intent', () => {
    fc.assert(
      fc.property(
        seedArb,
        triggerArb,
        fc.nat({ max: 200 }),
        phaseArb,
        (seed, trigger, day, phase) => {
          const { plot } = gen(seed);
          const at: GameTime = { day, phase };
          const before = JSON.stringify(plot);

          const decision = applyAbort(plot, trigger, at);

          // Aborted Plot with the matching cause.
          expect(decision.plot.status).toBe('aborted');
          expect(decision.plot.abortCause).toBe(trigger);

          // Hidden plot-aborted event carrying the trigger.
          expect(decision.event.kind).toBe('plot-aborted');
          expect(decision.event.visibility).toBe('hidden');
          expect(decision.event.at).toEqual(at);
          if (decision.event.kind === 'plot-aborted') {
            expect(decision.event.trigger).toBe(trigger);
          }

          // ended intent: success, at `at`, caused by the trigger.
          expect(decision.ended.outcome).toBe(ABORT_END_OUTCOME);
          expect(decision.ended.outcome).toBe('success');
          expect(decision.ended.cause).toBe(trigger);
          expect(decision.ended.at).toEqual(at);

          // Input Plot untouched.
          expect(JSON.stringify(plot)).toBe(before);
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27.4 — considerPlotDay over real 7.2 output (Req 38.3, 38.4)
// ---------------------------------------------------------------------------

describe('Property 27 — considerPlotDay over real 7.2 output (Req 38.3, 38.4)', () => {
  it('an aborted 7.2 day ends the Plot with a disruption-draw / no-reroute cause and success', () => {
    fc.assert(
      fc.property(seedArb, unit(), unit(), (seed, suspicion, risk) => {
        const { plot, world } = gen(seed);
        const forced = forceFirstStage(plot, { delay: 0, reroute: 0, abort: 1 });
        const day = executePlotDay(forced, dayOf(forced), world, createPrng('p'), {
          disruption: arrests(leaderOf(plot)),
        });
        // The forced all-abort weighting always drives 7.2 to abort.
        expect(day.outcome).toBe('aborted');

        const result = considerPlotDay(day, DAY_ONE, ctx(suspicion, false, risk));
        expect(result.decision).not.toBeNull();
        const decision = result.decision!;
        expect(decision.plot.status).toBe('aborted');
        // 7.2's own abort maps to one of the disruption-path causes.
        expect(['disruption-draw', 'no-reroute']).toContain(decision.plot.abortCause);
        expect(decision.event.kind).toBe('plot-aborted');
        expect(decision.ended.outcome).toBe('success');
        // The distinct disruption was still counted exactly once.
        expect(result.plot.abortPressure).toBe(plot.abortPressure + 1);
      }),
      { numRuns: 50 },
    );
  });

  it('a delayed 7.2 day accrues exactly one distinct unit and aborts only on an independent threshold', () => {
    fc.assert(
      fc.property(seedArb, fc.boolean(), (seed, seized) => {
        const { plot, world } = gen(seed);
        const forced = forceFirstStage(plot, { delay: 1, reroute: 0, abort: 0 });
        const day = executePlotDay(forced, dayOf(forced), world, createPrng('p'), {
          disruption: arrests(leaderOf(plot)),
        });
        expect(day.outcome).toBe('delayed');

        // High risk tolerance keeps a single pressure unit under tolerance and
        // the leader threshold out of reach (suspicion 0), so an abort here can
        // only come from the independent materiel-seized flag.
        const result = considerPlotDay(day, DAY_ONE, ctx(0, seized, 1));

        // Pressure accrues exactly one distinct unit regardless of the outcome.
        expect(result.plot.abortPressure).toBe(plot.abortPressure + 1);

        if (seized) {
          // The independent threshold trips the abort.
          expect(result.decision).not.toBeNull();
          expect(result.decision!.plot.abortCause).toBe('materiel-seized');
          expect(result.decision!.ended.outcome).toBe('success');
        } else {
          // No threshold tripped: the Plot stays running.
          expect(result.decision).toBeNull();
          expect(result.plot.status).toBe('running');
        }
      }),
      { numRuns: 50 },
    );
  });

  it('a clean 7.2 day leaves the Plot running with unchanged pressure', () => {
    fc.assert(
      fc.property(seedArb, unit(), (seed, risk) => {
        const { plot, world } = gen(seed);
        // No disruption context: the stage executes cleanly.
        const day = executePlotDay(plot, dayOf(plot), world, createPrng('p'));
        const result = considerPlotDay(day, DAY_ONE, ctx(0, false, risk));
        expect(result.decision).toBeNull();
        expect(result.plot.abortPressure).toBe(plot.abortPressure);
        expect(result.plot.status).toBe('running');
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27.5 — purity / determinism (Req 19.4)
// ---------------------------------------------------------------------------

describe('Property 27 — purity and determinism (Req 19.4)', () => {
  it('abortCheck is a pure deterministic function of its inputs', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.nat({ max: 12 }),
        unit(),
        fc.boolean(),
        unit(),
        (seed, pressure, suspicion, seized, risk) => {
          const a = gen(seed);
          const b = gen(seed);
          const la: PlotState = { ...a.plot, abortPressure: pressure };
          const lb: PlotState = { ...b.plot, abortPressure: pressure };
          expect(abortCheck(la, ctx(suspicion, seized, risk))).toBe(
            abortCheck(lb, ctx(suspicion, seized, risk)),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it('applyAbort is deterministic in its inputs', () => {
    fc.assert(
      fc.property(seedArb, triggerArb, fc.nat({ max: 100 }), (seed, trigger, day) => {
        const a = gen(seed);
        const b = gen(seed);
        const at: GameTime = { day, phase: 0 };
        expect(JSON.stringify(applyAbort(a.plot, trigger, at))).toBe(
          JSON.stringify(applyAbort(b.plot, trigger, at)),
        );
      }),
      { numRuns: 50 },
    );
  });

  it('considerPlotDay is a pure deterministic function of its inputs', () => {
    fc.assert(
      fc.property(
        seedArb,
        unit(),
        unit(),
        fc.boolean(),
        (seed, suspicion, risk, seized) => {
          const a = gen(seed);
          const forcedA = forceFirstStage(a.plot, { delay: 1, reroute: 0, abort: 0 });
          const dayA = executePlotDay(forcedA, dayOf(forcedA), a.world, createPrng('d'), {
            disruption: arrests(leaderOf(a.plot)),
          });
          const b = gen(seed);
          const forcedB = forceFirstStage(b.plot, { delay: 1, reroute: 0, abort: 0 });
          const dayB = executePlotDay(forcedB, dayOf(forcedB), b.world, createPrng('d'), {
            disruption: arrests(leaderOf(b.plot)),
          });
          const ra = considerPlotDay(dayA, DAY_ONE, ctx(suspicion, seized, risk));
          const rb = considerPlotDay(dayB, DAY_ONE, ctx(suspicion, seized, risk));
          expect(JSON.stringify(ra)).toBe(JSON.stringify(rb));
        },
      ),
      { numRuns: 40 },
    );
  });
});
