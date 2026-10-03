/**
 * Tests for the off-screen consequences of the Hostile Service's hidden events
 * (task 19.5; Requirements 39.4, 39.5).
 *
 * These pin:
 *
 * - an `asset-arrested` event voids the arrested Asset's pending meetings and
 *   drops, as data for player-view's 16.6 to raise its derived
 *   `meeting-no-show` / `drop-unserviced` Notifications (Req 39.5);
 * - a public arrest article is printed with p = `1 − deceptionAppetite` — always
 *   at `deceptionAppetite = 0`, never at `deceptionAppetite = 1` (Req 39.4);
 * - a doubled Asset produces no consequence and no article here, so doubling
 *   stays free of any direct signal (Req 39.4);
 * - the whole thing is deterministic.
 */

import { describe, expect, it } from 'vitest';

import type {
  GameTime,
  NpcId,
  PredicateId,
  Proposition,
  PropId,
} from '../model/core.js';
import type { DeadDropId, MeetingId, SimEvent } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import type { Doctrine } from './doctrine.js';
import {
  arrestConsequences,
  arrestArticles,
  arrestArticle,
  buildArrestArticle,
  arrestArticleProbability,
  type CommitmentProjection,
  type ArrestArticleProjection,
} from './consequences.js';

const AT: GameTime = { day: 5, phase: 1 };
const NPC_A = 'npc:asset-a' as NpcId;
const NPC_B = 'npc:asset-b' as NpcId;
const MEETING: MeetingId = 'meeting:a-1';
const SLOT: GameTime = { day: 6, phase: 2 };
const DROP = 'drop:a-1' as DeadDropId;

/** A hidden event of the given kind for an NPC, stamped at `AT`. */
function npcEvent(
  kind: 'asset-arrested' | 'asset-doubled' | 'asset-detected',
  npc: NpcId,
): SimEvent {
  return {
    id: `evt:${kind}:${npc}` as SimEvent['id'],
    at: AT,
    visibility: 'hidden',
    kind,
    npc,
  };
}

/** A doctrine with the given deceptionAppetite (the only field these tests read). */
function doctrine(deceptionAppetite: number): Doctrine {
  return { riskTolerance: 0.5, securityConsciousness: 0.5, deceptionAppetite };
}

const COMMITMENTS: CommitmentProjection = {
  [NPC_A]: {
    npc: NPC_A,
    pendingMeetings: [{ meeting: MEETING, slot: SLOT }],
    pendingDrops: [{ drop: DROP }],
  },
};

describe('arrestConsequences', () => {
  it('voids the arrested Asset meetings and drops for 16.6 to observe', () => {
    const result = arrestConsequences([npcEvent('asset-arrested', NPC_A)], COMMITMENTS);

    expect(result.voidedMeetings).toEqual([{ npc: NPC_A, meeting: MEETING, slot: SLOT }]);
    expect(result.voidedDrops).toEqual([{ npc: NPC_A, drop: DROP }]);
  });

  it('ignores a doubled Asset — a double has no observable consequence', () => {
    const result = arrestConsequences([npcEvent('asset-doubled', NPC_A)], COMMITMENTS);

    expect(result.voidedMeetings).toEqual([]);
    expect(result.voidedDrops).toEqual([]);
  });

  it('ignores a mere detection with no arrest', () => {
    const result = arrestConsequences([npcEvent('asset-detected', NPC_A)], COMMITMENTS);

    expect(result.voidedMeetings).toEqual([]);
    expect(result.voidedDrops).toEqual([]);
  });

  it('voids nothing for an arrested Asset absent from the projection', () => {
    const result = arrestConsequences([npcEvent('asset-arrested', NPC_B)], COMMITMENTS);

    expect(result.voidedMeetings).toEqual([]);
    expect(result.voidedDrops).toEqual([]);
  });

  it('is order-independent: arrested Assets process in id-sorted order', () => {
    const commitments: CommitmentProjection = {
      [NPC_A]: { npc: NPC_A, pendingMeetings: [{ meeting: MEETING, slot: SLOT }], pendingDrops: [] },
      [NPC_B]: {
        npc: NPC_B,
        pendingMeetings: [{ meeting: 'meeting:b-1' as MeetingId, slot: SLOT }],
        pendingDrops: [],
      },
    };
    const forward = arrestConsequences(
      [npcEvent('asset-arrested', NPC_A), npcEvent('asset-arrested', NPC_B)],
      commitments,
    );
    const reverse = arrestConsequences(
      [npcEvent('asset-arrested', NPC_B), npcEvent('asset-arrested', NPC_A)],
      commitments,
    );

    expect(reverse).toEqual(forward);
    expect(forward.voidedMeetings.map((m) => m.npc)).toEqual([NPC_A, NPC_B]);
  });
});

describe('arrestArticleProbability', () => {
  it('is 1 − deceptionAppetite', () => {
    expect(arrestArticleProbability(doctrine(0))).toBe(1);
    expect(arrestArticleProbability(doctrine(1))).toBe(0);
    expect(arrestArticleProbability(doctrine(0.25))).toBeCloseTo(0.75, 10);
  });
});

describe('arrestArticle', () => {
  it('always prints at deceptionAppetite = 0 (p = 1)', () => {
    const article = arrestArticle(NPC_A, AT.day, doctrine(0), { place: 'the Inner City' }, createPrng('s'));
    expect(article).not.toBeUndefined();
    expect(article?.source).toBe('city-event');
    expect(article?.id).toBe(`arrest/${NPC_A}/${AT.day}`);
  });

  it('never prints at deceptionAppetite = 1 (p = 0)', () => {
    const article = arrestArticle(NPC_A, AT.day, doctrine(1), { place: 'the Inner City' }, createPrng('s'));
    expect(article).toBeUndefined();
  });

  it('carries the projected assertions a reader can seed into the Case File', () => {
    const prop: Proposition = {
      id: 'prop:arrest-a' as PropId,
      subject: NPC_A,
      predicate: 'ARRESTED' as PredicateId,
      object: NPC_A,
    };
    const article = buildArrestArticle(NPC_A, AT.day, { place: 'the port', asserts: [prop] });
    expect(article.asserts).toEqual([prop]);
  });
});

describe('arrestArticles', () => {
  const projection: ArrestArticleProjection = {
    [NPC_A]: { place: 'the Second District' },
    [NPC_B]: { place: 'a Ring café' },
  };

  it('prints an article per arrest at deceptionAppetite = 0', () => {
    const articles = arrestArticles(
      [npcEvent('asset-arrested', NPC_A), npcEvent('asset-arrested', NPC_B)],
      AT.day,
      doctrine(0),
      projection,
      createPrng('s'),
    );
    expect(articles.map((a) => a.id)).toEqual([`arrest/${NPC_A}/${AT.day}`, `arrest/${NPC_B}/${AT.day}`]);
  });

  it('suppresses all articles at deceptionAppetite = 1', () => {
    const articles = arrestArticles(
      [npcEvent('asset-arrested', NPC_A), npcEvent('asset-arrested', NPC_B)],
      AT.day,
      doctrine(1),
      projection,
      createPrng('s'),
    );
    expect(articles).toEqual([]);
  });

  it('prints nothing for a doubled Asset — doubling stays signal-free', () => {
    const articles = arrestArticles(
      [npcEvent('asset-doubled', NPC_A)],
      AT.day,
      doctrine(0),
      projection,
      createPrng('s'),
    );
    expect(articles).toEqual([]);
  });

  it('is deterministic for the same seed and event order', () => {
    const run = () =>
      arrestArticles(
        [npcEvent('asset-arrested', NPC_A), npcEvent('asset-arrested', NPC_B)],
        AT.day,
        doctrine(0.5),
        projection,
        createPrng('fixed-seed'),
      );
    expect(run()).toEqual(run());
  });

  it('draws one coin per arrest in id order, independent of event order', () => {
    const forward = arrestArticles(
      [npcEvent('asset-arrested', NPC_A), npcEvent('asset-arrested', NPC_B)],
      AT.day,
      doctrine(0.5),
      projection,
      createPrng('seed'),
    );
    const reverse = arrestArticles(
      [npcEvent('asset-arrested', NPC_B), npcEvent('asset-arrested', NPC_A)],
      AT.day,
      doctrine(0.5),
      projection,
      createPrng('seed'),
    );
    expect(reverse).toEqual(forward);
  });
});
