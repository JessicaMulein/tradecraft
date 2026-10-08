/**
 * Emergent side threads (ambient-world Req 16). A spawn is a midgame template
 * whose metric threshold is crossed, or a queued spawn-thread op whose tags
 * match. plot-library instantiates the thread. A refusal leaves the world
 * reference unchanged. The solvability gate is not run on the thread itself.
 */

import type { PlotTemplateV2 } from '@tradecraft/content';

import type { Channel } from '../city/comms.js';
import { asTruth, type ChannelId, type LocId, type NpcId, type Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { SideThreadState } from '../noise/side-threads.js';
import { createPrng } from '../prng/prng.js';
import type { BindCity } from '../plotgen/bind.js';
import { instantiateSideThread } from '../plotgen/sidethread.js';

import { ambientBudgets } from './budgets.js';
import { metricTotal } from './metrics.js';
import { requestPromotion } from './populace.js';
import { ambientKeySeed } from './streams.js';
import type { AmbientState, MetricId } from './state.js';

const THREAD_GAP_DAYS = 3;

export interface ThreadCatalogue {
  readonly templates: ReadonlyMap<string, PlotTemplateV2>;
  readonly city: BindCity;
  readonly cellMembers?: ReadonlySet<string>;
}

function isCell(world: WorldState, id: string, extra: ReadonlySet<string>): boolean {
  if (extra.has(id)) {
    return true;
  }
  const npc = world.npcs?.[id as NpcId];
  if (npc === undefined) {
    return false;
  }
  if (npc.role === 'cell' || npc.role.startsWith('cell')) {
    return true;
  }
  const org = npc.org === undefined ? undefined : world.orgs?.[npc.org];
  return org?.kind === 'cell';
}

function cellMembers(world: WorldState, extra: ReadonlySet<string>): Set<string> {
  const cell = new Set(extra);
  for (const id of Object.keys(world.npcs ?? {})) {
    if (isCell(world, id, extra)) {
      cell.add(id);
    }
  }
  return cell;
}

function eligible(world: WorldState, cell: ReadonlySet<string>): NpcId[] {
  const ids = new Set<string>();
  for (const id of Object.keys(world.npcs ?? {})) {
    if (!isCell(world, id, cell)) {
      ids.add(id);
    }
  }
  for (const id of Object.keys(world.ambient?.townsfolk ?? {})) {
    if (!cell.has(id)) {
      ids.add(id);
    }
  }
  return [...ids].sort() as NpcId[];
}

function activeEmergent(world: WorldState): number {
  const marked = world.ambient?.threadOrigins ?? {};
  let count = Object.keys(marked).length;
  for (const thread of world.sideThreads ?? []) {
    if (thread.origin !== undefined && marked[thread.id] === undefined) {
      count += 1;
    }
  }
  return count;
}

function tagsMatch(template: PlotTemplateV2, tags: readonly string[]): boolean {
  const own = template.ambient?.spawn?.tags ?? [];
  if (own.length === 0) {
    return false;
  }
  return tags.some((tag) => own.includes(tag));
}

function metricOpen(world: WorldState, template: PlotTemplateV2): boolean {
  const spawn = template.ambient?.spawn;
  const metrics = world.ambient?.metrics;
  if (spawn === undefined || metrics === undefined) {
    return false;
  }
  const id = spawn.metric as MetricId;
  if (metrics.exo[id] === undefined) {
    return false;
  }
  return metricTotal(metrics, id) >= spawn.above;
}

function candidates(world: WorldState, catalogue: ThreadCatalogue): PlotTemplateV2[] {
  const inbox = world.ambient?.inbox ?? [];
  const wanted = inbox.filter((op) => op.op === 'spawn-thread');
  const found: PlotTemplateV2[] = [];
  for (const template of catalogue.templates.values()) {
    if (template.kind !== 'side-thread') {
      continue;
    }
    const modes = template.spawn ?? ['worldgen'];
    if (!modes.includes('midgame')) {
      continue;
    }
    const named = wanted.some(
      (op) => op.op === 'spawn-thread' && (op.template === template.id || tagsMatch(template, op.tags)),
    );
    if (named || metricOpen(world, template)) {
      found.push(template);
    }
  }
  return found.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function clearSpawnOps(ambient: AmbientState): AmbientState {
  return {
    ...ambient,
    inbox: (ambient.inbox ?? []).filter((op) => op.op !== 'spawn-thread'),
  };
}

function noiseChannel(id: string, owner: NpcId, loc: LocId, at: WorldState['time']): Channel {
  return {
    id: `chan:thread/${id}` as ChannelId,
    kind: 'courier',
    owner,
    schedule: { period: 1, start: at, phase: 1 },
    route: loc,
  };
}

function proposition(thread: string, npc: NpcId, template: string): Proposition {
  return {
    id: `prop:${thread}:open`,
    subject: npc,
    predicate: 'HAS_STATUS',
    object: { kind: 'text', value: template },
  };
}

function spawnOne(world: WorldState, template: PlotTemplateV2, catalogue: ThreadCatalogue): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const day = world.time.day;
  const last = ambient.lastThreadDay;
  if (last !== undefined && day - last < THREAD_GAP_DAYS) {
    return world;
  }
  if (activeEmergent(world) >= ambientBudgets(ambient.density).emergentThreads) {
    return world;
  }
  const cell = cellMembers(world, catalogue.cellMembers ?? new Set());
  const people = eligible(world, cell);
  if (people.length === 0) {
    return world;
  }
  const chosen = people.slice(0, 3);
  const hints: Record<string, string> = {};
  const names = Object.keys(template.params);
  if (names.length === 0) {
    hints.participant = chosen[0] ?? '';
  } else {
    names.forEach((name, index) => {
      const person = chosen[index % chosen.length];
      if (person !== undefined) {
        hints[name] = person;
      }
    });
  }
  const seed = world.meta?.seed ?? 'ambient';
  const rng = createPrng(ambientKeySeed(seed, 'exo', template.id, day));
  const prior = {
    threads: (world.sideThreads ?? []).map((thread) => ({
      id: thread.id,
      templateId: thread.template,
    })),
  };
  const result = instantiateSideThread(
    prior,
    { template: template.id, mode: 'midgame', bindHints: hints, cellMembers: cell },
    catalogue.templates,
    catalogue.city,
    { id: world.meta?.preset?.id ?? 'standard', plot: { stageCount: 2, deadlineSlackDays: 1 } },
    rng,
  );
  if (!result.ok) {
    return world;
  }
  const lead = chosen[0];
  if (lead === undefined) {
    return world;
  }
  const loc = (world.player?.loc ?? 'loc:street') as LocId;
  const channel = noiseChannel(result.thread, lead, loc, world.time);
  const thread: SideThreadState = {
    id: result.thread as SideThreadState['id'],
    template: template.id,
    participants: chosen.filter((id) => !cell.has(id)),
    propositions: [proposition(result.thread, lead, template.id)],
    traces: [],
    channels: [channel],
    origin: asTruth('emergent'),
  };
  let next: WorldState = {
    ...world,
    sideThreads: [...(world.sideThreads ?? []), thread],
    ...(ambient.multiCity === true
      ? {}
      : { channels: { ...(world.channels ?? {}), [channel.id]: channel } }),
    ambient: {
      ...clearSpawnOps(ambient),
      threadOrigins: { ...(ambient.threadOrigins ?? {}), [thread.id]: 'emergent' },
      lastThreadDay: day,
      counters: { ...ambient.counters, threads: ambient.counters.threads + 1 },
    },
  };
  if (world.city?.locations !== undefined) {
    for (const id of chosen) {
      if (ambient.townsfolk[id] !== undefined) {
        next = requestPromotion(next, id, true);
      }
    }
  }
  return next;
}

/** Spawn at most one emergent thread, then drop the spawn ops either way. */
export function stepThreads(world: WorldState, catalogue?: ThreadCatalogue): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  if (catalogue === undefined) {
    if ((ambient.inbox ?? []).every((op) => op.op !== 'spawn-thread')) {
      return world;
    }
    return { ...world, ambient: clearSpawnOps(ambient) };
  }
  const queued = candidates(world, catalogue);
  if (queued.length === 0) {
    return (ambient.inbox ?? []).some((op) => op.op === 'spawn-thread')
      ? { ...world, ambient: clearSpawnOps(ambient) }
      : world;
  }
  for (const template of queued) {
    const spawned = spawnOne(world, template, catalogue);
    if (spawned !== world) {
      return spawned;
    }
  }
  return world;
}
