/**
 * Gossip and informant reports (ambient-world Req 13). A transfer goes only
 * to someone tied to the source or standing in the same place, and only an
 * item the source already holds.
 */

import { scheduledLocation } from '../city/npc.js';
import { asTruth, revealTruth, type NpcId, type Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { distortProposition } from '../recruit/asset.js';

import { ambientBudgets } from './budgets.js';
import { applyHook } from './hooks.js';
import { memoryOf, type Recollection } from './memory.js';
import { ambientPreset } from './preset.js';
import { ambientKeySeed } from './streams.js';
import { tieAffinityBetween } from './ties.js';

const TRANSFER_P = 0.3;

function placedTogether(world: WorldState, a: NpcId, b: NpcId): boolean {
  const placed = world.ambient?.spinePlacements;
  if (placed === undefined) {
    return false;
  }
  const left = placed[a];
  const right = placed[b];
  if (left === undefined || right === undefined || left.loc !== right.loc || left.city !== right.city) {
    return false;
  }
  const city = world.ambient?.cityId;
  if (city === undefined) {
    return true;
  }
  return left.city === city || left.city === `city:${city}` || city === `city:${left.city}`;
}

export function eligiblePair(world: WorldState, a: NpcId, b: NpcId): boolean {
  if (a === b) {
    return false;
  }
  if (placedTogether(world, a, b)) {
    return true;
  }
  if (tieAffinityBetween(world.ambient?.ties ?? [], a, b) !== undefined) {
    return true;
  }
  const left = world.npcs?.[a];
  const right = world.npcs?.[b];
  if (left === undefined || right === undefined) {
    return false;
  }
  const weekday = world.time.day % 7;
  for (let phase = 0; phase < 4; phase += 1) {
    const locA = scheduledLocation(left.schedule, weekday, phase as 0 | 1 | 2 | 3);
    const locB = scheduledLocation(right.schedule, weekday, phase as 0 | 1 | 2 | 3);
    if (locA !== undefined && locA === locB) {
      return true;
    }
  }
  return false;
}

function highest(recs: readonly Recollection[], rng: { pick<T>(items: readonly T[]): T }): Recollection | undefined {
  if (recs.length === 0) {
    return undefined;
  }
  const top = Math.max(...recs.map((rec) => rec.salience));
  const pool = recs.filter((rec) => rec.salience === top);
  return rng.pick(pool);
}

function asFact(rec: Recollection, holder: NpcId): Proposition {
  return {
    id: `prop:gossip:${rec.id}`,
    subject: holder,
    predicate: 'HAS_STATUS',
    object: { kind: 'text', value: rec.kind },
  };
}

/**
 * Copy one held recollection to the target. The source must already hold it.
 * `held` is the source's memory at the start of the day, so a copy made
 * earlier in this step cannot be passed on again before the day ends.
 */
export function commitGossip(
  world: WorldState,
  source: NpcId,
  target: NpcId,
  held?: readonly Recollection[],
): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined || !eligiblePair(world, source, target)) {
    return world;
  }
  const memory = { ...memoryOf(world) };
  const sourceHeld = held ?? memory[source] ?? [];
  if (sourceHeld.length === 0) {
    return world;
  }
  const seed = world.meta?.seed ?? 'ambient';
  const rng = createPrng(ambientKeySeed(seed, 'gossip', `${source}|${target}`, world.time.day));
  const item = highest(sourceHeld, rng);
  if (item === undefined) {
    return world;
  }
  const copied: Recollection = {
    ...item,
    id: `rec:${target}:gossip:${item.id}`,
    salience: Math.round(item.salience * 0.6 * 100) / 100,
    reported: false,
    ground: { kind: 'gossip', from: source, item: item.id },
  };
  const targetHeld = memory[target] ?? [];
  if (!targetHeld.some((rec) => rec.ground.kind === 'gossip' && rec.ground.item === item.id)) {
    memory[target] = [...targetHeld, copied];
  }
  const preset = ambientPreset(world.meta?.preset?.id ?? 'standard');
  const fact = asFact(item, source);
  const others = (Object.keys(world.npcs ?? {}) as NpcId[]).filter((id) => id !== source);
  const distorted = rng.bool(preset.gossipDistortion);
  const belief = distorted
    ? distortProposition(fact, { npcs: others, locs: [], orgs: [] }, rng)
    : fact;
  const falseBeliefs = { ...ambient.falseBeliefs };
  if (distorted) {
    const prior = falseBeliefs[target] ?? [];
    falseBeliefs[target] = prior.some((prop) => prop.id === belief.id) ? prior : [...prior, belief];
  }
  return {
    ...world,
    ambient: { ...ambient, memory: asTruth(memory), falseBeliefs },
  };
}

function informantsOf(world: WorldState): { id: NpcId; handler: 'police' | 'hostile' }[] {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return [];
  }
  const found = new Map<NpcId, 'police' | 'hostile'>();
  for (const [id, handler] of Object.entries(revealTruth(ambient.informants))) {
    found.set(id as NpcId, handler);
  }
  for (const person of Object.values(ambient.townsfolk)) {
    const handler = revealTruth(person.informant);
    if (handler !== false) {
      found.set(person.id, handler);
    }
  }
  return [...found.entries()]
    .map(([id, handler]) => ({ id, handler }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function reportInformants(world: WorldState): WorldState {
  let next = world;
  const ambient = next.ambient;
  if (ambient === undefined) {
    return world;
  }
  const preset = ambientPreset(next.meta?.preset?.id ?? 'standard');
  const memory = { ...memoryOf(next) };
  for (const informant of informantsOf(next)) {
    for (const rec of memory[informant.id] ?? []) {
      if (!rec.aboutPlayer || rec.reported === true) {
        continue;
      }
      const reported = applyHook(next, {
        kind: 'informant-report',
        informant: informant.id,
        handler: informant.handler,
        ...(rec.with !== undefined ? { seenWith: rec.with } : {}),
      });
      next = reported.next;
      if (rec.kind === 'seen-with' && rec.with !== undefined) {
        const bonus = applyHook(next, {
          kind: 'detection-bonus',
          npc: rec.with,
          bonus: preset.informantBonus,
        });
        next = bonus.next;
      }
      const marked = (memory[informant.id] ?? []).map((item) =>
        item.id === rec.id ? { ...item, reported: true } : item,
      );
      memory[informant.id] = marked;
    }
  }
  if (next.ambient === undefined) {
    return next;
  }
  return { ...next, ambient: { ...next.ambient, memory: asTruth(memory) } };
}

export function stepGossip(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const cap = ambientBudgets(ambient.density).gossipPerDay;
  const baseline = memoryOf(world);
  const ids = (Object.keys(world.npcs ?? {}) as NpcId[]).sort();
  const pairs: { source: NpcId; target: NpcId }[] = [];
  for (const source of ids) {
    for (const target of ids) {
      if (eligiblePair(world, source, target)) {
        pairs.push({ source, target });
      }
    }
  }
  pairs.sort((a, b) => `${a.source}|${a.target}`.localeCompare(`${b.source}|${b.target}`));
  let next = world;
  let transfers = 0;
  const seed = world.meta?.seed ?? 'ambient';
  for (const pair of pairs) {
    if (transfers >= cap) {
      break;
    }
    const live = next.ambient;
    if (live === undefined) {
      break;
    }
    const affinity = tieAffinityBetween(live.ties, pair.source, pair.target) ?? 0.3;
    const rng = createPrng(ambientKeySeed(seed, 'gossip', `${pair.source}|${pair.target}`, world.time.day));
    if (!rng.bool(Math.min(1, TRANSFER_P * affinity))) {
      continue;
    }
    const transferred = commitGossip(next, pair.source, pair.target, baseline[pair.source] ?? []);
    if (transferred !== next) {
      next = transferred;
      transfers += 1;
    }
  }
  next = reportInformants(next);
  if (next.ambient === undefined) {
    return next;
  }
  return {
    ...next,
    ambient: { ...next.ambient, counters: { ...next.ambient.counters, gossip: transfers } },
  };
}
