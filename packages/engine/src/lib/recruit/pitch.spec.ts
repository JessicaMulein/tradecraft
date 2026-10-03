/**
 * Tests for the recruitment pitch primitive (task 18.1; Requirements 10.1,
 * 10.2, 10.5, 28.5).
 *
 * These build a minimal {@link Npc} and {@link Relationship} directly (the pure
 * `resolvePitch` reads only a handful of fields) and check:
 *
 * - money pitches scale by the offered amount relative to the money need
 *   (`moneyOfferScale`/`leverMatch`; Req 28.5);
 * - non-money levers ignore the offer and use the bare MICE strength;
 * - `pitchProbability` is monotonic in lever match and trust, and falls with
 *   suspicion and Exposure (Req 10.2);
 * - `resolvePitch` draws exactly one coin and is deterministic for a seed
 *   (Property 11 flavour; Req 10.2);
 * - a badly failed pitch raises more suspicion and may report (Req 10.5).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createPrng } from '../prng/prng.js';
import {
  asTruth,
  type NpcId,
  type OrgId,
} from '../model/core.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import { newRelationship, type Relationship } from './asset.js';
import {
  resolvePitch,
  pitchProbability,
  leverMatch,
  moneyOfferScale,
  PITCH_FAIL_SUSPICION,
  PITCH_BAD_SUSPICION,
  type PitchWeights,
} from './pitch.js';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const WEIGHTS: PitchWeights = { w1: 4, w2: 2, w3: 3, w4: 2 };

function makeNpc(
  overrides: {
    mice?: Partial<MiceProfile>;
    moneyNeed?: number;
    openness?: number;
  } = {},
): Npc {
  const mice: MiceProfile = {
    money: 0.5,
    ideology: 0.5,
    coercion: 0.5,
    ego: 0.5,
    ...overrides.mice,
  };
  return {
    id: 'npc:target' as NpcId,
    archetype: 'core/civilian',
    role: 'civilian',
    trueAllegiance: asTruth({ org: 'org:neutral' as OrgId }),
    apparentAllegiance: 'neutral',
    mice: asTruth(mice),
    moneyNeed: asTruth(overrides.moneyNeed ?? 1000),
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
      openness: overrides.openness ?? 0.5,
    },
    descriptor: { summary: 's', phrases: [], pools: [] },
    schedule: { entries: [] },
    wariness: 0.3,
  } as Npc;
}

function relWith(overrides: Partial<Relationship> = {}): Relationship {
  return { ...newRelationship('npc:target' as NpcId), ...overrides };
}

// ---------------------------------------------------------------------------
// Money offer scaling (Req 28.5)
// ---------------------------------------------------------------------------

describe('moneyOfferScale', () => {
  it('is 1 once the offer meets the need, and linear below it', () => {
    expect(moneyOfferScale(1000, 1000)).toBe(1);
    expect(moneyOfferScale(2000, 1000)).toBe(1); // capped at 1
    expect(moneyOfferScale(500, 1000)).toBeCloseTo(0.5, 10);
    expect(moneyOfferScale(250, 1000)).toBeCloseTo(0.25, 10);
  });

  it('is 0 for a non-positive offer or a zero need', () => {
    expect(moneyOfferScale(0, 1000)).toBe(0);
    expect(moneyOfferScale(-100, 1000)).toBe(0);
    expect(moneyOfferScale(1000, 0)).toBe(0);
  });
});

describe('leverMatch', () => {
  it('scales a money pitch by the offer relative to the money need (Req 28.5)', () => {
    const npc = makeNpc({ mice: { money: 0.8 }, moneyNeed: 1000 });
    // full offer: bare strength
    expect(leverMatch(npc, 'money', 1000)).toBeCloseTo(0.8, 10);
    // half offer: half strength
    expect(leverMatch(npc, 'money', 500)).toBeCloseTo(0.4, 10);
    // nothing offered: no match
    expect(leverMatch(npc, 'money', 0)).toBe(0);
  });

  it('ignores the offer for non-money levers (Req 10.1)', () => {
    const npc = makeNpc({ mice: { ideology: 0.9, coercion: 0.3, ego: 0.6 } });
    expect(leverMatch(npc, 'ideology', 0)).toBeCloseTo(0.9, 10);
    expect(leverMatch(npc, 'coercion', 999999)).toBeCloseTo(0.3, 10);
    expect(leverMatch(npc, 'ego', 10)).toBeCloseTo(0.6, 10);
  });

  it('scales a money match down as the offer shrinks', () => {
    const npc = makeNpc({ mice: { money: 1 }, moneyNeed: 1000 });
    const full = leverMatch(npc, 'money', 1000);
    const half = leverMatch(npc, 'money', 500);
    const quarter = leverMatch(npc, 'money', 250);
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(quarter);
  });
});

// ---------------------------------------------------------------------------
// pitchProbability monotonicity (Req 10.2)
// ---------------------------------------------------------------------------

describe('pitchProbability', () => {
  it('rises with trust and falls with suspicion and Exposure', () => {
    const npc = makeNpc();
    const base = pitchProbability(npc, relWith({ trust: 0.5 }), 'ideology', 0, WEIGHTS);
    const warmer = pitchProbability(npc, relWith({ trust: 0.9 }), 'ideology', 0, WEIGHTS);
    const suspicious = pitchProbability(
      npc,
      relWith({ trust: 0.5, suspicion: 0.6 }),
      'ideology',
      0,
      WEIGHTS,
    );
    const exposed = pitchProbability(
      npc,
      relWith({ trust: 0.5, exposure: 0.6 }),
      'ideology',
      0,
      WEIGHTS,
    );
    expect(warmer).toBeGreaterThan(base);
    expect(suspicious).toBeLessThan(base);
    expect(exposed).toBeLessThan(base);
  });

  it('rises with a bigger money offer (property)', () => {
    const npc = makeNpc({ mice: { money: 1 }, moneyNeed: 1000 });
    const rel = relWith({ trust: 0.3 });
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 501, max: 1000 }),
        (low, high) => {
          const pLow = pitchProbability(npc, rel, 'money', low, WEIGHTS);
          const pHigh = pitchProbability(npc, rel, 'money', high, WEIGHTS);
          expect(pHigh).toBeGreaterThanOrEqual(pLow);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// resolvePitch determinism and failure handling (Req 10.2, 10.5)
// ---------------------------------------------------------------------------

describe('resolvePitch', () => {
  it('is deterministic for a seed (Property 11)', () => {
    const npc = makeNpc();
    const rel = relWith({ trust: 0.5 });
    const a = resolvePitch(npc, rel, 'ideology', 0, WEIGHTS, createPrng('seed-pitch'));
    const b = resolvePitch(npc, rel, 'ideology', 0, WEIGHTS, createPrng('seed-pitch'));
    expect(a).toEqual(b);
  });

  it('draws exactly one coin', () => {
    const npc = makeNpc();
    const rng = createPrng('seed-one-coin');
    const before = rng.state();
    resolvePitch(npc, relWith(), 'ego', 0, WEIGHTS, rng);
    // Reproduce one draw from the same start and confirm the state matches.
    const probe = createPrng(before);
    probe.next();
    expect(rng.state()).toEqual(probe.state());
  });

  it('accepts a strong pitch and refuses a hopeless one', () => {
    // A fully-matched, trusted ideology pitch has p near 1 -> accepts.
    const easy = makeNpc({ mice: { ideology: 1 }, openness: 1 });
    const accepted = resolvePitch(
      easy,
      relWith({ trust: 1 }),
      'ideology',
      0,
      WEIGHTS,
      createPrng('accept'),
    );
    expect(accepted.accepted).toBe(true);
    expect(accepted.suspicionDelta).toBe(0);
    expect(accepted.reported).toBe(false);

    // A zero-match, highly suspicious, low-openness pitch has p near 0 -> refuses.
    const hard = makeNpc({ mice: { ideology: 0 }, openness: 0 });
    const refused = resolvePitch(
      hard,
      relWith({ trust: 0, suspicion: 1, exposure: 1 }),
      'ideology',
      0,
      WEIGHTS,
      createPrng('refuse'),
    );
    expect(refused.accepted).toBe(false);
    expect(refused.suspicionDelta).toBeGreaterThan(0);
  });

  it('raises more suspicion and reports when a pitch fails badly (Req 10.5)', () => {
    // p near 0 and a high draw => a bad refusal (reported). Search a seed whose
    // first draw lands high; most seeds will.
    const hard = makeNpc({ mice: { ideology: 0 }, openness: 0 });
    const rel = relWith({ trust: 0, suspicion: 1, exposure: 1 });
    let bad: ReturnType<typeof resolvePitch> | undefined;
    for (let i = 0; i < 50 && bad === undefined; i += 1) {
      const out = resolvePitch(hard, rel, 'ideology', 0, WEIGHTS, createPrng(`bad-${i}`));
      if (out.reported) {
        bad = out;
      }
    }
    expect(bad).toBeDefined();
    expect(bad?.reported).toBe(true);
    expect(bad?.suspicionDelta).toBe(PITCH_BAD_SUSPICION);
    expect(PITCH_BAD_SUSPICION).toBeGreaterThan(PITCH_FAIL_SUSPICION);
  });
});
