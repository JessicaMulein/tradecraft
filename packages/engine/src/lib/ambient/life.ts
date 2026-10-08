/**
 * NPC life (ambient-world Req 9). Agendas layer plot traces, obligations,
 * event overrides and life deviations over the base schedule, and never move
 * an anchor slot. Life events may nudge MICE and money need, and they leave
 * allegiance, membership and plot roles alone.
 */

import { scheduledLocation, type Npc, type NpcSchedule, type ScheduleEntry } from '../city/npc.js';
import { asTruth, revealTruth, type LocId, type NpcId, type Phase, type Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { MICE_LEVERS, type MiceLever } from '../recruit/asset.js';

import { ambientCatalogue } from './catalogue.js';
import { ambientBudgets } from './budgets.js';
import { ambientKeySeed } from './streams.js';
import { anchorKey } from './solvability.js';
import type { LifeDrift, LifeState } from './state.js';

export interface LifeEventTemplate {
  readonly id: string;
  readonly weight: number;
  readonly excludeFor?: readonly ('principal')[];
  readonly effects: {
    readonly needs?: Partial<LifeState['needs']>;
    readonly mood?: number;
    readonly work?: LifeState['work'];
    readonly mice?: Partial<Record<MiceLever, number>>;
    readonly moneyNeed?: number;
    readonly deviateDays?: number;
    readonly remove?: boolean;
    readonly detain?: boolean;
    readonly death?: boolean;
  };
}

const BUILTIN_LIFE_EVENTS: readonly LifeEventTemplate[] = [
  {
    id: 'debt',
    weight: 1,
    effects: { needs: { money: -0.1 }, moneyNeed: 0.05 },
  },
  {
    id: 'illness',
    weight: 1,
    effects: { work: 'sick', mood: -0.1 },
  },
  {
    id: 'windfall',
    weight: 1,
    effects: { mice: { money: 0.05 }, needs: { money: 0.1 } },
  },
  {
    id: 'taken-in',
    weight: 1,
    excludeFor: ['principal'],
    effects: { detain: true },
  },
];

/** Pack life events, or the built-in list when the pack file is missing. */
export function lifeEvents(): readonly LifeEventTemplate[] {
  const loaded = ambientCatalogue().lifeEvents;
  return loaded.length === 0 ? BUILTIN_LIFE_EVENTS : loaded;
}

const DRIFT_CAP = 0.15;

export function emptyLife(): LifeState {
  return {
    needs: { money: 0.5, social: 0.5, work: 0.5 },
    mood: 0.5,
    work: 'employed',
    deviations: [],
    drift: [],
    facts: [],
  };
}

export function isPrincipalNpc(world: WorldState, id: string): boolean {
  if (world.plot?.leader !== undefined && revealTruth(world.plot.leader) === id) {
    return true;
  }
  return world.plot?.roles?.some((role) => role.npc === id) ?? false;
}

/** Net change still allowed for one lever inside the 7-day window ending at `day`. */
export function clampLeverDelta(
  drift: readonly LifeDrift[],
  lever: LifeDrift['lever'],
  day: number,
  requested: number,
): number {
  const net = drift
    .filter((entry) => entry.lever === lever && entry.day > day - 7 && entry.day <= day)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const roomMin = -DRIFT_CAP - net;
  const roomMax = DRIFT_CAP - net;
  return Math.min(roomMax, Math.max(roomMin, requested));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fact(npc: NpcId, templateId: string, day: number): Proposition {
  return {
    id: `prop:life:${npc}:${templateId}:${day}`,
    subject: npc,
    predicate: 'HAS_STATUS',
    object: { kind: 'text', value: templateId },
  };
}

export function applyLifeEvent(
  npc: Npc,
  life: LifeState,
  template: LifeEventTemplate,
  day: number,
  principal: boolean,
  deviateTo?: LocId,
): { readonly npc: Npc; readonly life: LifeState } {
  if (principal && template.excludeFor?.includes('principal')) {
    return { npc, life };
  }
  const effects = template.effects;
  if (principal && (effects.remove === true || effects.detain === true || effects.death === true)) {
    return { npc, life };
  }
  let drift = life.drift.filter((entry) => entry.day > day - 7);
  let nextNpc = npc;
  const miceDelta = effects.mice;
  const moneyDelta = effects.moneyNeed;
  if (miceDelta !== undefined || moneyDelta !== undefined) {
    const current = revealTruth(npc.mice);
    const nextMice = { ...current };
    for (const lever of MICE_LEVERS) {
      const requested = miceDelta?.[lever];
      if (requested === undefined || requested === 0) {
        continue;
      }
      const applied = clampLeverDelta(drift, lever, day, requested);
      if (applied === 0) {
        continue;
      }
      nextMice[lever] = clamp01(current[lever] + applied);
      drift = [...drift, { day, lever, amount: applied }];
    }
    let moneyNeed = revealTruth(npc.moneyNeed);
    if (moneyDelta !== undefined && moneyDelta !== 0) {
      const applied = clampLeverDelta(drift, 'moneyNeed', day, moneyDelta);
      if (applied !== 0) {
        moneyNeed = clamp01(moneyNeed + applied);
        drift = [...drift, { day, lever: 'moneyNeed', amount: applied }];
      }
    }
    nextNpc = { ...npc, mice: asTruth(nextMice), moneyNeed: asTruth(moneyNeed) };
  }
  const needs = { ...life.needs };
  if (effects.needs !== undefined) {
    for (const key of ['money', 'social', 'work'] as const) {
      const delta = effects.needs[key];
      if (delta !== undefined) {
        needs[key] = clamp01(needs[key] + delta);
      }
    }
  }
  const weekday = day % 7;
  const deviations =
    effects.deviateDays !== undefined && deviateTo !== undefined
      ? [
          ...life.deviations,
          { untilDay: day + effects.deviateDays, weekday, phase: 0 as Phase, loc: deviateTo },
        ]
      : life.deviations;
  let removed = life.removed;
  if (effects.detain === true) {
    removed = 'detained';
  } else if (effects.death === true) {
    removed = 'dead';
  } else if (effects.remove === true) {
    removed = 'removed';
  }
  return {
    npc: nextNpc,
    life: {
      ...life,
      needs,
      mood: clamp01(life.mood + (effects.mood ?? 0)),
      work: effects.work ?? life.work,
      lastLifeEvent: day,
      deviations,
      drift,
      removed,
      facts: [...life.facts, fact(npc.id, template.id, day)],
    },
  };
}

function weightedPick(rng: Prng, templates: readonly LifeEventTemplate[]): LifeEventTemplate | undefined {
  const total = templates.reduce((sum, template) => sum + template.weight, 0);
  if (templates.length === 0 || total <= 0) {
    return undefined;
  }
  let roll = rng.next() * total;
  for (const template of templates) {
    roll -= template.weight;
    if (roll < 0) {
      return template;
    }
  }
  return templates[templates.length - 1];
}

function protectedSnapshot(world: WorldState): string {
  const people = Object.keys(world.npcs ?? {})
    .sort()
    .map((id) => {
      const npc = world.npcs[id as NpcId];
      return {
        id,
        trueAllegiance: npc === undefined ? undefined : revealTruth(npc.trueAllegiance),
        apparentAllegiance: npc?.apparentAllegiance,
        org: npc?.org,
        role: npc?.role,
      };
    });
  return JSON.stringify({
    people,
    roles: world.plot?.roles,
    leader: world.plot?.leader === undefined ? undefined : revealTruth(world.plot.leader),
    orgs: world.orgs,
  });
}

/**
 * One day's agenda. Earlier layers win. A slot whose base location is an
 * anchor keeps that location.
 */
export function dailyAgenda(
  npc: { readonly id: string; readonly schedule: NpcSchedule },
  life: LifeState,
  layers: {
    readonly plot?: readonly ScheduleEntry[];
    readonly obligations?: readonly ScheduleEntry[];
    readonly overrides?: readonly ScheduleEntry[];
  },
  anchors: ReadonlySet<string>,
  day: number,
): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  const weekday = day % 7;
  for (let phase = 0; phase < 4; phase += 1) {
    const base = scheduledLocation(npc.schedule, weekday, phase as Phase);
    if (base !== undefined && anchors.has(anchorKey(npc.id, weekday, phase, base))) {
      entries.push({ weekday, phase: phase as Phase, loc: base });
      continue;
    }
    const loc =
      slot(layers.plot, weekday, phase) ??
      slot(layers.obligations, weekday, phase) ??
      slot(layers.overrides, weekday, phase) ??
      slot(
        life.deviations
          .filter((deviation) => deviation.untilDay > day)
          .map((deviation) => ({ weekday: deviation.weekday, phase: deviation.phase, loc: deviation.loc })),
        weekday,
        phase,
      ) ??
      base;
    if (loc !== undefined) {
      entries.push({ weekday, phase: phase as Phase, loc });
    }
  }
  return entries;
}

function slot(
  entries: readonly ScheduleEntry[] | undefined,
  weekday: number,
  phase: number,
): LocId | undefined {
  return entries?.find((entry) => entry.weekday === weekday && entry.phase === phase)?.loc;
}

export function stepLife(world: WorldState, templates: readonly LifeEventTemplate[] = lifeEvents()): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const before = protectedSnapshot(world);
  const seed = world.meta?.seed ?? 'ambient';
  const day = world.time.day;
  const cap = ambientBudgets(ambient.density).lifeEventsPerDay;
  const ids = (Object.keys(world.npcs ?? {}) as NpcId[]).sort();
  const life = { ...ambient.life };
  const npcs = { ...world.npcs };
  const drawn: { id: NpcId; template: LifeEventTemplate }[] = [];
  for (const id of ids) {
    const npc = npcs[id];
    if (npc === undefined) {
      continue;
    }
    const current = life[id] ?? emptyLife();
    if (current.lastLifeEvent !== undefined && day - current.lastLifeEvent < 7) {
      life[id] = current;
      continue;
    }
    const principal = isPrincipalNpc(world, id);
    const eligible = templates.filter(
      (template) => !(principal && template.excludeFor?.includes('principal')),
    );
    const rng = createPrng(ambientKeySeed(seed, 'life', id, day));
    if (!rng.bool(0.5)) {
      life[id] = current;
      continue;
    }
    const template = weightedPick(rng, eligible);
    if (template !== undefined) {
      drawn.push({ id, template });
    }
    life[id] = current;
  }
  drawn.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const locations = Object.keys(world.city.locations).sort();
  for (const chosen of drawn.slice(0, cap)) {
    const npc = npcs[chosen.id];
    const current = life[chosen.id];
    if (npc === undefined || current === undefined) {
      continue;
    }
    const home = npc.schedule.entries[0]?.loc;
    const deviateTo = locations.find((loc) => loc !== home) as LocId | undefined;
    const applied = applyLifeEvent(
      npc,
      current,
      chosen.template,
      day,
      isPrincipalNpc(world, chosen.id),
      deviateTo,
    );
    npcs[chosen.id] = applied.npc;
    life[chosen.id] = applied.life;
  }
  const next: WorldState = {
    ...world,
    npcs,
    ambient: {
      ...ambient,
      life,
      counters: { ...ambient.counters, lifeEvents: Math.min(drawn.length, cap) },
    },
  };
  if (protectedSnapshot(next) !== before) {
    throw new Error('life step changed allegiance, membership or plot roles');
  }
  return next;
}
