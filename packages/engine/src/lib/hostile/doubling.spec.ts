/**
 * Tests for doubling the player's Assets and the Chickenfeed a doubled Asset
 * feeds back (task 19.2; Requirements 11.3, 11.4, 11.5).
 *
 * These pin:
 *
 * - `chickenfeedCount` scales with `deceptionAppetite`, 1..MAX;
 * - `selectChickenfeed` picks a deterministic, doctrine-sized prefix of the
 *   id-sorted true candidates (and all of them when the pool is smaller);
 * - `decideDoubling` returns the `hostileControlled := true` flip intent and the
 *   Chickenfeed, carrying no player-visible event (doubling is silent);
 * - everything is deterministic.
 */

import { describe, expect, it } from 'vitest';

import type { NpcId, Proposition } from '../model/core.js';
import type { Doctrine } from './doctrine.js';
import {
  chickenfeedCount,
  selectChickenfeed,
  decideDoubling,
  MAX_CHICKENFEED_ITEMS,
  type ChickenfeedCandidate,
} from './doubling.js';

const NPC = 'npc:asset-1' as NpcId;

function doctrine(deceptionAppetite: number): Doctrine {
  return { riskTolerance: 0.5, securityConsciousness: 0.5, deceptionAppetite };
}

function candidate(id: string): ChickenfeedCandidate {
  return {
    prop: {
      id,
      subject: 'npc:asset-1' as NpcId,
      predicate: 'core/KNOWS',
      object: 'npc:x' as NpcId,
    } as Proposition,
  };
}

describe('chickenfeedCount', () => {
  it('passes a single token true fact at low deception appetite', () => {
    expect(chickenfeedCount(doctrine(0))).toBe(1);
  });

  it('passes up to the cap at high deception appetite', () => {
    expect(chickenfeedCount(doctrine(1))).toBe(MAX_CHICKENFEED_ITEMS);
  });

  it('scales monotonically in between', () => {
    const low = chickenfeedCount(doctrine(0.2));
    const high = chickenfeedCount(doctrine(0.9));
    expect(high).toBeGreaterThanOrEqual(low);
  });
});

describe('selectChickenfeed', () => {
  it('picks a deterministic, doctrine-sized prefix of id-sorted candidates', () => {
    const candidates = [candidate('prop:c'), candidate('prop:a'), candidate('prop:b')];
    const feed = selectChickenfeed(doctrine(1), candidates);
    expect(feed.props.map((p) => p.id)).toEqual(['prop:a', 'prop:b', 'prop:c']);
  });

  it('takes only the doctrine count when the pool is larger', () => {
    const candidates = [candidate('prop:a'), candidate('prop:b'), candidate('prop:c')];
    const feed = selectChickenfeed(doctrine(0), candidates);
    expect(feed.props).toHaveLength(1);
    expect(feed.props[0].id).toBe('prop:a');
  });

  it('returns all candidates when the pool is smaller than the count', () => {
    const feed = selectChickenfeed(doctrine(1), [candidate('prop:only')]);
    expect(feed.props.map((p) => p.id)).toEqual(['prop:only']);
  });

  it('returns an empty feed for no candidates', () => {
    expect(selectChickenfeed(doctrine(1), []).props).toHaveLength(0);
  });

  it('does not mutate the candidate array', () => {
    const candidates = [candidate('prop:c'), candidate('prop:a')];
    const before = candidates.map((c) => c.prop.id);
    selectChickenfeed(doctrine(1), candidates);
    expect(candidates.map((c) => c.prop.id)).toEqual(before);
  });
});

describe('decideDoubling', () => {
  it('returns the hostileControlled flip and the Chickenfeed', () => {
    const decision = decideDoubling(NPC, doctrine(1), [candidate('prop:a'), candidate('prop:b')]);
    expect(decision.npc).toBe(NPC);
    expect(decision.hostileControlled).toBe(true);
    expect(decision.chickenfeed.props.map((p) => p.id)).toEqual(['prop:a', 'prop:b']);
  });

  it('doubles with empty Chickenfeed when the Asset has no reportable truth', () => {
    const decision = decideDoubling(NPC, doctrine(1), []);
    expect(decision.hostileControlled).toBe(true);
    expect(decision.chickenfeed.props).toHaveLength(0);
  });

  it('is deterministic', () => {
    const candidates = [candidate('prop:a'), candidate('prop:b')];
    expect(decideDoubling(NPC, doctrine(0.5), candidates)).toEqual(
      decideDoubling(NPC, doctrine(0.5), candidates),
    );
  });
});
