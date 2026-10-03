/**
 * Tests for feed ingestion (task 19.6, `dailyTick` step-5 ingest; Requirements
 * 37.3, 37.4, 37.5, 38.3).
 *
 * These pin the design's "Feed ingestion" rule, per fed Proposition:
 *
 * - classification is `chickenfeed` iff the Proposition holds in Truth at
 *   delivery, else `deception` (debrief-only ground truth; Req 37.3);
 * - a confirmed Proposition raises the agent's credibility and a refuted one
 *   lowers it and raises agent suspicion (Req 37.4), so a refuted feed can blow
 *   the agent (push suspicion to the detection-blow range);
 * - an unverifiable Proposition is adopted iff the running credibility meets the
 *   doctrine adoption threshold `0.4 + 0.4 × securityConsciousness` (Req 37.4);
 * - an adopted belief about a Plot Channel marks that Channel compromised, for
 *   the step-5 Plot disruption / Abort Pressure (Req 38.3);
 * - credibility seeds from the agent's pre-turn trust the first time it is fed;
 * - ingestion is deterministic (Property 30).
 */

import { describe, expect, it } from 'vitest';

import type {
  ChannelId,
  EntityId,
  GameTime,
  NpcId,
  Proposition,
} from '../model/core.js';
import type { Doctrine } from './doctrine.js';
import { emptyHostileBeliefs } from './beliefs.js';
import { BLOWN_AGENT_SUSPICION } from './detection.js';
import {
  ingestFeed,
  adoptionThreshold,
  CONFIRM_CREDIBILITY,
  REFUTE_CREDIBILITY,
  REFUTE_SUSPICION,
  type FedProposition,
  type FeedDelivery,
} from './ingest-feed.js';

const AT: GameTime = { day: 5, phase: 1 };
const AGENT = 'npc:double' as NpcId;

/** A doctrine with the given security consciousness (the only field adoption reads). */
function doctrine(securityConsciousness: number): Doctrine {
  return { riskTolerance: 0.5, securityConsciousness, deceptionAppetite: 0.5 };
}

/** A `KNOWS(station, object)` Proposition. */
function prop(object: string, id = `prop:${object}`): Proposition {
  return {
    id,
    subject: 'org:station' as EntityId,
    predicate: 'core/KNOWS',
    object: object as EntityId,
  };
}

/** A fed-item projection with sensible defaults (unverifiable, deception). */
function item(overrides: Partial<FedProposition> & { prop: Proposition }): FedProposition {
  return {
    holdsInTruth: false,
    confirmed: false,
    refuted: false,
    ...overrides,
  };
}

/** A delivery for one agent with the given items and prior trust. */
function delivery(items: readonly FedProposition[], priorTrust = 0.6): FeedDelivery {
  return { agent: AGENT, items, priorTrust };
}

describe('adoptionThreshold', () => {
  it('is 0.4 + 0.4 × securityConsciousness', () => {
    expect(adoptionThreshold(doctrine(0))).toBeCloseTo(0.4);
    expect(adoptionThreshold(doctrine(0.5))).toBeCloseTo(0.6);
    expect(adoptionThreshold(doctrine(1))).toBeCloseTo(0.8);
  });
});

describe('ingestFeed — classification (Req 37.3)', () => {
  it('classifies chickenfeed iff the Proposition holds in Truth at delivery', () => {
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([
        item({ prop: prop('npc:a'), holdsInTruth: true }),
        item({ prop: prop('npc:b'), holdsInTruth: false }),
      ]),
      doctrine(0.5),
      AT,
    );
    expect(result.classes).toEqual(['chickenfeed', 'deception']);
  });
});

describe('ingestFeed — credibility (Req 37.4)', () => {
  it('seeds credibility from the agent`s pre-turn trust the first time it is fed', () => {
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([item({ prop: prop('npc:a') })], 0.7),
      doctrine(0.5),
      AT,
    );
    // Unverifiable item, no confirm/refute, so credibility stays at the seed.
    expect(result.beliefs.credibility[AGENT]).toBeCloseTo(0.7);
  });

  it('a confirmed Proposition raises credibility and never lowers it', () => {
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([item({ prop: prop('npc:a'), confirmed: true })], 0.6),
      doctrine(0.5),
      AT,
    );
    expect(result.beliefs.credibility[AGENT]).toBeCloseTo(0.6 + CONFIRM_CREDIBILITY);
    expect(result.beliefs.credibility[AGENT]).toBeGreaterThanOrEqual(0.6);
  });

  it('a refuted Proposition lowers credibility and raises agent suspicion', () => {
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([item({ prop: prop('npc:a'), refuted: true })], 0.6),
      doctrine(0.5),
      AT,
    );
    expect(result.beliefs.credibility[AGENT]).toBeCloseTo(0.6 - REFUTE_CREDIBILITY);
    expect(result.beliefs.agentSuspicion[AGENT]).toBeCloseTo(REFUTE_SUSPICION);
  });

  it('a refuted feed can blow the agent (suspicion reaches the detection-blow range)', () => {
    // Three refutes: 3 × 0.2 = 0.6 ≥ BLOWN_AGENT_SUSPICION.
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([
        item({ prop: prop('npc:a'), refuted: true }),
        item({ prop: prop('npc:b'), refuted: true }),
        item({ prop: prop('npc:c'), refuted: true }),
      ]),
      doctrine(0.5),
      AT,
    );
    expect(result.beliefs.agentSuspicion[AGENT]).toBeGreaterThanOrEqual(
      BLOWN_AGENT_SUSPICION,
    );
  });

  it('clamps credibility to [0, 1]', () => {
    const lots = Array.from({ length: 5 }, (_, i) =>
      item({ prop: prop(`npc:r${i}`), refuted: true }),
    );
    const result = ingestFeed(emptyHostileBeliefs(), delivery(lots, 0.6), doctrine(0.5), AT);
    expect(result.beliefs.credibility[AGENT]).toBe(0);
  });
});

describe('ingestFeed — adoption (Req 37.4, 37.5)', () => {
  it('adopts an unverifiable Proposition when credibility meets the threshold', () => {
    // threshold at security 0.5 is 0.6; seed 0.65 clears it.
    const p = prop('npc:a');
    const result = ingestFeed(emptyHostileBeliefs(), delivery([item({ prop: p })], 0.65), doctrine(0.5), AT);
    expect(result.adopted).toEqual([p]);
    expect(result.beliefs.adopted).toHaveLength(1);
    expect(result.events.map((e) => e.kind)).toEqual(['belief-adopted']);
    expect(result.events.every((e) => e.visibility === 'hidden')).toBe(true);
  });

  it('does not adopt when credibility is below the threshold', () => {
    // threshold at security 0.5 is 0.6; seed 0.55 is below it.
    const result = ingestFeed(emptyHostileBeliefs(), delivery([item({ prop: prop('npc:a') })], 0.55), doctrine(0.5), AT);
    expect(result.adopted).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it('does not adopt a confirmed or refuted Proposition (only unverifiable ones)', () => {
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([
        item({ prop: prop('npc:a'), confirmed: true }),
        item({ prop: prop('npc:b'), refuted: true }),
      ], 0.8),
      doctrine(0),
      AT,
    );
    expect(result.adopted).toHaveLength(0);
  });

  it('a confirm earlier in the feed can lift later items over the adoption bar', () => {
    // threshold 0.6; seed 0.55 below it, but a confirm (+0.1) lifts to 0.65.
    const later = prop('npc:later');
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([
        item({ prop: prop('npc:first'), confirmed: true }),
        item({ prop: later }),
      ], 0.55),
      doctrine(0.5),
      AT,
    );
    expect(result.adopted).toEqual([later]);
  });

  it('a higher securityConsciousness raises the bar a feed must clear', () => {
    // seed 0.7: adopted at security 0.5 (thr 0.6), not at security 1 (thr 0.8).
    const low = ingestFeed(emptyHostileBeliefs(), delivery([item({ prop: prop('npc:a') })], 0.7), doctrine(0.5), AT);
    const high = ingestFeed(emptyHostileBeliefs(), delivery([item({ prop: prop('npc:a') })], 0.7), doctrine(1), AT);
    expect(low.adopted).toHaveLength(1);
    expect(high.adopted).toHaveLength(0);
  });
});

describe('ingestFeed — compromised Channels (Req 38.3)', () => {
  const CHAN = 'chan:plot-link' as ChannelId;

  it('marks a Plot Channel compromised when a credible channel belief is adopted', () => {
    const p = prop(CHAN);
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([item({ prop: p, channel: CHAN })], 0.7),
      doctrine(0.5),
      AT,
    );
    expect(result.adopted).toEqual([p]);
    expect(result.compromisedChannels).toEqual([CHAN]);
    expect(result.beliefs.compromisedChannels).toContain(CHAN);
  });

  it('does not mark a Channel compromised when the belief is not adopted', () => {
    const result = ingestFeed(
      emptyHostileBeliefs(),
      delivery([item({ prop: prop(CHAN), channel: CHAN })], 0.4),
      doctrine(0.5),
      AT,
    );
    expect(result.compromisedChannels).toHaveLength(0);
    expect(result.beliefs.compromisedChannels).toHaveLength(0);
  });
});

describe('ingestFeed — determinism (Property 30)', () => {
  it('is deterministic', () => {
    const d = delivery([
      item({ prop: prop('npc:a'), confirmed: true }),
      item({ prop: prop('npc:b') }),
      item({ prop: prop('npc:c'), refuted: true }),
    ]);
    expect(ingestFeed(emptyHostileBeliefs(), d, doctrine(0.5), AT)).toEqual(
      ingestFeed(emptyHostileBeliefs(), d, doctrine(0.5), AT),
    );
  });

  it('keeps a running credibility across repeated feeds (seed ignored after the first)', () => {
    const first = ingestFeed(
      emptyHostileBeliefs(),
      delivery([item({ prop: prop('npc:a'), confirmed: true })], 0.6),
      doctrine(0.5),
      AT,
    );
    // Second feed with a different (ignored) prior trust: credibility continues
    // from the running 0.7, so a confirm takes it to 0.8.
    const second = ingestFeed(
      first.beliefs,
      delivery([item({ prop: prop('npc:b'), confirmed: true })], 0.2),
      doctrine(0.5),
      AT,
    );
    expect(second.beliefs.credibility[AGENT]).toBeCloseTo(0.8);
  });
});
