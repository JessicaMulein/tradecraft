/**
 * Stage effects the day tick runs: every authored op, structural changes
 * through the solvability gate, and ambient hooks through the hook gateway.
 *
 * A footprint that misses every anchor is accepted. A hit re-checks the
 * witnesses stored on the gate (single-city) or the regional graph
 * (multi-city). The change is kept only when the solvable set is still
 * covered. With no stored witnesses the hit is rejected and the template
 * fallback is applied when one is declared.
 */

import { enginePhaseOf, type ContentPhase } from '../city/time-mapping.js';
import type { LocId, NpcId, Phase } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';

import { ambientBudgets } from './budgets.js';
import { ambientCatalogue, type AuthorOp, type NpcPick } from './catalogue.js';
import { applyStageOps, electionDelta, type ResolvedOp } from './events.js';
import { applyHook, type AmbientHook } from './hooks.js';
import { emptyLife, isPrincipalNpc } from './life.js';
import { routeKey, type Overlay } from './locations.js';
import type { AmbientInboxOp, AmbientState, Metrics } from './state.js';
import {
  applyRegionalChange,
  graphFromWitnesses,
  regionGraphFor,
  verifyRegion,
  type RegionGraph,
} from '../region/verify.js';
import {
  gate,
  storedWitnesses,
  witnessMap,
  type AnchorSource,
  type GateCache,
  type StructuralChange,
} from './solvability.js';
import { ambientKeySeed } from './streams.js';

const CONTENT_PHASES = new Set<string>([
  'early-morning',
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
  'late-night',
  'dead-of-night',
]);

const ROUTE_DAYS = 2;

export interface StageCommit {
  readonly world: WorldState;
  readonly inbox: readonly AmbientInboxOp[];
  readonly pending: readonly string[];
  readonly election?: 'government' | 'opposition';
}

/** Bind one stage, gate structural changes, and run hooks. */
export function commitStage(args: {
  readonly world: WorldState;
  readonly eventId: string;
  readonly className: 'exogenous' | 'reactive';
  readonly category: string;
  readonly stageDay: number | 'last';
  readonly templateId: string;
  readonly ops: readonly AuthorOp[];
  readonly metrics: Metrics;
  readonly overlays: readonly Overlay[];
  readonly fallback?: AuthorOp;
}): StageCommit {
  const ambient = args.world.ambient;
  if (ambient === undefined) {
    return { world: args.world, inbox: [], pending: [] };
  }
  let world = args.world;
  let metrics = args.metrics;
  let overlays = [...args.overlays];
  const inbox: AmbientInboxOp[] = [];
  const pending: string[] = [];
  const fallback = args.fallback ?? ambientCatalogue().fallbacks.get(args.templateId);
  let election: 'government' | 'opposition' | undefined;
  const ops = [...args.ops];
  if (args.category === 'election' && args.stageDay === 'last') {
    const drawn = electionDelta(
      createPrng(ambientKeySeed(world.meta.seed, 'exo', `${args.eventId}:election`, world.time.day)),
    );
    election = drawn.winner;
    ops.push({ op: 'metric-delta', metric: 'unrest', delta: drawn.unrest });
  }

  const resolved: ResolvedOp[] = [];
  for (const op of ops) {
    const bound = bindOne(world, args.eventId, op);
    for (const item of bound.inbox) {
      inbox.push(item);
    }
    for (const item of bound.hooks) {
      const gated = item.change === undefined ? undefined : admit(world, item.change, undefined);
      if (gated !== undefined) {
        world = gated.world;
        if (!gated.accept) {
          pending.push(`gate-reject:${item.hook.kind}`);
          continue;
        }
      }
      const result = applyHook(sync(world, metrics, overlays), item.hook);
      world = result.next;
      metrics = world.ambient?.metrics ?? metrics;
      overlays = [...(world.ambient?.overlays ?? overlays)];
    }
    for (const item of bound.structural) {
      const gated = admit(world, item.change, fallback);
      world = gated.world;
      if (!gated.accept) {
        pending.push(`gate-reject:${item.op.op}`);
        if (gated.fallback !== undefined && gated.fallback !== op) {
          const substitute = bindOne(world, args.eventId, gated.fallback);
          resolved.push(...substitute.resolved);
          inbox.push(...substitute.inbox);
        }
        continue;
      }
      if (item.life !== undefined) {
        world = item.life(world);
      } else {
        resolved.push(item.op);
      }
    }
    resolved.push(...bound.resolved);
  }

  const applied = applyStageOps({
    eventId: args.eventId,
    day: world.time.day,
    className: args.className,
    ops: resolved,
    metrics,
    overlays,
    admit: () => 'accept',
  });
  world = sync(world, applied.metrics, applied.overlays);
  return {
    world,
    inbox,
    pending: [...pending, ...applied.pending],
    ...(election === undefined ? {} : { election }),
  };
}

interface Bound {
  readonly resolved: ResolvedOp[];
  readonly inbox: AmbientInboxOp[];
  readonly hooks: { readonly hook: AmbientHook; readonly change?: StructuralChange }[];
  readonly structural: {
    readonly op: ResolvedOp;
    readonly change: StructuralChange;
    readonly life?: (world: WorldState) => WorldState;
  }[];
}

function bindOne(world: WorldState, eventId: string, op: AuthorOp): Bound {
  const resolved: ResolvedOp[] = [];
  const inbox: AmbientInboxOp[] = [];
  const hooks: Bound['hooks'] = [];
  const structural: Bound['structural'] = [];
  if (op.op === 'metric-delta') {
    resolved.push(op);
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'news-development' || op.op === 'spawn-thread') {
    inbox.push(op);
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'curfew') {
    resolved.push({ op: 'curfew', target: 'city', phases: op.phases, days: ROUTE_DAYS });
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'ambient-hook') {
    const hook = hookOf(world, op);
    if (hook !== undefined) {
      hooks.push({
        hook,
        ...(hook.kind === 'channel-outage' ? { change: { kind: 'channel-outage' as const, channel: hook.channel } } : {}),
      });
    }
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'detain-npc' || op.op === 'npc-schedule-override') {
    const person = pickPerson(world, eventId, op.op === 'detain-npc' ? op.who : op.who);
    if (person === undefined) {
      return { resolved, inbox, hooks, structural };
    }
    if (op.op === 'detain-npc') {
      structural.push({
        op: { op: 'detain-npc', npc: person, days: op.days },
        change: { kind: 'detain-npc', npc: person },
        life: (current) => withLife(current, person, { removed: 'detained' }),
      });
      return { resolved, inbox, hooks, structural };
    }
    const loc = pickLoc(world, eventId, op.query);
    if (loc === undefined) {
      return { resolved, inbox, hooks, structural };
    }
    const phases = enginePhases(op.phases);
    structural.push({
      op: { op: 'npc-schedule-override', npc: person, target: loc },
      change: { kind: 'schedule-override', npc: person, phases, loc },
      life: (current) => deviate(current, person, loc, phases),
    });
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'route-closure' || op.op === 'route-checkpoint') {
    const route = pickRoute(world, eventId, op.query);
    if (route === undefined) {
      return { resolved, inbox, hooks, structural };
    }
    const target = routeKey(route.a, route.b);
    if (op.op === 'route-closure') {
      structural.push({
        op: { op: 'route-closure', target, days: ROUTE_DAYS },
        change: { kind: 'route-closure', a: route.a, b: route.b },
      });
    } else {
      resolved.push({
        op: 'route-checkpoint',
        target,
        detection: op.detection,
        coverRisk: op.coverRisk,
        days: ROUTE_DAYS,
      });
    }
    return { resolved, inbox, hooks, structural };
  }
  const query = op.query;
  const loc = pickLoc(world, eventId, query);
  if (loc === undefined) {
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'post-notice') {
    const text = ambientCatalogue().notices.get(op.template);
    inbox.push({
      op: 'post-notice',
      template: op.template,
      target: loc,
      title: text?.title ?? op.template,
      body: text?.body ?? op.template,
      days: ROUTE_DAYS,
    });
    return { resolved, inbox, hooks, structural };
  }
  if (op.op === 'location-status') {
    const resolvedOp: ResolvedOp = { op: 'location-status', target: loc, status: op.status, days: op.days };
    if (op.status === 'open' || op.status === 'newly-opened') {
      resolved.push(resolvedOp);
    } else {
      structural.push({
        op: resolvedOp,
        change: { kind: 'location-status', locs: [loc], status: op.status },
      });
    }
    return { resolved, inbox, hooks, structural };
  }
  resolved.push({ op: op.op, target: loc, factor: op.factor });
  return { resolved, inbox, hooks, structural };
}

function admit(
  world: WorldState,
  change: StructuralChange,
  fallback: AuthorOp | undefined,
): { readonly accept: boolean; readonly world: WorldState; readonly fallback?: AuthorOp } {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return { accept: false, world };
  }
  const cache = cacheOf(ambient);
  const graph = graphFor(world, ambient);
  const after = graph === undefined ? undefined : applyRegionalChange(graph, change);
  const decision = gate({
    change,
    cache,
    slowCap: ambientBudgets(ambient.density).slowGatePerDay,
    world: graph === undefined ? { npcs: {}, plot: { stages: [] } } : anchorSource(world),
    verify: () => {
      if (after === undefined) {
        return { solvable: new Set<string>(), witnesses: new Map() };
      }
      const checked = verifyRegion(after);
      return { solvable: checked.solvable, witnesses: checked.witnesses };
    },
    ...(fallback === undefined ? {} : { fallback }),
  });
  const vacuous = decision.decision === 'accept' && decision.via === 'slow' && ambient.gate.solvable.length === 0;
  if (decision.decision === 'accept' && !vacuous) {
    const written = decision.via === 'fast' ? world : writeGate(world, decision.cache);
    return {
      accept: true,
      world: after === undefined ? written : withRegion(written, after),
    };
  }
  const slowRunsToday = decision.via === 'fast' ? cache.slowRunsToday : decision.cache.slowRunsToday;
  return {
    accept: false,
    world: writeGate(world, { ...cache, slowRunsToday }),
    ...(decision.fallback === undefined ? {} : { fallback: decision.fallback as AuthorOp }),
  };
}

function anchorSource(world: WorldState): AnchorSource {
  const listed = Object.entries(world.npcs).flatMap(([id, npc]) =>
    npc.schedule?.entries === undefined ? [] : [[id, { schedule: npc.schedule }] as const],
  );
  const npcs: AnchorSource['npcs'] = Object.fromEntries(listed);
  const stages = world.plot.stages.filter((stage) =>
    stage.traces.every((trace) => Array.isArray(trace.participants)),
  );
  return { npcs, plot: { stages } };
}

function withRegion(world: WorldState, region: RegionGraph): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  return { ...world, ambient: { ...ambient, region } };
}

function graphFor(world: WorldState, ambient: AmbientState): RegionGraph | undefined {
  if (ambient.multiCity === true) {
    return ambient.region ?? regionGraphFor(world.meta?.seed ?? '');
  }
  const stored = ambient.gate.witnesses;
  if (stored === undefined || stored.length === 0) {
    return undefined;
  }
  return graphFromWitnesses(witnessMap(stored), Object.keys(world.city.locations));
}

function cacheOf(ambient: AmbientState): GateCache {
  return {
    result: {
      solvable: new Set(ambient.gate.solvable),
      witnesses: witnessMap(ambient.gate.witnesses ?? []),
    },
    anchors: new Set(ambient.gate.anchors),
    slowRunsToday: ambient.gate.slowRunsToday,
  };
}

function writeGate(world: WorldState, cache: GateCache): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      gate: {
        solvable: [...cache.result.solvable].sort(),
        anchors: [...cache.anchors].sort(),
        slowRunsToday: cache.slowRunsToday,
        ...(cache.result.witnesses.size === 0
          ? {}
          : { witnesses: storedWitnesses(cache.result.witnesses) }),
      },
    },
  };
}

function sync(world: WorldState, metrics: Metrics, overlays: readonly Overlay[]): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  return { ...world, ambient: { ...ambient, metrics, overlays } };
}

function withLife(
  world: WorldState,
  id: string,
  patch: { readonly removed?: 'detained' },
): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined || patch.removed === undefined) {
    return world;
  }
  const prior = ambient.life[id as NpcId] ?? emptyLife();
  if (prior.removed !== undefined) {
    return world;
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      life: { ...ambient.life, [id]: { ...prior, removed: patch.removed } },
    },
  };
}

function deviate(world: WorldState, id: string, loc: string, phases: readonly number[]): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined || phases.length === 0) {
    return world;
  }
  const prior = ambient.life[id as NpcId] ?? emptyLife();
  const weekday = world.time.day % 7;
  const deviations = [
    ...prior.deviations,
    ...phases.map((phase) => ({
      untilDay: world.time.day + ROUTE_DAYS,
      weekday,
      phase: phase as Phase,
      loc: loc as LocId,
    })),
  ];
  return {
    ...world,
    ambient: {
      ...ambient,
      life: { ...ambient.life, [id]: { ...prior, deviations } },
    },
  };
}

function tagsOf(world: WorldState, id: string, type: string): readonly string[] {
  const stored = world.ambient?.siteTags?.[id];
  if (stored !== undefined) {
    return stored;
  }
  const bare = type.includes('/') ? type.slice(type.lastIndexOf('/') + 1) : type;
  return [`function:${bare}`, bare];
}

function pickLoc(world: WorldState, eventId: string, query: readonly string[]): string | undefined {
  const locations = world.city?.locations ?? {};
  const matches = Object.entries(locations)
    .flatMap(([id, location]) => {
      if (location === undefined || typeof location.type !== 'string') {
        return [];
      }
      const loc = typeof location.id === 'string' ? location.id : id;
      return query.every((tag) => tagsOf(world, loc, location.type).includes(tag)) ? [loc] : [];
    })
    .sort();
  return matches.length === 0
    ? undefined
    : createPrng(ambientKeySeed(world.meta.seed, 'exo', `${eventId}:${query.join('|')}`, world.time.day)).pick(matches);
}

function pickRoute(
  world: WorldState,
  eventId: string,
  query: readonly string[],
): { readonly a: string; readonly b: string } | undefined {
  const districts = world.city?.districts ?? {};
  const routes = (world.city?.routes ?? []).flatMap((route) => {
    const tags = new Set<string>();
    for (const end of [route.a, route.b]) {
      const district = districts[end];
      if (district === undefined) {
        continue;
      }
      tags.add(district.id);
      if (typeof district.sector === 'string') {
        tags.add(`sector:${district.sector}`);
      }
    }
    return query.every((tag) => tags.has(tag)) ? [{ a: route.a, b: route.b }] : [];
  });
  return routes.length === 0
    ? undefined
    : createPrng(ambientKeySeed(world.meta.seed, 'exo', `${eventId}:route:${query.join('|')}`, world.time.day)).pick(
        routes,
      );
}

function pickPerson(world: WorldState, eventId: string, who: NpcPick): string | undefined {
  const npcs = world.npcs ?? {};
  const ids = Object.keys(npcs)
    .filter((id) => !isPrincipalNpc(world, id))
    .filter((id) => {
      if (who.npc !== undefined) {
        return id === who.npc;
      }
      const npc = npcs[id as NpcId];
      const hay = `${npc?.role ?? ''} ${npc?.archetype ?? ''}`.toLowerCase();
      return who.roleTitle !== undefined && hay.includes(who.roleTitle.toLowerCase());
    })
    .sort();
  return ids.length === 0
    ? undefined
    : createPrng(ambientKeySeed(world.meta.seed, 'exo', `${eventId}:who`, world.time.day)).pick(ids);
}

function enginePhases(phases: readonly string[]): number[] {
  const mapped = new Set<number>();
  for (const phase of phases) {
    if (CONTENT_PHASES.has(phase)) {
      mapped.add(enginePhaseOf(phase as ContentPhase));
    }
  }
  return [...mapped].sort((a, b) => a - b);
}

function hookOf(world: WorldState, op: AuthorOp & { op: 'ambient-hook' }): AmbientHook | undefined {
  const day = world.time.day;
  switch (op.hook) {
    case 'cover-suspicion-delta':
      return world.player?.coverSuspicion === undefined || op.amount === undefined
        ? undefined
        : { kind: 'cover-suspicion-delta', amount: op.amount };
    case 'detection-bonus': {
      const npc = Object.keys(world.npcs ?? {}).sort()[0];
      return npc === undefined || op.amount === undefined
        ? undefined
        : { kind: 'detection-bonus', npc: npc as NpcId, bonus: op.amount };
    }
    case 'informant-report': {
      const npc = Object.keys(world.npcs ?? {}).sort()[0];
      return npc === undefined
        ? undefined
        : { kind: 'informant-report', informant: npc as NpcId, handler: 'police' };
    }
    case 'delay-stage': {
      const stage = world.plot?.stages?.[0]?.id;
      return typeof stage !== 'string' ? undefined : { kind: 'delay-stage', stage, days: op.days === 2 ? 2 : 1 };
    }
    case 'reroute-location': {
      const stage = world.plot?.stages?.[0]?.id;
      const from = Object.keys(world.city?.locations ?? {}).sort()[0];
      return typeof stage !== 'string' || from === undefined
        ? undefined
        : { kind: 'reroute-location', stage, from: from as LocId };
    }
    case 'channel-outage': {
      const channel = Object.keys(world.channels ?? {}).sort()[0];
      return channel === undefined
        ? undefined
        : { kind: 'channel-outage', channel, untilDay: day + (op.days ?? 1) };
    }
    default: {
      const unreachable: never = op.hook;
      return unreachable;
    }
  }
}
