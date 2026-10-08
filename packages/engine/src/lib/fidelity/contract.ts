/**
 * Ambient contract suite. Ambient-world runs this against its simulator.
 * Failures throw AmbientContractError so the suite does not depend on a test
 * runner.
 */

import assert from 'node:assert/strict';

import type { GameTime, Proposition } from '../model/core.js';
import { createPrng } from '../prng/prng.js';

import { AMBIENT_COUPLING_KINDS, type AmbientSimulator, type CityId, type SpineView } from './types.js';

export class AmbientContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbientContractError';
  }
}

export interface AmbientContract<S> {
  readonly simulator: AmbientSimulator<S>;
  readonly city: CityId;
  readonly initial: () => S;
  readonly spine: () => SpineView;
  readonly playerConcerning: (state: S) => unknown;
  readonly disclosedFacts: (state: S) => readonly Proposition[];
  readonly coarseSignature: (state: S) => unknown;
  /** Plot, suspicion, and anything else the spine owns. Unchanged by an advance. */
  readonly spineSignature?: (state: S) => unknown;
  /** Reference simulator: the coupling list contains every kind. */
  readonly requireEveryKind?: boolean;
  /** Reference simulator: full-tier detail diverges while couplings do not. */
  readonly expectCoarseDivergence?: boolean;
  /** Ambient-world: a week from a fresh world must produce at least one coupling. */
  readonly expectCouplings?: boolean;
}

const CONTRACT_DAYS = 7;

function spineOn(base: SpineView, day: number): SpineView {
  return {
    time: { day: base.time.day + day, phase: base.time.phase },
    placements: base.placements,
  };
}

function check(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AmbientContractError(`${label}: ${detail}`);
  }
}

function timeOf(spine: SpineView): GameTime {
  return spine.time;
}

/**
 * Coupling lists match across tiers, player-concerning state matches,
 * disclosed facts survive reconcile, and the spine object is not written.
 */
export function runAmbientContract<S>(spec: AmbientContract<S>): void {
  const origin = spec.spine();
  const originBefore = JSON.stringify(origin);
  let full = spec.initial();
  let coarse = spec.initial();
  const fullStart = full;
  const coarseStart = coarse;
  let sawCoupling = false;
  for (let day = 0; day < CONTRACT_DAYS; day += 1) {
    const spine = spineOn(origin, day);
    const spineBefore = JSON.stringify(spine);
    const fullRng = createPrng(`${spec.city}:full:${day}`);
    const coarseRng = createPrng(`${spec.city}:coarse:${day}`);
    const fullStep = spec.simulator.advanceFull(spec.city, full, spine, fullRng);
    const coarseStep = spec.simulator.advanceCoarse(spec.city, coarse, spine, coarseRng);
    check('spine was not written', () => {
      assert.equal(JSON.stringify(spine), spineBefore);
    });
    const at = timeOf(spine);
    const fullCouplings = spec.simulator.couplings(spec.city, fullStep.next, at);
    const coarseCouplings = spec.simulator.couplings(spec.city, coarseStep.next, at);
    check('couplings are tier-independent', () => {
      assert.deepStrictEqual(fullCouplings, coarseCouplings);
    });
    check('player-concerning state is tier-independent', () => {
      assert.deepStrictEqual(spec.playerConcerning(fullStep.next), spec.playerConcerning(coarseStep.next));
    });
    if (spec.spineSignature !== undefined) {
      const signature = spec.spineSignature;
      check('advance does not write the spine', () => {
        assert.deepStrictEqual(signature(fullStep.next), signature(fullStart));
        assert.deepStrictEqual(signature(coarseStep.next), signature(coarseStart));
      });
    }
    if (spec.requireEveryKind === true) {
      const kinds = new Set(fullCouplings.map((coupling) => coupling.kind));
      check('couplings cover every kind', () => {
        assert.deepStrictEqual([...kinds].sort(), [...AMBIENT_COUPLING_KINDS].sort());
      });
    }
    if (spec.expectCoarseDivergence === true) {
      check('full-tier detail diverges', () => {
        assert.notDeepStrictEqual(
          spec.coarseSignature(fullStep.next),
          spec.coarseSignature(coarseStep.next),
        );
      });
    }
    for (const step of [fullStep, coarseStep]) {
      for (const event of step.events) {
        check('events originate in ambient', () => {
          assert.equal(event.origin, 'ambient');
        });
      }
    }
    if (fullCouplings.length > 0) {
      sawCoupling = true;
    }
    full = fullStep.next;
    coarse = coarseStep.next;
  }
  if (spec.expectCouplings === true) {
    check('a week from a fresh world produces a coupling', () => {
      assert.ok(sawCoupling);
    });
  }
  const disclosed = spec.disclosedFacts(full);
  const reconciled = spec.simulator.reconcile(
    spec.city,
    full,
    spineOn(origin, CONTRACT_DAYS),
    disclosed,
    createPrng(`${spec.city}:reconcile`),
  );
  check('reconcile keeps disclosed facts', () => {
    const kept = spec.disclosedFacts(reconciled);
    for (const fact of disclosed) {
      assert.ok(kept.some((item) => item.id === fact.id));
    }
  });
  check('reconcile leaves the spine unwritten', () => {
    assert.equal(JSON.stringify(origin), originBefore);
  });
}
