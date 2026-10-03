/**
 * Tests for the Hostile Service belief model and Exposure tracking (task 19.1;
 * Requirement 12.2).
 *
 * These pin the pure state transitions:
 *
 * - Exposure accrues monotonically toward the reading and clamps to `[0, 1]`;
 * - agent suspicion raises and clamps;
 * - `effectiveExposure` is the max of the two signals the detection check reads;
 * - belief adoption dedupes once per belief key, and the `adopted` flag reports
 *   whether a belief was new;
 * - suspected-Asset and compromised-Channel marks are idempotent.
 */

import { describe, expect, it } from 'vitest';

import type { ChannelId, NpcId, Proposition } from '../model/core.js';
import {
  emptyHostileBeliefs,
  accrueExposure,
  raiseAgentSuspicion,
  effectiveExposure,
  beliefKey,
  adoptBelief,
  markSuspected,
  markChannelCompromised,
} from './beliefs.js';

const NPC = 'npc:asset-1' as NpcId;

function prop(overrides: Partial<Proposition> = {}): Proposition {
  return {
    id: 'prop:1',
    subject: 'npc:x' as NpcId,
    predicate: 'KNOWS',
    object: 'org:cell' as unknown as Proposition['object'],
    ...overrides,
  };
}

describe('accrueExposure', () => {
  it('rises toward the reading and never falls', () => {
    let b = emptyHostileBeliefs();
    b = accrueExposure(b, NPC, 0.4);
    expect(b.exposure[NPC]).toBe(0.4);
    b = accrueExposure(b, NPC, 0.7);
    expect(b.exposure[NPC]).toBe(0.7);
    // A lower reading does not lower the mirror.
    b = accrueExposure(b, NPC, 0.2);
    expect(b.exposure[NPC]).toBe(0.7);
  });

  it('clamps to [0, 1]', () => {
    let b = emptyHostileBeliefs();
    b = accrueExposure(b, NPC, 5);
    expect(b.exposure[NPC]).toBe(1);
  });

  it('returns the same object when nothing changes', () => {
    const b = accrueExposure(emptyHostileBeliefs(), NPC, 0.3);
    expect(accrueExposure(b, NPC, 0.1)).toBe(b);
  });
});

describe('raiseAgentSuspicion', () => {
  it('adds the delta and clamps to [0, 1]', () => {
    let b = emptyHostileBeliefs();
    b = raiseAgentSuspicion(b, NPC, 0.2);
    expect(b.agentSuspicion[NPC]).toBeCloseTo(0.2);
    b = raiseAgentSuspicion(b, NPC, 0.9);
    expect(b.agentSuspicion[NPC]).toBe(1);
  });
});

describe('effectiveExposure', () => {
  it('is the larger of exposure and agent suspicion', () => {
    let b = emptyHostileBeliefs();
    b = accrueExposure(b, NPC, 0.3);
    b = raiseAgentSuspicion(b, NPC, 0.6);
    expect(effectiveExposure(b, NPC)).toBe(0.6);
    b = accrueExposure(b, NPC, 0.8);
    expect(effectiveExposure(b, NPC)).toBe(0.8);
  });

  it('is zero for an unknown Asset', () => {
    expect(effectiveExposure(emptyHostileBeliefs(), NPC)).toBe(0);
  });
});

describe('adoptBelief', () => {
  it('adopts a new belief and flags it as new', () => {
    const r = adoptBelief(emptyHostileBeliefs(), prop());
    expect(r.adopted).toBe(true);
    expect(r.beliefs.adopted).toHaveLength(1);
    expect(r.beliefs.adoptedKeys).toHaveLength(1);
  });

  it('dedupes the same belief key (once per belief key)', () => {
    const first = adoptBelief(emptyHostileBeliefs(), prop({ id: 'prop:a' }));
    // Same predicate/subject/object/place/window, different id — same belief.
    const second = adoptBelief(first.beliefs, prop({ id: 'prop:b' }));
    expect(second.adopted).toBe(false);
    expect(second.beliefs).toBe(first.beliefs);
    expect(second.beliefs.adopted).toHaveLength(1);
  });

  it('treats a different object as a different belief', () => {
    const first = adoptBelief(emptyHostileBeliefs(), prop());
    const second = adoptBelief(
      first.beliefs,
      prop({ object: 'org:station' as unknown as Proposition['object'] }),
    );
    expect(second.adopted).toBe(true);
    expect(second.beliefs.adopted).toHaveLength(2);
  });

  it('beliefKey distinguishes place and window', () => {
    const base = prop();
    expect(beliefKey(base)).not.toBe(
      beliefKey(prop({ place: 'loc:cafe' as Proposition['place'] })),
    );
  });
});

describe('markSuspected / markChannelCompromised', () => {
  it('mark suspected is idempotent', () => {
    const b = markSuspected(emptyHostileBeliefs(), NPC);
    expect(b.suspectedAssets).toEqual([NPC]);
    expect(markSuspected(b, NPC)).toBe(b);
  });

  it('mark channel compromised is idempotent', () => {
    const chan = 'chan:plot-1' as ChannelId;
    const b = markChannelCompromised(emptyHostileBeliefs(), chan);
    expect(b.compromisedChannels).toEqual([chan]);
    expect(markChannelCompromised(b, chan)).toBe(b);
  });
});
