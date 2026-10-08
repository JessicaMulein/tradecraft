/**
 * Solvability gate (ambient-world Req 19). The slice verifier's rules and
 * root stay as they are. This module reads the witnesses it already returns
 * and decides whether a structural change may land.
 */

import type { DiscoveryResult, PathWitness } from '../city/discovery.js';
import { propKey } from '../city/discovery.js';
import type { DiscoveryInputs } from '../city/discovery.js';
import type { NpcSchedule } from '../city/npc.js';
import type { StageTrace } from '../city/plot.js';
import type { ChannelId, LocId, NpcId } from '../model/core.js';

export interface VerifierPath {
  readonly edge: PathWitness['edge'];
  readonly node: string;
}

/** Covered keys and the two disjoint paths that cover each one. */
export interface VerifierResult {
  readonly solvable: ReadonlySet<string>;
  readonly witnesses: ReadonlyMap<string, readonly [VerifierPath, VerifierPath]>;
}

export interface GateCache {
  readonly result: VerifierResult;
  readonly anchors: ReadonlySet<string>;
  readonly slowRunsToday: number;
}

export type StructuralChange =
  | { readonly kind: 'location-status'; readonly locs: readonly string[]; readonly status: string }
  | { readonly kind: 'route-closure'; readonly a: string; readonly b: string }
  | {
      readonly kind: 'schedule-override';
      readonly npc: string;
      readonly phases: readonly number[];
      readonly loc: string;
    }
  | { readonly kind: 'detain-npc'; readonly npc: string }
  | { readonly kind: 'channel-outage'; readonly channel: string };

export interface GateDecision {
  readonly decision: 'accept' | 'reject';
  readonly via: 'fast' | 'slow' | 'cap';
  readonly cache: GateCache;
  /** Set when a rejection names a template fallback to apply instead. */
  readonly fallback?: unknown;
}

export interface AnchorSource {
  readonly npcs: Readonly<Record<string, { readonly schedule: NpcSchedule }>>;
  readonly plot: {
    readonly stages: readonly {
      readonly status?: string;
      readonly traces: readonly StageTrace[];
    }[];
  };
}

function pathOf(witness: PathWitness): VerifierPath {
  return {
    edge: witness.edge,
    node: witness.npc ?? witness.channel ?? witness.loc ?? '',
  };
}

/** Solvable keys are covered stage facts, plus `mole` when the mole is covered. */
export function verifierResult(discovery: DiscoveryResult): VerifierResult {
  const solvable = new Set<string>();
  const witnesses = new Map<string, readonly [VerifierPath, VerifierPath]>();
  for (const report of discovery.stages) {
    const key = propKey(report.prop);
    solvable.add(key);
    witnesses.set(key, [pathOf(report.human), pathOf(report.signal)]);
  }
  if (discovery.mole !== undefined) {
    solvable.add('mole');
    witnesses.set('mole', [pathOf(discovery.mole.human), pathOf(discovery.mole.signal)]);
  }
  return { solvable, witnesses };
}

/** Witness pairs kept on the gate so a later structural change can be re-checked. */
export interface StoredWitness {
  readonly key: string;
  readonly human: VerifierPath;
  readonly signal: VerifierPath;
}

export function storedWitnesses(
  witnesses: ReadonlyMap<string, readonly [VerifierPath, VerifierPath]>,
): StoredWitness[] {
  return [...witnesses.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, [human, signal]]) => ({ key, human, signal }));
}

export function witnessMap(
  stored: readonly StoredWitness[],
): Map<string, readonly [VerifierPath, VerifierPath]> {
  const map = new Map<string, readonly [VerifierPath, VerifierPath]>();
  for (const item of stored) {
    map.set(item.key, [item.human, item.signal]);
  }
  return map;
}

export function anchorKey(npc: string, weekday: number, phase: number, loc: string): string {
  return `${npc}|${weekday}|${phase}|${loc}`;
}

/**
 * Schedule slots a meeting witness or a pending Plot trace depends on.
 * A pending trace with no matching schedule entry still anchors its place.
 */
export function anchorsOf(result: VerifierResult, world: AnchorSource): Set<string> {
  const keys = new Set<string>();
  const meeting = new Set<string>();
  for (const [human, signal] of result.witnesses.values()) {
    if (human.edge === 'meeting') {
      meeting.add(human.node);
    }
    if (signal.edge === 'meeting') {
      meeting.add(signal.node);
    }
  }
  for (const npcId of meeting) {
    const npc = world.npcs[npcId];
    if (npc === undefined) {
      continue;
    }
    for (const entry of npc.schedule.entries) {
      keys.add(anchorKey(npcId, entry.weekday, entry.phase, entry.loc));
    }
  }
  for (const stage of world.plot.stages) {
    if (stage.status !== undefined && stage.status !== 'pending') {
      continue;
    }
    for (const trace of stage.traces) {
      const loc = trace.place?.kind === 'loc' ? trace.place.loc : undefined;
      for (const participant of trace.participants) {
        const npc = world.npcs[participant];
        if (npc === undefined) {
          if (loc !== undefined) {
            keys.add(anchorKey(participant, -1, -1, loc));
          }
          continue;
        }
        const matched = npc.schedule.entries.filter(
          (entry) => loc === undefined || entry.loc === loc,
        );
        const entries = matched.length > 0 ? matched : npc.schedule.entries;
        if (entries.length === 0 && loc !== undefined) {
          keys.add(anchorKey(participant, -1, -1, loc));
          continue;
        }
        for (const entry of entries) {
          keys.add(anchorKey(participant, entry.weekday, entry.phase, entry.loc));
        }
      }
    }
  }
  return keys;
}

export function witnessNodes(result: VerifierResult): Set<string> {
  const nodes = new Set<string>();
  for (const [human, signal] of result.witnesses.values()) {
    if (human.node !== '') {
      nodes.add(human.node);
    }
    if (signal.node !== '') {
      nodes.add(signal.node);
    }
  }
  return nodes;
}

/** Locations, NPC ids, channels and route keys a change can disturb. */
export function footprint(change: StructuralChange): Set<string> {
  switch (change.kind) {
    case 'location-status':
      if (change.status === 'open' || change.status === 'newly-opened') {
        return new Set();
      }
      return new Set(change.locs);
    case 'route-closure':
      return new Set([`route:${change.a}|${change.b}`, change.a, change.b]);
    case 'schedule-override':
      return new Set([change.npc, change.loc]);
    case 'detain-npc':
      return new Set([change.npc]);
    case 'channel-outage':
      return new Set([change.channel]);
  }
}

function touches(tokens: ReadonlySet<string>, anchors: ReadonlySet<string>, nodes: ReadonlySet<string>): boolean {
  for (const token of tokens) {
    if (nodes.has(token)) {
      return true;
    }
    for (const anchor of anchors) {
      if (anchor === token || anchor.endsWith(`|${token}`) || anchor.startsWith(`${token}|`)) {
        return true;
      }
    }
  }
  return false;
}

function contains(after: ReadonlySet<string>, before: ReadonlySet<string>): boolean {
  for (const key of before) {
    if (!after.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Accept on the fast path when the footprint misses every anchor and witness
 * node. Otherwise run `verify` (the change already applied for its full
 * duration) and accept only when the new solvable set contains the old one.
 * The slow path stops after `slowCap` runs; a rejection may name a fallback.
 */
export function gate(args: {
  readonly change: StructuralChange;
  readonly cache: GateCache;
  readonly slowCap: number;
  readonly world: AnchorSource;
  readonly verify: () => VerifierResult;
  readonly fallback?: unknown;
}): GateDecision {
  const tokens = footprint(args.change);
  const hit = touches(tokens, args.cache.anchors, witnessNodes(args.cache.result));
  if (!hit) {
    return { decision: 'accept', via: 'fast', cache: args.cache };
  }
  if (args.cache.slowRunsToday >= args.slowCap) {
    return {
      decision: 'reject',
      via: 'cap',
      cache: args.cache,
      ...(args.fallback === undefined ? {} : { fallback: args.fallback }),
    };
  }
  const after = args.verify();
  const nextCount = args.cache.slowRunsToday + 1;
  if (!contains(after.solvable, args.cache.result.solvable)) {
    return {
      decision: 'reject',
      via: 'slow',
      cache: { ...args.cache, slowRunsToday: nextCount },
      ...(args.fallback === undefined ? {} : { fallback: args.fallback }),
    };
  }
  return {
    decision: 'accept',
    via: 'slow',
    cache: {
      result: after,
      anchors: anchorsOf(after, args.world),
      slowRunsToday: nextCount,
    },
  };
}

/** Treat the change as permanent and return the inputs the verifier should read. */
export function applyForDuration(inputs: DiscoveryInputs, change: StructuralChange): DiscoveryInputs {
  switch (change.kind) {
    case 'location-status': {
      if (change.status === 'open' || change.status === 'newly-opened') {
        return inputs;
      }
      const locations = { ...inputs.city.locations };
      const closed = new Set(change.locs);
      for (const loc of change.locs) {
        delete locations[loc as LocId];
      }
      const npcs = { ...inputs.principals.npcs };
      for (const [id, npc] of Object.entries(npcs)) {
        const entries = npc.schedule.entries.filter((entry) => !closed.has(entry.loc));
        if (entries.length !== npc.schedule.entries.length) {
          npcs[id as NpcId] = { ...npc, schedule: { entries } };
        }
      }
      return {
        ...inputs,
        city: { ...inputs.city, locations },
        principals: { ...inputs.principals, npcs },
      };
    }
    case 'route-closure':
      return {
        ...inputs,
        city: {
          ...inputs.city,
          routes: inputs.city.routes.filter(
            (route) =>
              !((route.a === change.a && route.b === change.b) || (route.a === change.b && route.b === change.a)),
          ),
        },
      };
    case 'schedule-override': {
      const npc = inputs.principals.npcs[change.npc as NpcId];
      if (npc === undefined) {
        return inputs;
      }
      const phases = new Set(change.phases);
      const entries = npc.schedule.entries.map((entry) =>
        phases.has(entry.phase) ? { ...entry, loc: change.loc as typeof entry.loc } : entry,
      );
      return {
        ...inputs,
        principals: {
          ...inputs.principals,
          npcs: { ...inputs.principals.npcs, [change.npc]: { ...npc, schedule: { entries } } },
        },
      };
    }
    case 'detain-npc': {
      const npcs = { ...inputs.principals.npcs };
      delete npcs[change.npc as NpcId];
      return { ...inputs, principals: { ...inputs.principals, npcs } };
    }
    case 'channel-outage': {
      const channels = { ...inputs.comms.channels };
      delete channels[change.channel as ChannelId];
      return { ...inputs, comms: { ...inputs.comms, channels } };
    }
  }
}
