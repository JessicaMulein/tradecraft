import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { scheduledLocation, type ScheduleEntry } from '../city/npc.js';
import { asTruth, type LocId, type NpcId, type Phase } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';

import { commitGossip, eligiblePair, stepGossip } from './gossip.js';
import {
  compact,
  memoryOf,
  noticeCheck,
  noticeTurn,
  recollectionGrounded,
  regardDelta,
  regardOf,
  type Recollection,
} from './memory.js';
import type { AmbientState, TieKind } from './state.js';
import { stepTies, tieProposition } from './ties.js';

const CAFE = 'loc:cafe' as LocId;

function schedule(loc: LocId): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let phase = 0; phase < 4; phase += 1) {
      entries.push({ weekday, phase: phase as Phase, loc });
    }
  }
  return entries;
}

function rec(id: string, holder: string, salience: number): Recollection {
  return {
    id,
    kind: 'saw',
    at: { day: 1, phase: 1 },
    loc: CAFE,
    aboutPlayer: true,
    salience,
    ground: { kind: 'witness', event: `turn:${id}`, loc: CAFE },
  };
}

function ambient(extra: Partial<AmbientState> = {}): AmbientState {
  return {
    schema: 1,
    cityId: 'core',
    enabled: true,
    density: 'standard',
    calendar: { startDate: '1948-01-01', holidays: [] },
    metrics: {
      exo: { unrest: 0.2, police: 0.3, shortage: 0.2, tension: 0.3, festivity: 0.1 },
      react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
    },
    events: {},
    history: {},
    triggers: [],
    overlays: [],
    dormant: [],
    life: {},
    ties: [],
    tier: {},
    townsfolk: {},
    civicOrgs: [],
    promotionQueue: [],
    lastInteraction: {},
    memory: asTruth({}),
    regard: asTruth({}),
    informants: asTruth({}),
    stories: {},
    outlets: [],
    duties: [],
    coverStanding: asTruth(0),
    hookLedger: asTruth([]),
    ambientDelayDays: 0,
    coverDeltaToday: { pos: 0, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    tieKnowledge: {},
    falseBeliefs: {},
    gate: { solvable: [], anchors: [], slowRunsToday: 0 },
    counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
    ...extra,
  };
}

function world(opts: {
  readonly ties?: AmbientState['ties'];
  readonly memory?: Record<string, readonly Recollection[]>;
  readonly informants?: Record<string, 'police' | 'hostile'>;
  readonly npcs?: WorldState['npcs'];
  readonly whereabouts?: WorldState['whereabouts'];
}): WorldState {
  return {
    time: { day: 1, phase: 1 },
    meta: { seed: 'mem', preset: { id: 'standard' } },
    player: { loc: CAFE, coverSuspicion: asTruth(0.1) },
    npcs: opts.npcs ?? {},
    whereabouts: opts.whereabouts ?? {},
    city: { locations: { [CAFE]: { type: 'cafe', name: 'Cafe' } } },
    plot: { stages: [], roles: [], leader: asTruth('npc:none') },
    hostile: { beliefs: { compromisedChannels: [] } },
    channels: {},
    ambient: ambient({
      ties: opts.ties ?? [],
      memory: asTruth(opts.memory ?? {}),
      informants: asTruth(opts.informants ?? {}),
    }),
  } as unknown as WorldState;
}

describe('memory', () => {
  it('decays salience, drops the floor, and keeps the cap', () => {
    const kept = compact(
      [rec('a', 'npc:a', 0.2), rec('b', 'npc:a', 0.05), rec('c', 'npc:a', 0.9)],
      1,
    );
    expect(kept.map((item) => item.id)).toEqual(['c']);
    expect(kept[0]?.salience).toBeCloseTo(0.81);
  });

  it('uses a descriptor for a person the witness cannot name', () => {
    const start = world({
      npcs: {
        'npc:ada': { id: 'npc:ada', securityConsciousness: asTruth(1), descriptor: { summary: 'a clerk' }, persona: { name: 'Ada' } },
        'npc:bo': { id: 'npc:bo', securityConsciousness: asTruth(1), descriptor: { summary: 'a porter' }, persona: { name: 'Bo' } },
      } as unknown as WorldState['npcs'],
      whereabouts: { 'npc:ada': CAFE, 'npc:bo': CAFE },
    });
    const next = noticeTurn(start, { kind: 'talk', npc: 'npc:bo' });
    const ada = memoryOf(next)['npc:ada' as NpcId] ?? [];
    const seen = ada.find((item) => item.kind === 'seen-with');
    expect(seen?.withDescriptor).toBe('a porter');
    expect(seen?.aboutPlayer).toBe(true);
    expect(regardOf(next, 'npc:bo' as NpcId).familiarity).toBeGreaterThan(0);
  });

  it('adds nothing to the approach formula when ambient is off', () => {
    const quiet = { ambient: undefined } as WorldState;
    expect(regardDelta(quiet, 'npc:ada')).toBe(0);
  });
});

describe('gossip', () => {
  it('copies only an item the source holds, and only along a tie', () => {
    const source = rec('saw-player', 'npc:ada', 0.8);
    const start = world({
      ties: [{ a: 'npc:ada' as NpcId, b: 'npc:bo' as NpcId, affinity: 0.5 }],
      memory: { 'npc:ada': [source] },
      npcs: {
        'npc:ada': { id: 'npc:ada', schedule: { entries: schedule(CAFE) } },
        'npc:bo': { id: 'npc:bo', schedule: { entries: schedule(CAFE) } },
      } as unknown as WorldState['npcs'],
    });
    expect(eligiblePair(start, 'npc:ada' as NpcId, 'npc:no' as NpcId)).toBe(false);
    const next = commitGossip(start, 'npc:ada' as NpcId, 'npc:bo' as NpcId);
    const heard = memoryOf(next)['npc:bo' as NpcId]?.[0];
    expect(heard?.ground).toEqual({ kind: 'gossip', from: 'npc:ada', item: 'saw-player' });
    expect(heard?.salience).toBeCloseTo(0.48);
    expect(memoryOf(next)['npc:ada' as NpcId]?.map((item) => item.id)).toEqual(['saw-player']);
  });

  it('reports a player sighting once through the informant hook', () => {
    const seen: Recollection = {
      ...rec('seen', 'npc:ada', 0.7),
      kind: 'seen-with',
      with: 'npc:bo' as NpcId,
    };
    const start = world({
      memory: { 'npc:ada': [seen] },
      informants: { 'npc:ada': 'hostile' },
    });
    const next = stepGossip(start);
    expect(next.ambient?.informantReports[0]?.handler).toBe('hostile');
    expect(next.ambient?.detectionBonuses['npc:bo']).toBeCloseTo(0.05);
    const again = stepGossip(next);
    expect(again.ambient?.informantReports).toHaveLength(1);
  });
});

const ACTIONS = ['pay', 'talk', 'confront', 'approach'] as const;
const PLACES = [CAFE, 'loc:dock' as LocId] as const;

describe('Property 14: Memory grounding', () => {
  // Feature: ambient-world, Property 14: Memory grounding
  it('every recollection is witnessed, participated, or heard from a holder', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(0, 1, 2, 3),
        fc.constantFrom(...PLACES),
        fc.constantFrom(...ACTIONS),
        fc.integer({ min: 1, max: 1_000_000 }),
        (salt, weekday, phase, loc, action, seed) => {
          const at = { day: weekday, phase: phase as 0 | 1 | 2 | 3 };
          const source: Recollection = {
            ...rec(`saw-${salt}`, 'npc:ada', 0.8),
            loc,
            at,
            ground: { kind: 'witness', event: `turn:saw-${salt}`, loc },
          };
          const start = {
            ...world({
              ties: [{ a: 'npc:ada' as NpcId, b: 'npc:bo' as NpcId, affinity: 1 }],
              memory: { 'npc:ada': [source] },
              npcs: {
                'npc:ada': {
                  id: 'npc:ada',
                  securityConsciousness: asTruth(1),
                  descriptor: { summary: 'a clerk' },
                  persona: { name: 'Ada' },
                  schedule: { entries: schedule(loc) },
                },
                'npc:bo': {
                  id: 'npc:bo',
                  securityConsciousness: asTruth(1),
                  descriptor: { summary: 'a porter' },
                  persona: { name: 'Bo' },
                  schedule: { entries: schedule(loc) },
                },
              } as unknown as WorldState['npcs'],
              whereabouts: { 'npc:ada': loc, 'npc:bo': loc },
            }),
            time: at,
            player: { loc, coverSuspicion: asTruth(0.1) },
            meta: { seed: String(seed), preset: { id: 'standard' } },
          } as WorldState;
          const noticed = noticeTurn(start, { kind: action, npc: 'npc:bo' });
          const before = memoryOf(noticed);
          const gossiped = commitGossip(noticed, 'npc:ada' as NpcId, 'npc:bo' as NpcId);
          const memory = memoryOf(gossiped);
          expect(Object.values(memory).some((items) => items.length > 0)).toBe(true);
          for (const [holder, items] of Object.entries(memory)) {
            for (const item of items) {
              if (item.ground.kind === 'gossip') {
                const heldThen = before[item.ground.from] ?? [];
                expect(heldThen.some((held) => held.id === item.ground.item)).toBe(true);
                continue;
              }
              expect(item.ground.event.length).toBeGreaterThan(0);
              expect(item.ground.loc).toBe(item.loc);
              const npc = gossiped.npcs[holder as NpcId];
              const placed =
                npc === undefined
                  ? undefined
                  : scheduledLocation(npc.schedule, item.at.day % 7, item.at.phase);
              const present = gossiped.whereabouts?.[holder] === item.loc;
              expect(placed === item.loc || present).toBe(true);
              expect(recollectionGrounded(item, undefined)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

const TIE_PREDICATES = new Set(['RELATED_TO', 'INVOLVED_WITH', 'OWES']);
const TIE_KINDS = ['friend', 'rival', 'creditor'] as const satisfies readonly TieKind[];

describe('Property 15: Gossip and tie containment', () => {
  // Feature: ambient-world, Property 15: Gossip and tie containment
  it('transfers only along a tie or a shared location, and only an item that was held', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0.2, max: 1, noNaN: true }),
        fc.constantFrom(...TIE_KINDS),
        fc.integer({ min: 1, max: 1_000_000 }),
        (linked, together, affinity, kind, seed) => {
          const dock = 'loc:dock' as LocId;
          const ada = 'npc:ada' as NpcId;
          const bo = 'npc:bo' as NpcId;
          const source = rec(`item-${seed}`, ada, 0.9);
          const start = {
            ...world({
              ties: linked ? [{ a: ada, b: bo, affinity, kind }] : [],
              memory: { [ada]: [source] },
              npcs: {
                [ada]: { id: ada, schedule: { entries: schedule(CAFE) } },
                [bo]: { id: bo, schedule: { entries: schedule(together ? CAFE : dock) } },
              } as unknown as WorldState['npcs'],
            }),
            meta: { seed: String(seed), preset: { id: 'standard' } },
          } as WorldState;
          const stepped = stepTies(start);
          const ties = stepped.ambient?.ties ?? [];
          const knowledge = stepped.ambient?.tieKnowledge ?? {};
          for (const held of Object.values(knowledge)) {
            for (const fact of held) {
              if (!TIE_PREDICATES.has(fact.predicate)) {
                continue;
              }
              expect(ties.some((tie) => tieProposition(tie).id === fact.id)).toBe(true);
            }
          }
          for (const tie of ties) {
            const prop = tieProposition(tie);
            expect(TIE_PREDICATES.has(prop.predicate)).toBe(true);
            for (const id of [tie.a, tie.b]) {
              expect((knowledge[id] ?? []).some((fact) => fact.id === prop.id)).toBe(true);
            }
          }
          const heldBefore = memoryOf(stepped);
          const next = stepGossip(stepped);
          for (const [holder, items] of Object.entries(memoryOf(next))) {
            for (const item of items) {
              if (item.ground.kind !== 'gossip') {
                continue;
              }
              const prior = heldBefore[item.ground.from] ?? [];
              expect(prior.some((held) => held.id === item.ground.item)).toBe(true);
              expect(eligiblePair(stepped, item.ground.from, holder as NpcId)).toBe(true);
            }
          }
          if (!linked && !together) {
            const heard = (memoryOf(next)[bo] ?? []).filter((item) => item.ground.kind === 'gossip');
            expect(heard).toEqual([]);
            expect(next.ambient?.falseBeliefs[bo] ?? []).toEqual([]);
          }
          for (const [id, beliefs] of Object.entries(next.ambient?.falseBeliefs ?? {})) {
            expect(beliefs.length).toBeGreaterThan(0);
            const heard = memoryOf(next)[id as NpcId] ?? [];
            expect(heard.some((item) => item.ground.kind === 'gossip')).toBe(true);
            for (const belief of beliefs) {
              expect(belief.id.length).toBeGreaterThan(0);
              expect(belief.predicate.length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('notice stream', () => {
  it('draws the notice coin from the caller rng', () => {
    expect(noticeCheck(1, 1, createPrng('notice'))).toBeTypeOf('boolean');
  });
});
