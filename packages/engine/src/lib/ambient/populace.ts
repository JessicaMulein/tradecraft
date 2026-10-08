/**
 * Townsfolk promotion (ambient-world Req 11). A promoted profile is drawn only
 * from the townsfolk stream keyed by that person's id, so the day and the
 * other promotions do not change it.
 */

import type { Npc, ScheduleEntry } from '../city/npc.js';
import {
  asTruth,
  revealTruth,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';

import { ambientBudgets } from './budgets.js';
import { ambientKeySeed } from './streams.js';
import type { Townsfolk } from './state.js';

const GIVEN = ['Anna', 'Marta', 'Josef', 'Karl', 'Eva', 'Pavel'] as const;
const FAMILY = ['Novak', 'Horak', 'Berger', 'Keller', 'Weiss', 'Meier'] as const;

export interface RecollectionNote {
  readonly id: string;
  readonly salience: number;
}

function homeOf(world: WorldState): LocId {
  const ids = Object.keys(world.city.locations).sort();
  return (ids[0] ?? 'loc:street') as LocId;
}

function scheduleAt(loc: LocId): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    entries.push({ weekday, phase: 1 as Phase, loc });
  }
  return entries;
}

/** Full profile for one townsfolk id. Ignores the day and every other id. */
export function promote(person: Townsfolk, seed: string, home: LocId): Npc {
  const rng = createPrng(ambientKeySeed(seed, 'townsfolk', person.id));
  const gender = rng.bool() ? 'female' : 'male';
  const given = GIVEN[rng.int(0, GIVEN.length - 1)] ?? 'Anna';
  const family = FAMILY[rng.int(0, FAMILY.length - 1)] ?? 'Novak';
  const mice = {
    money: Math.round(rng.next() * 100) / 100,
    ideology: Math.round(rng.next() * 100) / 100,
    coercion: Math.round(rng.next() * 100) / 100,
    ego: Math.round(rng.next() * 100) / 100,
  };
  return {
    id: person.id,
    archetype: person.archetype,
    role: 'civilian',
    trueAllegiance: asTruth({ org: 'org:cover-employer' as OrgId }),
    apparentAllegiance: 'neutral',
    mice: asTruth(mice),
    moneyNeed: asTruth(Math.round(rng.next() * 100) / 100),
    reliability: asTruth(0.5),
    tradecraft: asTruth(0.2),
    securityConsciousness: asTruth(0.2),
    status: asTruth('active'),
    persona: {
      name: `${given} ${family}`,
      given,
      family,
      library: 'ambient',
      culture: 'ambient',
      gender,
      voiceTraits: [],
      mannerisms: [],
      background: person.descriptor,
      openness: Math.round(rng.next() * 100) / 100,
    },
    descriptor: { summary: person.descriptor, phrases: [person.descriptor], pools: [] },
    schedule: { entries: scheduleAt(home) },
    wariness: person.regard.wariness,
  };
}

function notesOf(value: readonly unknown[]): RecollectionNote[] {
  const notes: RecollectionNote[] = [];
  for (const item of value) {
    if (item !== null && typeof item === 'object' && 'id' in item && 'salience' in item) {
      const note = item as RecollectionNote;
      notes.push({ id: String(note.id), salience: note.salience });
    }
  }
  return notes;
}

/** Keep regard and the four most salient recollections. */
export function demote(npc: Npc, world: WorldState): Townsfolk {
  const ambient = world.ambient;
  const prior = ambient?.townsfolk[npc.id];
  const remembered = revealTruth(
    ambient?.memory ?? asTruth({} as Readonly<Record<NpcId, readonly unknown[]>>),
  )[npc.id];
  const fromMemory = notesOf(remembered ?? []);
  const fromTown = notesOf(prior?.recollections ?? []);
  const byId = new Map<string, RecollectionNote>();
  for (const note of [...fromMemory, ...fromTown]) {
    const priorNote = byId.get(note.id);
    if (priorNote === undefined || note.salience > priorNote.salience) {
      byId.set(note.id, note);
    }
  }
  const recollections = [...byId.values()]
    .sort((a, b) => b.salience - a.salience || (a.id < b.id ? -1 : 1))
    .slice(0, 4);
  const regardRecord = revealTruth(
    ambient?.regard ?? asTruth({} as Readonly<Record<NpcId, unknown>>),
  )[npc.id];
  const regard =
    regardRecord !== null && typeof regardRecord === 'object' && 'warmth' in regardRecord
      ? (regardRecord as Townsfolk['regard'])
      : (prior?.regard ?? { warmth: 0, wariness: npc.wariness, familiarity: 0 });
  return {
    id: npc.id,
    archetype: npc.archetype,
    descriptor: prior?.descriptor ?? npc.descriptor.summary,
    schedule: prior?.schedule ?? 'ambient/day-round',
    recollections,
    regard,
    informant: prior?.informant ?? asTruth(false),
  };
}

function isPromotedTownsfolk(id: string): boolean {
  return id.startsWith('npc:town-');
}

function oldestPromoted(world: WorldState): NpcId | undefined {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return undefined;
  }
  const ids = (Object.keys(world.npcs) as NpcId[])
    .filter((id) => isPromotedTownsfolk(id))
    .sort((a, b) => {
      const dayA = typeof ambient.lastInteraction[a] === 'number' ? ambient.lastInteraction[a] : -1;
      const dayB = typeof ambient.lastInteraction[b] === 'number' ? ambient.lastInteraction[b] : -1;
      if (dayA !== dayB) {
        return dayA - dayB;
      }
      return a < b ? -1 : 1;
    });
  return ids[0];
}

function promoteNow(world: WorldState, id: NpcId): WorldState {
  const ambient = world.ambient;
  const person = ambient?.townsfolk[id];
  if (ambient === undefined || person === undefined || world.npcs[id] !== undefined) {
    return world;
  }
  const cap = ambientBudgets(ambient.density).fullTier;
  let next = world;
  if (Object.keys(next.npcs).length >= cap) {
    const drop = oldestPromoted(next);
    if (drop === undefined) {
      return world;
    }
    const npc = next.npcs[drop];
    if (npc === undefined) {
      return world;
    }
    const restored = demote(npc, next);
    const npcs = { ...next.npcs };
    delete npcs[drop];
    next = {
      ...next,
      npcs,
      ambient: {
        ...ambient,
        townsfolk: { ...ambient.townsfolk, [drop]: restored },
        tier: { ...ambient.tier, [drop]: 'coarse' },
      },
    };
  }
  const live = next.ambient;
  if (live === undefined) {
    return world;
  }
  const npc = promote(person, next.meta?.seed ?? 'ambient', homeOf(next));
  const townsfolk = { ...live.townsfolk };
  delete townsfolk[id];
  const queue = live.promotionQueue.filter((queued) => queued !== id);
  return {
    ...next,
    npcs: { ...next.npcs, [id]: npc },
    ambient: {
      ...live,
      townsfolk,
      promotionQueue: queue,
      tier: { ...live.tier, [id]: 'full' },
      regard: asTruth({ ...revealTruth(live.regard), [id]: person.regard }),
      lastInteraction: { ...live.lastInteraction, [id]: next.time.day },
      counters: { ...live.counters, promotions: live.counters.promotions + 1 },
    },
  };
}

/**
 * Ask to promote a townsfolk NPC. Talk and approach jump the queue. The daily
 * cap is 3; a full tier of 48 demotes the promoted NPC left alone the longest.
 */
export function requestPromotion(world: WorldState, id: NpcId, priority: boolean): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined || ambient.townsfolk[id] === undefined || world.npcs[id] !== undefined) {
    return world;
  }
  const cap = ambientBudgets(ambient.density).promotionsPerDay;
  if (ambient.counters.promotions >= cap) {
    const queue = ambient.promotionQueue.filter((queued) => queued !== id);
    return {
      ...world,
      ambient: {
        ...ambient,
        promotionQueue: priority ? [id, ...queue] : [...queue, id],
      },
    };
  }
  return promoteNow(world, id);
}

/** Serve queued promotions, talk and approach first, up to the daily cap. */
export function stepPopulace(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  let next = world;
  const cap = ambientBudgets(ambient.density).promotionsPerDay;
  for (const id of ambient.promotionQueue) {
    if ((next.ambient?.counters.promotions ?? cap) >= cap) {
      break;
    }
    next = promoteNow(next, id);
  }
  return next;
}
