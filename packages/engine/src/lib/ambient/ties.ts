/**
 * NPC ties (ambient-world Req 10). Co-presence raises affinity, a day apart
 * lowers it, and a tie that forms or ends records RELATED_TO, INVOLVED_WITH
 * or OWES for both people.
 */

import { scheduledLocation } from '../city/npc.js';
import type { NpcId, Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';

import type { NpcTie, TieKind } from './state.js';

const PRESENCE_GAIN = 0.02;
const DAILY_DECAY = 0.01;
const DEGREE_CAP = 8;

export function introductionTrustBonus(affinity: number): number {
  return Math.min(0.2, Math.max(0, affinity) * 0.2);
}

export function tieAffinityBetween(ties: readonly NpcTie[], a: string, b: string): number | undefined {
  const found = ties.find((tie) => (tie.a === a && tie.b === b) || (tie.a === b && tie.b === a));
  return found?.affinity;
}

function kindOf(tie: NpcTie): TieKind {
  return tie.kind ?? 'friend';
}

function predicateFor(kind: TieKind): string {
  if (kind === 'creditor') {
    return 'OWES';
  }
  if (kind === 'rival') {
    return 'INVOLVED_WITH';
  }
  return 'RELATED_TO';
}

export function tieProposition(tie: NpcTie): Proposition {
  const kind = kindOf(tie);
  return {
    id: tie.prop ?? `prop:tie:${tie.a}:${tie.b}`,
    subject: tie.a,
    predicate: predicateFor(kind),
    object: tie.b,
  };
}

function degree(ties: readonly NpcTie[], id: NpcId): number {
  return ties.filter((tie) => tie.a === id || tie.b === id).length;
}

function sharedPhases(world: WorldState, a: NpcId, b: NpcId, day: number): number {
  const left = world.npcs[a];
  const right = world.npcs[b];
  if (left === undefined || right === undefined) {
    return 0;
  }
  const weekday = day % 7;
  let shared = 0;
  for (let phase = 0; phase < 4; phase += 1) {
    const locA = scheduledLocation(left.schedule, weekday, phase as 0 | 1 | 2 | 3);
    const locB = scheduledLocation(right.schedule, weekday, phase as 0 | 1 | 2 | 3);
    if (locA !== undefined && locA === locB) {
      shared += 1;
    }
  }
  return shared;
}

function withKnowledge(
  knowledge: Readonly<Record<NpcId, readonly Proposition[]>>,
  tie: NpcTie,
  present: boolean,
): Record<NpcId, readonly Proposition[]> {
  const prop = tieProposition(tie);
  const next = { ...knowledge };
  for (const id of [tie.a, tie.b]) {
    const held = (next[id] ?? []).filter((fact) => fact.id !== prop.id);
    next[id] = present ? [...held, prop] : held;
  }
  return next;
}

export function stepTies(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const ids = (Object.keys(world.npcs ?? {}) as NpcId[]).sort();
  let ties: NpcTie[] = ambient.ties.map((tie) => ({
    ...tie,
    prop: tie.prop ?? `prop:tie:${tie.a}:${tie.b}`,
  }));
  let knowledge = { ...ambient.tieKnowledge };
  const seen = new Set(ties.map((tie) => `${tie.a}|${tie.b}`));
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      const shared = sharedPhases(world, a, b, world.time.day);
      const index = ties.findIndex((tie) => (tie.a === a && tie.b === b) || (tie.a === b && tie.b === a));
      if (index >= 0) {
        const current = ties[index];
        if (current === undefined) {
          continue;
        }
        const affinity =
          shared > 0
            ? Math.min(1, current.affinity + PRESENCE_GAIN * shared)
            : Math.max(0, current.affinity - DAILY_DECAY);
        if (affinity <= 0) {
          knowledge = withKnowledge(knowledge, current, false);
          ties = ties.filter((_, at) => at !== index);
          seen.delete(`${current.a}|${current.b}`);
        } else {
          const next = { ...current, affinity: Math.round(affinity * 100) / 100 };
          ties = ties.map((tie, at) => (at === index ? next : tie));
          knowledge = withKnowledge(knowledge, next, true);
        }
        continue;
      }
      if (shared === 0 || degree(ties, a) >= DEGREE_CAP || degree(ties, b) >= DEGREE_CAP) {
        continue;
      }
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key) || seen.has(`${a}|${b}`) || seen.has(`${b}|${a}`)) {
        continue;
      }
      const formed: NpcTie = {
        a,
        b,
        kind: 'friend',
        affinity: Math.round(PRESENCE_GAIN * shared * 100) / 100,
        prop: `prop:tie:${a}:${b}`,
      };
      ties = [...ties, formed];
      seen.add(`${a}|${b}`);
      knowledge = withKnowledge(knowledge, formed, true);
    }
  }
  return { ...world, ambient: { ...ambient, ties, tieKnowledge: knowledge } };
}
