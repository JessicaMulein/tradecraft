/**
 * Tests for the pure turning primitive (task 18.5; Requirements 36.3, 36.4,
 * 36.5, 36.6, 36.7).
 *
 * These build a minimal {@link Npc} and {@link Relationship} directly (the pure
 * `resolveTurn` reads only a handful of fields) and check:
 *
 * - a non-hostile target refuses with no draw taken (Req 36.4), so the verdict
 *   and the PRNG state are identical whatever the ground truth (Req 36.5);
 * - a hostile target accepts under a favourable draw and refuses under an
 *   unfavourable one (Req 36.6);
 * - the leverage strength `L` is 1.0 / 0.6 / scaled-0.3 for custody / cracking /
 *   evidence;
 * - the custody-release suspicion penalty is `0.1 × phases in custody` (Req 36.7);
 * - determinism: the same inputs and PRNG state return the same verdict.
 */

import { describe, expect, it } from 'vitest';

import { asTruth, type NpcId, type OrgId } from '../model/core.js';
import type { Allegiance } from '../truth/truth.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import { createPrng } from '../prng/prng.js';
import { newRelationship, type Custody, type Relationship } from './asset.js';
import {
  CUSTODY_RELEASE_SUSPICION_PER_PHASE,
  custodyReleaseSuspicion,
  LEVERAGE_CRACKING,
  LEVERAGE_CUSTODY,
  LEVERAGE_EVIDENCE_MAX,
  leverageStrength,
  phasesInCustody,
  resolveTurn,
  trueAllegianceIsHostile,
  turnProbability,
  type TurnWeights,
} from './turn.js';

const HOSTILE = 'org:hostile' as OrgId;
const STATION = 'org:station' as OrgId;

const WEIGHTS: TurnWeights = { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 };

function mice(overrides: Partial<MiceProfile> = {}): MiceProfile {
  return { money: 0.5, ideology: 0.5, coercion: 0.5, ego: 0.5, ...overrides };
}

function makeNpc(overrides: Partial<Npc> = {}): Npc {
  return {
    id: 'npc:target' as NpcId,
    archetype: 'core/hostile-officer',
    role: 'hostile-officer',
    trueAllegiance: asTruth<Allegiance>({ org: HOSTILE }),
    apparentAllegiance: 'neutral',
    mice: asTruth(mice()),
    moneyNeed: asTruth(1000),
    reliability: asTruth(0.6),
    tradecraft: asTruth(0),
    securityConsciousness: asTruth(0),
    loyalty: asTruth(0.5),
    persona: {
      name: 'A B',
      given: 'A',
      family: 'B',
      library: 'lib',
      culture: 'c',
      gender: 'male',
      voiceTraits: [],
      mannerisms: [],
      background: 'bg',
      openness: 0.5,
    },
    descriptor: { summary: 'a figure', phrases: [], pools: [] },
    schedule: { entries: [] },
    wariness: 0,
    ...overrides,
  };
}

function rel(overrides: Partial<Relationship> = {}): Relationship {
  return { ...newRelationship('npc:target' as NpcId), ...overrides };
}

// ---------------------------------------------------------------------------
// Hostile allegiance test and the no-draw non-hostile branch (Req 36.4, 36.5)
// ---------------------------------------------------------------------------

describe('trueAllegianceIsHostile', () => {
  it('is true only when the true allegiance is the hostile org', () => {
    expect(trueAllegianceIsHostile(makeNpc(), HOSTILE)).toBe(true);
    const station = makeNpc({ trueAllegiance: asTruth<Allegiance>({ org: STATION }) });
    expect(trueAllegianceIsHostile(station, HOSTILE)).toBe(false);
  });
});

describe('resolveTurn — non-hostile target (Req 36.4, 36.5)', () => {
  it('refuses a non-hostile target without taking a draw', () => {
    const npc = makeNpc();
    // A draw of 0 would make a hostile target accept; a non-hostile target must
    // still refuse, and must not consume the draw.
    const rng = createPrng('no-draw');
    const before = rng.state();
    const out = resolveTurn(
      npc,
      rel({ trust: 1 }),
      'money',
      1000,
      'custody',
      3,
      1,
      3,
      WEIGHTS,
      /* targetIsHostile */ false,
      rng,
    );
    expect(out).toBe('refused');
    // The PRNG was not advanced (no coin drawn), so a refusal leaks nothing.
    expect(rng.state()).toEqual(before);
  });

  it('gives the identical verdict and PRNG state whatever the (non-hostile) ground truth', () => {
    const innocent = makeNpc({ trueAllegiance: asTruth<Allegiance>({ org: STATION }) });
    const rngA = createPrng('same');
    const rngB = createPrng('same');
    const a = resolveTurn(innocent, rel(), 'money', 0, 'custody', 0, 1, 3, WEIGHTS, false, rngA);
    const b = resolveTurn(innocent, rel(), 'ego', 500, 'evidence', 2, 1, 3, WEIGHTS, false, rngB);
    expect(a).toBe('refused');
    expect(b).toBe('refused');
    expect(rngA.state()).toEqual(rngB.state());
  });
});

// ---------------------------------------------------------------------------
// Hostile target — accept / refuse / reported (Req 36.6)
// ---------------------------------------------------------------------------

/** A Prng whose `next()` always returns the given constant (coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

describe('resolveTurn — hostile target (Req 36.6)', () => {
  it('accepts under a favourable draw', () => {
    const npc = makeNpc();
    const out = resolveTurn(
      npc,
      rel({ trust: 1 }),
      'money',
      1000,
      'custody',
      3,
      0,
      3,
      WEIGHTS,
      true,
      fixedPrng(0),
    );
    expect(out).toBe('accepted');
  });

  it('refuses under an unfavourable draw', () => {
    const npc = makeNpc();
    const out = resolveTurn(
      npc,
      rel(),
      'coercion',
      0,
      'evidence',
      0,
      1,
      3,
      WEIGHTS,
      true,
      fixedPrng(0.999999),
    );
    expect(out === 'refused' || out === 'refused-reported').toBe(true);
  });

  it('reports a failed turn when loyalty is high and leverage weak', () => {
    const npc = makeNpc({ loyalty: asTruth(1) });
    // custody-coin fails (draw high), then the report coin (second draw) is
    // compared against loyalty × (1 − L). With evidence leverage and low
    // evidence, L ≈ 0, so the report probability ≈ 1; a 0 draw reports.
    let call = 0;
    const base = createPrng('report');
    const rng = {
      ...base,
      next: () => {
        call += 1;
        return call === 1 ? 0.999999 : 0; // fail success, then report
      },
    };
    const out = resolveTurn(npc, rel(), 'ego', 0, 'evidence', 0, 1, 3, WEIGHTS, true, rng);
    expect(out).toBe('refused-reported');
  });
});

// ---------------------------------------------------------------------------
// Leverage strength L (design: 1.0 / 0.6 / 0.3·min(1, evidence/threshold))
// ---------------------------------------------------------------------------

describe('leverageStrength', () => {
  it('is 1.0 for custody and 0.6 for cracking', () => {
    expect(leverageStrength('custody', 0, 3)).toBe(LEVERAGE_CUSTODY);
    expect(leverageStrength('cracking', 0, 3)).toBe(LEVERAGE_CRACKING);
  });

  it('scales evidence by min(1, evidence / arrestThreshold) up to 0.3', () => {
    expect(leverageStrength('evidence', 0, 3)).toBe(0);
    expect(leverageStrength('evidence', 3, 3)).toBeCloseTo(LEVERAGE_EVIDENCE_MAX);
    expect(leverageStrength('evidence', 6, 3)).toBeCloseTo(LEVERAGE_EVIDENCE_MAX);
    expect(leverageStrength('evidence', 1, 2)).toBeCloseTo(LEVERAGE_EVIDENCE_MAX * 0.5);
  });

  it('rises with the leverage strength in the success probability', () => {
    const npc = makeNpc();
    const custody = turnProbability(npc, rel(), 'money', 1000, 'custody', 0, 0.5, 3, WEIGHTS);
    const cracking = turnProbability(npc, rel(), 'money', 1000, 'cracking', 0, 0.5, 3, WEIGHTS);
    expect(custody).toBeGreaterThan(cracking);
  });
});

// ---------------------------------------------------------------------------
// Custody-release suspicion penalty (Req 36.7)
// ---------------------------------------------------------------------------

describe('custodyReleaseSuspicion (Req 36.7)', () => {
  it('is 0.1 × phases in custody', () => {
    const custody: Custody = { by: 'station', since: { day: 1, phase: 0 } };
    // 1 day + 2 phases later = 6 phases (4 phases/day).
    expect(phasesInCustody(custody, { day: 2, phase: 2 })).toBe(6);
    expect(custodyReleaseSuspicion(custody, { day: 2, phase: 2 })).toBeCloseTo(
      CUSTODY_RELEASE_SUSPICION_PER_PHASE * 6,
    );
  });

  it('floors a release recorded before the hold began at zero', () => {
    const custody: Custody = { by: 'station', since: { day: 5, phase: 0 } };
    expect(phasesInCustody(custody, { day: 1, phase: 0 })).toBe(0);
    expect(custodyReleaseSuspicion(custody, { day: 1, phase: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('resolveTurn — determinism', () => {
  it('returns the same verdict and PRNG state for the same inputs', () => {
    const npc = makeNpc();
    const rngA = createPrng('det');
    const rngB = createPrng('det');
    const a = resolveTurn(npc, rel({ trust: 0.5 }), 'money', 800, 'cracking', 1, 0.5, 3, WEIGHTS, true, rngA);
    const b = resolveTurn(npc, rel({ trust: 0.5 }), 'money', 800, 'cracking', 1, 0.5, 3, WEIGHTS, true, rngB);
    expect(a).toBe(b);
    expect(rngA.state()).toEqual(rngB.state());
  });
});
