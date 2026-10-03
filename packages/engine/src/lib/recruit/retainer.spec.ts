/**
 * Tests for retainers, pay effects and trust decay for money-motivated Assets
 * (task 18.2; Requirements 28.2, 28.4).
 *
 * These build a minimal {@link Npc}, an Asset {@link Relationship} and a
 * {@link Retainer} directly (the pure functions read only a handful of fields)
 * and check:
 *
 * - `isMoneyMotivated` is true exactly when the hidden money lever is the
 *   (possibly tied) dominant MICE lever (Req 28.4);
 * - `payEffect` advances a money-motivated Asset's retainer by a week and lifts
 *   trust, and leaves a non-money NPC's trust and retainer untouched (Req 28.2);
 * - `retainerDecay` decays an unpaid money Asset's trust deterministically once
 *   it is overdue past the grace period, raises a `retainer-due` intent at the
 *   boundary, and leaves a non-money Asset, a paid-up Asset and an in-grace
 *   Asset alone (Req 28.4).
 */

import { describe, expect, it } from 'vitest';

import { asTruth, timeToPhases, type GameTime, type NpcId, type OrgId } from '../model/core.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import {
  newRelationship,
  type AssetProfile,
  type Relationship,
  type Retainer,
} from './asset.js';
import {
  addTrust,
  isMoneyMotivated,
  nextDue,
  overduePhases,
  payEffect,
  retainerDecay,
  subjectToRetainerDecay,
  PAY_TRUST_GAIN,
  RETAINER_DECAY_PER_PHASE,
  RETAINER_GRACE_PHASES,
  RETAINER_PERIOD_PHASES,
} from './retainer.js';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeNpc(
  id: string,
  mice: MiceProfile,
): Npc {
  return {
    id: id as NpcId,
    archetype: 'core/civilian',
    role: 'civilian',
    trueAllegiance: asTruth({ org: 'org:hostile' as OrgId }),
    apparentAllegiance: 'neutral',
    mice: asTruth(mice),
    moneyNeed: asTruth(1000),
    reliability: asTruth(0.7),
    tradecraft: asTruth(0.3),
    securityConsciousness: asTruth(0.2),
    persona: {
      name: 'A B',
      given: 'A',
      family: 'B',
      library: 'core/test',
      culture: 'test',
      gender: 'female',
      voiceTraits: [],
      mannerisms: [],
      background: 'x',
      openness: 0.5,
    },
    descriptor: { summary: 's', phrases: [], pools: [] },
    schedule: { entries: [] },
    wariness: 0.3,
  } as Npc;
}

const MONEY_MICE: MiceProfile = { money: 0.9, ideology: 0.2, coercion: 0.1, ego: 0.3 };
const IDEOLOGY_MICE: MiceProfile = { money: 0.2, ideology: 0.9, coercion: 0.1, ego: 0.3 };
/** Money ties the top lever — a tie still counts as money-dominant. */
const TIE_MICE: MiceProfile = { money: 0.9, ideology: 0.9, coercion: 0.1, ego: 0.3 };

function assetProfile(): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: [] }),
    reliability: asTruth(0.7),
    turned: false,
    hostileControlled: asTruth(false),
  };
}

function assetRel(id: string, overrides: Partial<Relationship> = {}): Relationship {
  return {
    ...newRelationship(id as NpcId),
    recruited: true,
    asset: assetProfile(),
    trust: 0.5,
    ...overrides,
  };
}

const START: GameTime = { day: 0, phase: 0 };

// ---------------------------------------------------------------------------
// isMoneyMotivated (Req 28.4)
// ---------------------------------------------------------------------------

describe('isMoneyMotivated', () => {
  it('is true when money is the dominant lever (strict or tied)', () => {
    expect(isMoneyMotivated(makeNpc('npc:m', MONEY_MICE))).toBe(true);
    expect(isMoneyMotivated(makeNpc('npc:t', TIE_MICE))).toBe(true);
  });

  it('is false when another lever dominates', () => {
    expect(isMoneyMotivated(makeNpc('npc:i', IDEOLOGY_MICE))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retainer schedule helpers
// ---------------------------------------------------------------------------

describe('nextDue', () => {
  it('advances the paid-through date by exactly one retainer period', () => {
    expect(timeToPhases(nextDue(START))).toBe(timeToPhases(START) + RETAINER_PERIOD_PHASES);
  });
});

describe('overduePhases', () => {
  it('is 0 within the grace period and counts phases past it', () => {
    const retainer: Retainer = { amount: 500, paidThrough: START };
    const dueline = timeToPhases(START) + RETAINER_GRACE_PHASES;
    // Exactly at the grace deadline: not yet overdue.
    const atGrace: GameTime = { day: Math.floor(dueline / 4), phase: (dueline % 4) as GameTime['phase'] };
    expect(overduePhases(retainer, atGrace)).toBe(0);
    // Three phases past the grace deadline.
    const past = dueline + 3;
    const atPast: GameTime = { day: Math.floor(past / 4), phase: (past % 4) as GameTime['phase'] };
    expect(overduePhases(retainer, atPast)).toBe(3);
  });
});

describe('addTrust', () => {
  it('moves and clamps trust into [0, 1]', () => {
    expect(addTrust(assetRel('npc:m'), 0.2).trust).toBeCloseTo(0.7, 10);
    expect(addTrust(assetRel('npc:m', { trust: 0.95 }), 0.2).trust).toBe(1);
    expect(addTrust(assetRel('npc:m', { trust: 0.05 }), -0.2).trust).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// payEffect (Req 28.2)
// ---------------------------------------------------------------------------

describe('payEffect', () => {
  it('satisfies the retainer and raises trust for a money-motivated Asset', () => {
    const npc = makeNpc('npc:m', MONEY_MICE);
    const rel = assetRel('npc:m', { retainer: { amount: 500, paidThrough: START } });
    const paid = payEffect(npc, rel, 500, START);

    expect(paid.trust).toBeCloseTo(0.5 + PAY_TRUST_GAIN, 10);
    expect(paid.retainer?.paidThrough).toEqual(nextDue(START));
    expect(paid.retainer?.amount).toBe(500);
  });

  it('mints a retainer at the paid amount when the Asset had none', () => {
    const npc = makeNpc('npc:m', MONEY_MICE);
    const rel = assetRel('npc:m');
    const paid = payEffect(npc, rel, 750, START);

    expect(paid.retainer).toEqual({ amount: 750, paidThrough: nextDue(START) });
  });

  it('leaves a non-money-motivated NPC trust and retainer untouched', () => {
    const npc = makeNpc('npc:i', IDEOLOGY_MICE);
    const rel = assetRel('npc:i');
    const paid = payEffect(npc, rel, 500, START);

    expect(paid).toBe(rel);
    expect(paid.trust).toBe(0.5);
    expect(paid.retainer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// retainerDecay (Req 28.4)
// ---------------------------------------------------------------------------

describe('retainerDecay', () => {
  const moneyNpc = makeNpc('npc:m', MONEY_MICE);
  const ideologyNpc = makeNpc('npc:i', IDEOLOGY_MICE);

  /** A time `n` phases past the grace deadline for a retainer paid through START. */
  function overdueBy(n: number): GameTime {
    const total = timeToPhases(START) + RETAINER_GRACE_PHASES + n;
    return { day: Math.floor(total / 4), phase: (total % 4) as GameTime['phase'] };
  }

  it('decays an overdue money Asset deterministically and raises a retainer-due intent', () => {
    const rel = assetRel('npc:m', { retainer: { amount: 400, paidThrough: START } });
    const now = overdueBy(5);
    const result = retainerDecay({ 'npc:m': rel }, { 'npc:m': moneyNpc }, now);

    expect(result.relationships['npc:m'].trust).toBeCloseTo(
      0.5 - RETAINER_DECAY_PER_PHASE * 5,
      10,
    );
    expect(result.due).toEqual([{ npc: 'npc:m', amount: 400 }]);
  });

  it('is deterministic: the same inputs give the same decayed trust', () => {
    const rel = assetRel('npc:m', { retainer: { amount: 400, paidThrough: START } });
    const now = overdueBy(5);
    const a = retainerDecay({ 'npc:m': rel }, { 'npc:m': moneyNpc }, now);
    const b = retainerDecay({ 'npc:m': rel }, { 'npc:m': moneyNpc }, now);
    expect(a).toEqual(b);
  });

  it('leaves a paid-up Asset and an in-grace Asset untouched', () => {
    const paidUp = assetRel('npc:m', { retainer: { amount: 400, paidThrough: overdueBy(100) } });
    const inGrace = assetRel('npc:m', { retainer: { amount: 400, paidThrough: START } });
    const now = overdueBy(0); // exactly at the grace deadline — not overdue

    const r1 = retainerDecay({ 'npc:m': paidUp }, { 'npc:m': moneyNpc }, now);
    expect(r1.relationships['npc:m']).toBe(paidUp);
    expect(r1.due).toEqual([]);

    const r2 = retainerDecay({ 'npc:m': inGrace }, { 'npc:m': moneyNpc }, now);
    expect(r2.relationships['npc:m']).toBe(inGrace);
    expect(r2.due).toEqual([]);
  });

  it('never affects a non-money-motivated Asset, even when overdue', () => {
    const rel = assetRel('npc:i', { retainer: { amount: 400, paidThrough: START } });
    const now = overdueBy(5);
    const result = retainerDecay({ 'npc:i': rel }, { 'npc:i': ideologyNpc }, now);

    expect(result.relationships['npc:i']).toBe(rel);
    expect(result.due).toEqual([]);
    expect(subjectToRetainerDecay(rel, { 'npc:i': ideologyNpc })).toBe(false);
  });

  it('ignores a money Asset that carries no retainer', () => {
    const rel = assetRel('npc:m');
    const now = overdueBy(5);
    const result = retainerDecay({ 'npc:m': rel }, { 'npc:m': moneyNpc }, now);

    expect(result.relationships['npc:m']).toBe(rel);
    expect(result.due).toEqual([]);
  });
});
