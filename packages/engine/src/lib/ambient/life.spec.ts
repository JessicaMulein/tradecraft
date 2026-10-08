import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { Npc, ScheduleEntry } from '../city/npc.js';
import { asTruth, revealTruth, type LocId, type NpcId, type Phase } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { runAssetTask } from '../recruit/tasking.js';
import type { Relationship } from '../recruit/asset.js';

import {
  applyLifeEvent,
  clampLeverDelta,
  dailyAgenda,
  emptyLife,
  lifeEvents,
  stepLife,
} from './life.js';
import { demote, promote } from './populace.js';
import { ambientKeySeed } from './streams.js';
import type { AmbientState, LifeDrift, Townsfolk } from './state.js';
import { introductionTrustBonus, stepTies } from './ties.js';

const HOME = 'loc:cafe' as LocId;
const AWAY = 'loc:bar' as LocId;

function npc(id: string, loc: LocId = HOME): Npc {
  const entries: ScheduleEntry[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let phase = 0; phase < 4; phase += 1) {
      entries.push({ weekday, phase: phase as Phase, loc });
    }
  }
  return {
    id: id as NpcId,
    archetype: 'civilian',
    role: 'civilian',
    trueAllegiance: asTruth({ org: 'org:cover-employer' as never }),
    apparentAllegiance: 'neutral',
    mice: asTruth({ money: 0.4, ideology: 0.4, coercion: 0.4, ego: 0.4 }),
    moneyNeed: asTruth(0.4),
    reliability: asTruth(0.5),
    tradecraft: asTruth(0.2),
    securityConsciousness: asTruth(0.2),
    persona: {
      name: id,
      given: id,
      family: 'Test',
      library: 'ambient',
      culture: 'ambient',
      gender: 'female',
      voiceTraits: [],
      mannerisms: [],
      background: 'a passer-by',
      openness: 0.5,
    },
    descriptor: { summary: 'a passer-by', phrases: [], pools: [] },
    schedule: { entries },
    wariness: 0.1,
  } as Npc;
}

function person(id: string): Townsfolk {
  return {
    id: id as NpcId,
    archetype: 'civilian',
    descriptor: 'a waiter',
    schedule: 'ambient/day-round',
    recollections: [],
    regard: { warmth: 0.2, wariness: 0.1, familiarity: 0.3 },
    informant: asTruth(false),
  };
}

describe('dailyAgenda', () => {
  it('keeps an anchor slot and otherwise prefers a life deviation', () => {
    const who = npc('npc:ada');
    const life = {
      ...emptyLife(),
      deviations: [{ untilDay: 5, weekday: 0, phase: 0 as Phase, loc: AWAY }],
    };
    const anchors = new Set([`npc:ada|0|0|${HOME}`]);
    const agenda = dailyAgenda(who, life, {}, anchors, 0);
    expect(agenda.find((entry) => entry.phase === 0)?.loc).toBe(HOME);
    const open = dailyAgenda(who, life, {}, new Set(), 0);
    expect(open.find((entry) => entry.phase === 0)?.loc).toBe(AWAY);
  });
});

describe('life events', () => {
  it('does not detain a principal', () => {
    const who = npc('npc:leader');
    const taken = lifeEvents().find((template) => template.id === 'taken-in');
    expect(taken).toBeDefined();
    const applied = applyLifeEvent(who, emptyLife(), taken!, 3, true);
    expect(applied.life.removed).toBeUndefined();
    expect(revealTruth(applied.npc.trueAllegiance)).toEqual(revealTruth(who.trueAllegiance));
    expect(applied.npc.role).toBe(who.role);
  });

  it('clamps a lever to 0.15 across any 7-day window', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -0.4, max: 0.4, noNaN: true }), { minLength: 1, maxLength: 21 }),
        (requests) => {
          let drift: LifeDrift[] = [];
          requests.forEach((requested, day) => {
            const applied = clampLeverDelta(drift, 'money', day, requested);
            drift = [
              ...drift.filter((entry) => entry.day > day - 7),
              { day, lever: 'money', amount: applied },
            ];
            const net = drift.reduce((sum, entry) => sum + entry.amount, 0);
            expect(Math.abs(net)).toBeLessThanOrEqual(0.15 + 1e-9);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('ties', () => {
  it('raises affinity when two people share a location and records the fact for both', () => {
    const world = {
      time: { day: 0, phase: 0 },
      npcs: { 'npc:ada': npc('npc:ada'), 'npc:bo': npc('npc:bo') },
      ambient: { ties: [], tieKnowledge: {} },
    } as unknown as WorldState;
    const next = stepTies(world);
    expect(next.ambient?.ties).toHaveLength(1);
    expect(next.ambient?.ties[0]?.affinity).toBeCloseTo(0.08);
    expect(next.ambient?.tieKnowledge['npc:ada' as NpcId]?.[0]?.predicate).toBe('RELATED_TO');
    expect(next.ambient?.tieKnowledge['npc:bo' as NpcId]).toHaveLength(1);
  });

  it('adds at most 0.2 trust from a tie', () => {
    expect(introductionTrustBonus(1)).toBeCloseTo(0.2);
    expect(introductionTrustBonus(0.5)).toBeCloseTo(0.1);
    const rel = { trust: 0.4, asset: { access: { locs: [], npcs: [], orgs: [] }, reliability: 0.5 } } as unknown as Relationship;
    const plain = runAssetTask(
      { kind: 'introduce', target: 'npc:bo' as NpcId },
      { rel },
      { next: () => 0, int: () => 0, bool: () => false, pick: (items: readonly string[]) => items[0], shuffle: (items: readonly string[]) => [...items], state: () => '' } as never,
    );
    const warm = runAssetTask(
      { kind: 'introduce', target: 'npc:bo' as NpcId },
      { rel, tieAffinity: 1 },
      { next: () => 0, int: () => 0, bool: () => false, pick: (items: readonly string[]) => items[0], shuffle: (items: readonly string[]) => [...items], state: () => '' } as never,
    );
    if (plain.kind === 'introduce' && warm.kind === 'introduce') {
      expect(warm.inheritedTrust - plain.inheritedTrust).toBeCloseTo(0.2);
    }
  });
});

function permute(ids: readonly string[], salt: number): string[] {
  const copy = [...ids];
  let state = salt >>> 0;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const swap = copy[i];
    copy[i] = copy[j] ?? copy[i] ?? '';
    copy[j] = swap ?? '';
  }
  return copy;
}

function lifeWorld(seed: string, day: number, ids: readonly string[]): WorldState {
  const npcs: Record<string, Npc> = {};
  for (const id of ids) {
    npcs[id] = npc(id);
  }
  return {
    time: { day, phase: 0 },
    meta: { seed },
    plot: { status: 'running', stages: [], roles: [] },
    city: { locations: { [HOME]: { id: HOME }, [AWAY]: { id: AWAY } } },
    npcs,
    ambient: {
      density: 'standard',
      life: {},
      counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
    },
  } as unknown as WorldState;
}

function draws(world: WorldState): unknown {
  return Object.keys(world.npcs)
    .sort()
    .map((id) => {
      const who = world.npcs[id as NpcId];
      return {
        id,
        life: world.ambient?.life[id as NpcId],
        mice: who === undefined ? undefined : revealTruth(who.mice),
        moneyNeed: who === undefined ? undefined : revealTruth(who.moneyNeed),
      };
    });
}

describe('Property 5: Keyed-stream independence', () => {
  // Feature: ambient-world, Property 5: Keyed-stream independence
  it('promotes the same profile on any day, whoever else was promoted first', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 6 }),
        fc.integer({ min: 1, max: 8 }),
        (seed, dayA, dayB, others, focus) => {
          const id = `npc:town-${focus}`;
          const who = person(id);
          const stream = String(seed);
          expect(ambientKeySeed(stream, 'townsfolk', id, dayA)).toBe(
            ambientKeySeed(stream, 'townsfolk', id, dayB),
          );
          const early = promote(who, stream, HOME);
          for (const other of others) {
            if (other === focus) {
              continue;
            }
            promote(person(`npc:other-${other}`), stream, HOME);
          }
          expect(promote(who, stream, HOME)).toEqual(early);

          const ids = ['npc:a', 'npc:b', 'npc:c', 'npc:d', 'npc:e', 'npc:f'];
          const forward = stepLife(lifeWorld(stream, dayA, ids));
          const shuffled = stepLife(lifeWorld(stream, dayA, permute(ids, seed)));
          expect(draws(shuffled)).toEqual(draws(forward));
        },
      ),
      { numRuns: 100 },
    );
  });
});

const DRIFT_LEVERS = ['money', 'ideology', 'coercion', 'ego', 'moneyNeed'] as const;

function windowNet(drift: readonly LifeDrift[], lever: LifeDrift['lever'], day: number): number {
  return drift
    .filter((entry) => entry.lever === lever && entry.day > day - 7 && entry.day <= day)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

describe('Property 13: Life bounds', () => {
  // Feature: ambient-world, Property 13: Life bounds
  it('keeps a 7-day drift inside 0.15 and restores a promoted profile', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 8 }),
        fc.array(
          fc.tuple(
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
          ),
          { minLength: 1, maxLength: 16 },
        ),
        (seed, warmth, wariness, familiarity, saliences, deltas) => {
          const id = `npc:town-${seed}`;
          const regard = { warmth, wariness, familiarity };
          const notes = saliences.map((salience, index) => ({ id: `rec-${index}`, salience }));
          const who = { ...person(id), regard, recollections: notes };
          const profile = promote(who, String(seed), HOME);
          const ambient = {
            townsfolk: { [who.id]: who },
            memory: asTruth({ [who.id]: notes }),
            regard: asTruth({ [who.id]: regard }),
          } as unknown as AmbientState;
          const restored = demote(profile, { ambient, npcs: {} } as unknown as WorldState);
          expect(restored.regard).toEqual(regard);
          const ranked = [...notes].sort(
            (a, b) => b.salience - a.salience || (a.id < b.id ? -1 : 1),
          );
          expect(restored.recollections.map((note) => (note as { id: string }).id)).toEqual(
            ranked.slice(0, 4).map((note) => note.id),
          );
          const repeated = promote(restored, String(seed), HOME);
          expect(repeated.persona).toEqual(profile.persona);
          expect(revealTruth(repeated.mice)).toEqual(revealTruth(profile.mice));
          expect(revealTruth(repeated.moneyNeed)).toEqual(revealTruth(profile.moneyNeed));

          let current = npc(id);
          let life = emptyLife();
          deltas.forEach(([money, ideology, coercion, ego, moneyNeed], day) => {
            const applied = applyLifeEvent(
              current,
              life,
              {
                id: 'probe',
                weight: 1,
                effects: { mice: { money, ideology, coercion, ego }, moneyNeed },
              },
              day,
              false,
            );
            current = applied.npc;
            life = applied.life;
            for (const lever of DRIFT_LEVERS) {
              expect(Math.abs(windowNet(life.drift, lever, day))).toBeLessThanOrEqual(0.15 + 1e-9);
            }
          });

          let walked = lifeWorld(String(seed), 0, [id]);
          for (let day = 0; day < 14; day += 1) {
            walked = stepLife({ ...walked, time: { day, phase: 0 } });
            const drift = walked.ambient?.life[id as NpcId]?.drift ?? [];
            for (const lever of DRIFT_LEVERS) {
              expect(Math.abs(windowNet(drift, lever, day))).toBeLessThanOrEqual(0.15 + 1e-9);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
