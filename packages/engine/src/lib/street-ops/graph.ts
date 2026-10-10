/**
 * Compiled street graph and turn options (street-ops tasks 3.1 and 3.2).
 *
 * A graph is a pure value. Turn options are the legal exits from an arrival,
 * in a stable order, labelled by relative bearing.
 */

import type { LocId } from '../model/core.js';

import type { GraphFeature, SpeedClass, StreetGraphFile, StreetPhase } from './content.js';

export const RELATIVES = [
  'u-turn',
  'hard-left',
  'left',
  'bear-left',
  'straight',
  'bear-right',
  'right',
  'hard-right',
] as const;
export type Relative = (typeof RELATIVES)[number];

export interface Directed {
  readonly segment: string;
  readonly dir: 'fwd' | 'rev';
}

export interface TurnOption {
  readonly relative: Relative;
  readonly to: Directed;
  readonly street: string;
  readonly ticks: number;
}

interface Junction {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly name?: string;
  readonly district?: string;
  readonly barred: readonly (readonly [string, string])[];
}

interface Segment {
  readonly id: string;
  readonly street: string;
  readonly from: string;
  readonly to: string;
  readonly lengthM: number;
  readonly speed: SpeedClass;
  readonly oneWay: boolean;
  readonly traffic: StreetGraphFile['segments'][number]['traffic'];
  readonly features?: readonly GraphFeature[];
  /** False when the segment is outside the verified area. It is not a drive choice. */
  readonly mapped: boolean;
  /** True when an override closed the street. It is not a drive choice. */
  readonly closed: boolean;
}

interface Frontage {
  readonly location: string;
  readonly segment: string;
  readonly at: number;
  readonly side: 'left' | 'right';
}

interface CheckpointSite {
  readonly id: string;
  readonly kind: string;
  readonly segment: string;
  readonly at: number;
  readonly service?: string;
  readonly visibleM?: number;
  readonly hours?: readonly StreetPhase[];
}

export interface StreetGraph {
  readonly id: string;
  readonly city: string;
  readonly junctions: ReadonlyMap<string, Junction>;
  readonly segments: ReadonlyMap<string, Segment>;
  readonly out: ReadonlyMap<string, readonly Directed[]>;
  readonly frontages: readonly Frontage[];
  readonly checkpoints: readonly CheckpointSite[];
  turnOptions(
    arrival: Directed,
    phase: StreetPhase,
    speeds: Readonly<Record<SpeedClass, number>>,
  ): readonly TurnOption[];
  frontageOf(loc: LocId | string): Frontage | undefined;
}

function bearing(from: Junction, to: Junction): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function signedDelta(fromDeg: number, toDeg: number): number {
  let delta = toDeg - fromDeg;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  return delta;
}

function bucket(delta: number): Relative | undefined {
  const abs = Math.abs(delta);
  const left = delta > 0;
  if (abs <= 20) return 'straight';
  if (abs <= 60) return left ? 'bear-left' : 'bear-right';
  if (abs <= 120) return left ? 'left' : 'right';
  if (abs <= 160) return left ? 'hard-left' : 'hard-right';
  return undefined;
}

function relativeRank(relative: Relative): number {
  return RELATIVES.indexOf(relative);
}

/** Problems that make a graph unusable. An empty list is a usable graph. */
export function validateStreetGraph(file: StreetGraphFile, hubLocation?: string): string[] {
  const errors: string[] = [];
  const junctions = new Set(file.junctions.map((junction) => junction.id));
  const segments = new Map(file.segments.map((segment) => [segment.id, segment]));
  if (junctions.size !== file.junctions.length) errors.push('duplicate junction id');
  if (segments.size !== file.segments.length) errors.push('duplicate segment id');

  for (const segment of file.segments) {
    if (!junctions.has(segment.from) || !junctions.has(segment.to)) {
      errors.push(`segment ${segment.id} names a missing junction`);
    }
    if (segment.from === segment.to) errors.push(`segment ${segment.id} is a loop`);
  }
  for (const frontage of file.frontages) {
    if (!segments.has(frontage.segment)) errors.push(`frontage ${frontage.location} names a missing segment`);
  }
  for (const site of file.checkpoints) {
    if (!segments.has(site.segment)) errors.push(`checkpoint ${site.id} names a missing segment`);
  }
  for (const route of file.routes ?? []) {
    for (const junction of route.junctions) {
      if (!junctions.has(junction)) errors.push(`route ${route.id} names a missing junction ${junction}`);
    }
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (current === undefined || current === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const segment of file.segments) {
    if (segment.oneWay || !junctions.has(segment.from) || !junctions.has(segment.to)) continue;
    unite(segment.from, segment.to);
  }
  const roots = new Set<string>();
  for (const segment of file.segments) {
    if (segment.oneWay || !junctions.has(segment.from)) continue;
    roots.add(find(segment.from));
  }
  if (roots.size > 1) errors.push('two-way streets are not connected');

  if (hubLocation !== undefined) {
    const compiled = compileStreetGraph(file);
    const hub = compiled.frontageOf(hubLocation);
    if (hub === undefined) {
      errors.push(`hub ${hubLocation} has no frontage`);
    } else {
      const reached = reachable(compiled, hub.segment);
      for (const frontage of file.frontages) {
        const segment = segments.get(frontage.segment);
        if (segment === undefined) continue;
        const entryOk = segment.oneWay
          ? reached.has(segment.from)
          : reached.has(segment.from) || reached.has(segment.to);
        if (!entryOk) {
          errors.push(`frontage ${frontage.location} is not reachable from ${hubLocation}`);
        }
      }
    }
  }
  return errors;
}

function reachable(graph: StreetGraph, segmentId: string): Set<string> {
  const segment = graph.segments.get(segmentId);
  const seen = new Set<string>();
  if (segment === undefined) return seen;
  const queue: string[] = segment.oneWay ? [segment.to] : [segment.from, segment.to];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.out.get(id) ?? []) {
      const next = head(graph, edge);
      if (next !== undefined && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function head(graph: StreetGraph, edge: Directed): string | undefined {
  const segment = graph.segments.get(edge.segment);
  if (segment === undefined) return undefined;
  return edge.dir === 'fwd' ? segment.to : segment.from;
}

function tail(graph: StreetGraph, edge: Directed): string | undefined {
  const segment = graph.segments.get(edge.segment);
  if (segment === undefined) return undefined;
  return edge.dir === 'fwd' ? segment.from : segment.to;
}

function pointInRing(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const crosses = a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function compileStreetGraph(file: StreetGraphFile): StreetGraph {
  const junctions = new Map<string, Junction>();
  for (const junction of file.junctions) {
    junctions.set(junction.id, {
      id: junction.id,
      x: junction.x,
      y: junction.y,
      barred: junction.barred ?? [],
      ...(junction.name === undefined ? {} : { name: junction.name }),
      ...(junction.district === undefined ? {} : { district: junction.district }),
    });
  }
  const segments = new Map<string, Segment>();
  const out = new Map<string, Directed[]>();
  const add = (junction: string, edge: Directed): void => {
    const list = out.get(junction);
    if (list === undefined) out.set(junction, [edge]);
    else list.push(edge);
  };
  for (const segment of file.segments) {
    const from = junctions.get(segment.from);
    const to = junctions.get(segment.to);
    const midX = from === undefined || to === undefined ? 0 : (from.x + to.x) / 2;
    const midY = from === undefined || to === undefined ? 0 : (from.y + to.y) / 2;
    const outside = file.verifiedArea !== undefined && file.verifiedArea.length > 0 && !file.verifiedArea.some((ring) => pointInRing(midX, midY, ring));
    segments.set(segment.id, {
      ...segment,
      mapped: segment.mapped !== false && !outside,
      closed: segment.closed === true,
    });
    add(segment.from, { segment: segment.id, dir: 'fwd' });
    if (!segment.oneWay) add(segment.to, { segment: segment.id, dir: 'rev' });
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.segment.localeCompare(b.segment) || a.dir.localeCompare(b.dir));
  }
  const frontages = file.frontages;

  const graph: StreetGraph = {
    id: file.id,
    city: file.city,
    junctions,
    segments,
    out,
    frontages,
    checkpoints: file.checkpoints,
    turnOptions(arrival, phase, speeds) {
      const arrived = segments.get(arrival.segment);
      const at = head(graph, arrival);
      const fromId = tail(graph, arrival);
      if (arrived === undefined || at === undefined || fromId === undefined) return [];
      const here = junctions.get(at);
      const origin = junctions.get(fromId);
      if (here === undefined || origin === undefined) return [];
      const heading = bearing(origin, here);
      const options: TurnOption[] = [];
      for (const edge of out.get(at) ?? []) {
        const nextSegment = segments.get(edge.segment);
        const nextId = head(graph, edge);
        const next = nextId === undefined ? undefined : junctions.get(nextId);
        if (nextSegment === undefined || next === undefined) continue;
        if (nextSegment.mapped === false || nextSegment.closed === true) continue;
        const sameEdge = edge.segment === arrival.segment && edge.dir === arrival.dir;
        if (sameEdge) continue;
        const barred = here.barred.some(([arrive, leave]) => arrive === arrival.segment && leave === edge.segment);
        if (barred) continue;
        const reverse = edge.segment === arrival.segment && edge.dir !== arrival.dir;
        const relative = reverse ? 'u-turn' : bucket(signedDelta(heading, bearing(here, next)));
        if (relative === undefined) continue;
        const factor = Math.max(1, nextSegment.traffic[phase]);
        options.push({
          relative,
          to: edge,
          street: nextSegment.street,
          ticks: Math.ceil((nextSegment.lengthM / speeds[nextSegment.speed]) * factor),
        });
      }
      options.sort(
        (a, b) => relativeRank(a.relative) - relativeRank(b.relative) || a.street.localeCompare(b.street),
      );
      return options;
    },
    frontageOf(loc) {
      return frontages.find((frontage) => frontage.location === loc || frontage.location.endsWith(`/${loc}`));
    },
  };
  return graph;
}

/**
 * A graph the player can leave from `loc` when that place has no authored
 * frontage. The authored curbs stay, and this place is the first curb on the
 * same segment as the first frontage, so parking there returns them home.
 */
export function pinFrontage(graph: StreetGraph, loc: string): StreetGraph {
  if (graph.frontageOf(loc) !== undefined) return graph;
  const base = graph.frontages[0];
  if (base === undefined) return graph;
  const frontages = [{ location: loc, segment: base.segment, at: base.at, side: base.side }, ...graph.frontages];
  return {
    ...graph,
    frontages,
    frontageOf(id) {
      return frontages.find((frontage) => frontage.location === id || frontage.location.endsWith(`/${id}`));
    },
  };
}

/** A rectangular two-way grid, for property tests. `oneWayCol` makes one column one-way. */
export function gridGraph(cols: number, rows: number, oneWayCol?: number): StreetGraphFile {
  const junctions = [];
  const segments = [];
  const traffic = { morning: 1, afternoon: 1, evening: 1, night: 1 };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      junctions.push({ id: `g-${x}-${y}`, x: x * 10, y: y * 10 });
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (x + 1 < cols) {
        segments.push({
          id: `h-${x}-${y}`,
          street: `row-${y}`,
          from: `g-${x}-${y}`,
          to: `g-${x + 1}-${y}`,
          lengthM: 10,
          speed: 'normal' as const,
          oneWay: false,
          lanes: 1,
          traffic,
        });
      }
      if (y + 1 < rows) {
        segments.push({
          id: `v-${x}-${y}`,
          street: `file-${x}`,
          from: `g-${x}-${y}`,
          to: `g-${x}-${y + 1}`,
          lengthM: 10,
          speed: 'normal' as const,
          oneWay: oneWayCol === x,
          lanes: 1,
          traffic,
        });
      }
    }
  }
  const first = segments[0];
  return {
    id: 'grid',
    city: 'fixture',
    origin: 'authored',
    sources: [],
    junctions,
    segments,
    frontages: first === undefined ? [] : [{ location: 'hub', segment: first.id, at: 0.5, side: 'right' as const }],
    checkpoints: [],
  };
}

export const DEFAULT_SPEED_M_PER_TICK: Readonly<Record<SpeedClass, number>> = {
  slow: 5,
  normal: 10,
  fast: 16,
};
