/**
 * Tests for the cover-state pressure primitive (task 18.3; Requirements 6.3,
 * 6.4).
 *
 * These build a minimal {@link Npc} and {@link Relationship} directly (the pure
 * `pressureCheck` reads only a handful of fields) and check:
 *
 * - the cover degrades one rung along `intact → strained → cracking → blown`
 *   under a successful check, and a decisive hit can jump two rungs (Req 6.3);
 * - a failed check leaves the cover unchanged, and `blown` cannot degrade more;
 * - `pressureProbability` is monotonic in evidence and trust, and falls with
 *   the NPC's composure (resilience) and wariness;
 * - `pressureCheck` draws exactly one coin and is deterministic for a seed
 *   (Property 11 flavour; Req 6.4);
 * - `agendaShiftFor` classifies the Agenda change a broken cover produces —
 *   partial admission, bargaining or flight (Req 6.4).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createPrng } from '../prng/prng.js';
import { asTruth, type NpcId, type OrgId } from '../model/core.js';
import type { MiceProfile, Npc } from '../city/npc.js';
import { newRelationship, type CoverState, type Relationship } from './asset.js';
import {
  advanceCover,
  agendaShiftFor,
  coverBroke,
  coverIndex,
  evidenceWeight,
  npcResilience,
  pressureCheck,
  pressureProbability,
} from './pressure.js';
import type { Proposition } from '../model/core.js';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeNpc(
  overrides: {
    tradecraft?: number;
    securityConsciousness?: number;
    wariness?: number;
  } = {},
): Npc {
  const mice: MiceProfile = { money: 0.5, ideology: 0.5, coercion: 0.5, ego: 0.5 };
  return {
    id: 'npc:target' as NpcId,
    archetype: 'core/civilian',
    role: 'civilian',
    trueAllegiance: asTruth({ org: 'org:hostile' as OrgId }),
    apparentAllegiance: 'neutral',
    mice: asTruth(mice),
    moneyNeed: asTruth(1000),
    reliability: asTruth(0.7),
    tradecraft: asTruth(overrides.tradecraft ?? 0.3),
    securityConsciousness: asTruth(overrides.securityConsciousness ?? 0.2),
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
    wariness: overrides.wariness ?? 0.3,
  } as Npc;
}

function relWith(overrides: Partial<Relationship> = {}): Relationship {
  return { ...newRelationship('npc:target' as NpcId), ...overrides };
}

/** `n` contradicting-Claim Propositions (shape only; count is what matters). */
function evidence(n: number): Proposition[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `prop:e${i}`,
    predicate: 'core/WORKS_FOR',
    subject: 'npc:target' as NpcId,
    object: 'org:hostile' as OrgId,
  })) as unknown as Proposition[];
}

/** An NPC whose composure is low (easy to crack). */
const SOFT = makeNpc({ tradecraft: 0, securityConsciousness: 0, wariness: 0 });
/** An NPC whose composure is high (hard to crack). */
const HARD = makeNpc({ tradecraft: 1, securityConsciousness: 1, wariness: 1 });

// ---------------------------------------------------------------------------
// evidenceWeight and npcResilience
// ---------------------------------------------------------------------------

describe('evidenceWeight', () => {
  it('is 0 for no Claims and saturates toward 1 as Claims pile up', () => {
    expect(evidenceWeight(0)).toBe(0);
    expect(evidenceWeight(1)).toBeCloseTo(0.5, 10);
    expect(evidenceWeight(3)).toBeCloseTo(0.75, 10);
    expect(evidenceWeight(1)).toBeLessThan(evidenceWeight(2));
    expect(evidenceWeight(2)).toBeLessThan(evidenceWeight(3));
  });
});

describe('npcResilience', () => {
  it('averages the hidden tradecraft and security-consciousness ground truth', () => {
    expect(npcResilience(makeNpc({ tradecraft: 0.4, securityConsciousness: 0.6 }))).toBeCloseTo(
      0.5,
      10,
    );
    expect(npcResilience(SOFT)).toBe(0);
    expect(npcResilience(HARD)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cover-state ladder helpers
// ---------------------------------------------------------------------------

describe('advanceCover', () => {
  it('steps along intact → strained → cracking → blown and clamps at blown', () => {
    expect(advanceCover('intact', 1)).toBe('strained');
    expect(advanceCover('strained', 1)).toBe('cracking');
    expect(advanceCover('cracking', 1)).toBe('blown');
    expect(advanceCover('intact', 2)).toBe('cracking');
    expect(advanceCover('cracking', 2)).toBe('blown'); // clamp
    expect(advanceCover('blown', 1)).toBe('blown'); // clamp
    expect(advanceCover('intact', 0)).toBe('intact');
  });
});

// ---------------------------------------------------------------------------
// pressureProbability monotonicity
// ---------------------------------------------------------------------------

describe('pressureProbability', () => {
  it('rises with evidence and trust, falls with resilience and wariness', () => {
    const base = pressureProbability(makeNpc(), relWith({ trust: 0.3 }), 1);
    const moreEvidence = pressureProbability(makeNpc(), relWith({ trust: 0.3 }), 3);
    const moreTrust = pressureProbability(makeNpc(), relWith({ trust: 0.9 }), 1);
    const tougher = pressureProbability(HARD, relWith({ trust: 0.3 }), 1);
    expect(moreEvidence).toBeGreaterThan(base);
    expect(moreTrust).toBeGreaterThan(base);
    expect(tougher).toBeLessThan(base);
  });

  it('rises monotonically with the Claim count (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 4, max: 8 }),
        (low, high) => {
          const pLow = pressureProbability(SOFT, relWith(), low);
          const pHigh = pressureProbability(SOFT, relWith(), high);
          expect(pHigh).toBeGreaterThanOrEqual(pLow);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// pressureCheck transitions (Req 6.3)
// ---------------------------------------------------------------------------

describe('pressureCheck transitions', () => {
  it('degrades the cover one rung on a successful check against a soft NPC', () => {
    // A soft NPC with trust and strong evidence has p near 1 -> the cover moves.
    const rel = relWith({ trust: 1, coverState: 'intact' });
    const out = pressureCheck(SOFT, rel, evidence(1), createPrng('crack-1'));
    expect(coverIndex(out)).toBeGreaterThan(coverIndex('intact'));
  });

  it('walks intact → strained → cracking → blown under repeated pressure', () => {
    // Thread the PRNG through successive confrontations and confirm the cover
    // only ever degrades (never recovers) and eventually blows.
    const rng = createPrng('walk-cover');
    let state: CoverState = 'intact';
    const seen: CoverState[] = [state];
    for (let i = 0; i < 20 && state !== 'blown'; i += 1) {
      const next = pressureCheck(SOFT, relWith({ trust: 1, coverState: state }), evidence(3), rng);
      expect(coverIndex(next)).toBeGreaterThanOrEqual(coverIndex(state));
      state = next;
      seen.push(state);
    }
    expect(state).toBe('blown');
    expect(seen).toContain('cracking');
  });

  it('leaves the cover unchanged on a failed check against a hard NPC', () => {
    // A hard NPC with no trust and one Claim has p near 0 -> the cover holds.
    const rel = relWith({ trust: 0, coverState: 'strained' });
    const out = pressureCheck(HARD, rel, evidence(1), createPrng('hold-1'));
    expect(out).toBe('strained');
  });

  it('never degrades a cover already blown', () => {
    const rel = relWith({ trust: 1, coverState: 'blown' });
    const out = pressureCheck(SOFT, rel, evidence(3), createPrng('blown-stays'));
    expect(out).toBe('blown');
  });

  it('can jump two rungs on a decisive hit with strong evidence', () => {
    // Search seeds for a hard (two-rung) hit from intact against a soft NPC with
    // strong evidence; p is near 1 so a low draw clears the hard-margin cutoff.
    let jumped = false;
    for (let i = 0; i < 50 && !jumped; i += 1) {
      const out = pressureCheck(
        SOFT,
        relWith({ trust: 1, coverState: 'intact' }),
        evidence(3),
        createPrng(`jump-${i}`),
      );
      if (out === 'cracking') {
        jumped = true;
      }
    }
    expect(jumped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism (Property 11; Req 6.4)
// ---------------------------------------------------------------------------

describe('pressureCheck determinism', () => {
  it('is deterministic for a seed', () => {
    const npc = makeNpc();
    const rel = relWith({ trust: 0.5, coverState: 'strained' });
    const a = pressureCheck(npc, rel, evidence(2), createPrng('seed-pressure'));
    const b = pressureCheck(npc, rel, evidence(2), createPrng('seed-pressure'));
    expect(a).toBe(b);
  });

  it('draws exactly one coin', () => {
    const npc = makeNpc();
    const rng = createPrng('seed-one-coin');
    const before = rng.state();
    pressureCheck(npc, relWith({ trust: 0.5 }), evidence(1), rng);
    const probe = createPrng(before);
    probe.next();
    expect(rng.state()).toEqual(probe.state());
  });
});

// ---------------------------------------------------------------------------
// Agenda shift (Req 6.4)
// ---------------------------------------------------------------------------

describe('agendaShiftFor', () => {
  it('is none when the cover does not break', () => {
    expect(agendaShiftFor('intact', 'intact')).toBe('none');
    expect(agendaShiftFor('intact', 'strained')).toBe('none');
    expect(agendaShiftFor('strained', 'strained')).toBe('none');
    // A recovery (never happens in play) is also no Agenda change.
    expect(agendaShiftFor('cracking', 'strained')).toBe('none');
  });

  it('is a partial admission when the cover first reaches cracking', () => {
    expect(agendaShiftFor('intact', 'cracking')).toBe('partial-admission');
    expect(agendaShiftFor('strained', 'cracking')).toBe('partial-admission');
  });

  it('is bargaining when a cracking cover deepens to blown', () => {
    expect(agendaShiftFor('cracking', 'blown')).toBe('bargaining');
  });

  it('is flight when a cover jumps straight into blown, skipping cracking', () => {
    expect(agendaShiftFor('intact', 'blown')).toBe('flight');
    expect(agendaShiftFor('strained', 'blown')).toBe('flight');
  });
});

describe('coverBroke', () => {
  it('is true exactly when the move crossed into cracking or blown', () => {
    expect(coverBroke('intact', 'strained')).toBe(false);
    expect(coverBroke('strained', 'cracking')).toBe(true);
    expect(coverBroke('cracking', 'blown')).toBe(true);
    expect(coverBroke('intact', 'blown')).toBe(true);
    expect(coverBroke('intact', 'intact')).toBe(false);
  });
});
