/**
 * Unit tests for the dialogue {@link Intent} and {@link SceneKind}
 * vocabularies and the pure {@link applyIntent} reducer (slice Requirements
 * 4.2, 4.3, 4.4; Requirement 15.5). Moved here from the dialogue package with
 * the module itself.
 *
 * The reducer must be deterministic, pure (no mutation of its input, a fresh
 * result object), keep trust and suspicion in `[0, 1]`, move them by the fixed
 * per-Intent deltas, and carry every other {@link Relationship} field over
 * unchanged. These tests pin that contract for every Intent's delta and the
 * clamping edge cases, and check the vocabularies match the requirements'
 * fixed sets. `dialogue-turn.spec.ts` checks the same deltas through the
 * dialogue turn.
 */

import { describe, expect, it } from 'vitest';

import { asTruth, type NpcId, type OrgId } from '../model/core.js';
import { newRelationship, type Relationship } from './asset.js';
import {
  INTENTS,
  INTENT_DELTAS,
  SCENE_KINDS,
  applyIntent,
  isIntent,
  type Intent,
} from './intent.js';

const NPC = 'npc:target' as NpcId;

/** A fresh Relationship with the given trust and suspicion. */
function rel(trust: number, suspicion: number): Relationship {
  return { ...newRelationship(NPC), trust, suspicion };
}

describe('Intent vocabulary (slice Req 4.2)', () => {
  it('is exactly the fixed set from the requirement, in order', () => {
    expect([...INTENTS]).toEqual([
      'ask',
      'pitch-money',
      'pitch-ideology',
      'pitch-coercion',
      'pitch-ego',
      'reassure',
      'threaten',
      'probe',
      'confront',
      'task',
      'small-talk',
      'end',
    ]);
  });

  it('has a delta entry for every Intent and no others', () => {
    expect(Object.keys(INTENT_DELTAS).sort()).toEqual([...INTENTS].sort());
  });

  it('recognises every member and rejects non-members', () => {
    for (const i of INTENTS) {
      expect(isIntent(i)).toBe(true);
    }
    expect(isIntent('offer')).toBe(false);
    expect(isIntent('')).toBe(false);
    expect(isIntent(42)).toBe(false);
    expect(isIntent(undefined)).toBe(false);
  });
});

describe('SceneKind vocabulary (slice Req 4.4)', () => {
  it('names the three high-stakes kinds plus routine', () => {
    expect([...SCENE_KINDS]).toEqual([
      'interrogation',
      'recruitment-pitch',
      'confront-double-agent',
      'routine',
    ]);
  });
});

describe('applyIntent (slice Req 4.3; Req 15.5)', () => {
  const mid = rel(0.5, 0.5);

  it('moves trust and suspicion by the Intent delta', () => {
    const next = applyIntent(mid, 'reassure');
    expect(next.trust).toBeCloseTo(0.58, 10);
    expect(next.suspicion).toBeCloseTo(0.45, 10);
  });

  // No delta exceeds 0.2 in size, so from the midpoint none reaches a clamp.
  it.each(INTENTS)(
    'moves trust and suspicion by exactly the %s delta',
    (intent) => {
      const next = applyIntent(mid, intent);
      const delta = INTENT_DELTAS[intent];
      expect(next.trust).toBeCloseTo(mid.trust + delta.trust, 12);
      expect(next.suspicion).toBeCloseTo(mid.suspicion + delta.suspicion, 12);
    },
  );

  it('raises suspicion on a confront and cuts trust hardest', () => {
    const next = applyIntent(mid, 'confront');
    expect(next.suspicion).toBeGreaterThan(mid.suspicion);
    expect(next.trust).toBeLessThan(mid.trust);
    // confront is the sharpest trust cut of all Intents.
    const worst = Math.min(...INTENTS.map((i) => INTENT_DELTAS[i].trust));
    expect(INTENT_DELTAS.confront.trust).toBe(worst);
  });

  it("leaves the relationship unchanged on 'end'", () => {
    const next = applyIntent(mid, 'end');
    expect(next).toEqual(mid);
  });

  it('carries every field other than trust and suspicion over unchanged', () => {
    const full: Relationship = {
      ...rel(0.4, 0.3),
      exposure: 0.25,
      recruited: true,
      contacts: 3,
      lastContact: { day: 2, phase: 1 },
      channel: true,
      coverState: 'strained',
      retainer: { amount: 50, paidThrough: { day: 7, phase: 0 } },
      asset: {
        access: asTruth({ locs: [], orgs: ['org:x' as OrgId], npcs: [] }),
        reliability: asTruth(0.8),
        turned: false,
        hostileControlled: asTruth(false),
      },
      custody: { by: 'station', since: { day: 1, phase: 2 } },
    };
    for (const intent of INTENTS as readonly Intent[]) {
      const next = applyIntent(full, intent);
      expect(next).toEqual({ ...full, trust: next.trust, suspicion: next.suspicion });
      // Object-valued fields are carried by reference, not rebuilt.
      expect(next.asset).toBe(full.asset);
      expect(next.retainer).toBe(full.retainer);
      expect(next.custody).toBe(full.custody);
    }
  });

  it('is pure: it does not mutate the input and returns a fresh object', () => {
    const input = rel(0.5, 0.5);
    const snapshot = { ...input };
    const next = applyIntent(input, 'threaten');
    expect(input).toEqual(snapshot);
    expect(next).not.toBe(input);
  });

  it('is deterministic: the same inputs give the same output', () => {
    for (const i of INTENTS) {
      expect(applyIntent(mid, i)).toEqual(applyIntent(mid, i));
    }
  });

  it('clamps suspicion at the upper bound', () => {
    const next = applyIntent(rel(0.5, 0.95), 'threaten'); // suspicion delta +0.2
    expect(next.suspicion).toBe(1);
  });

  it('clamps trust at the lower bound', () => {
    const next = applyIntent(rel(0.05, 0.5), 'confront'); // trust delta -0.2
    expect(next.trust).toBe(0);
  });

  it('keeps both scalars within [0, 1] for every Intent from any state', () => {
    const states = [rel(0, 0), rel(1, 1), rel(0.5, 0.5)];
    for (const state of states) {
      for (const intent of INTENTS as readonly Intent[]) {
        const next = applyIntent(state, intent);
        expect(next.trust).toBeGreaterThanOrEqual(0);
        expect(next.trust).toBeLessThanOrEqual(1);
        expect(next.suspicion).toBeGreaterThanOrEqual(0);
        expect(next.suspicion).toBeLessThanOrEqual(1);
      }
    }
  });
});
