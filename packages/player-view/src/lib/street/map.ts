/**
 * Street map and drive projections (street-ops task 12).
 *
 * Both are built from the player's street knowledge and the street graph.
 * A segment or junction that is not in that knowledge is left out. The text
 * local map reads only a Drive View.
 */

import {
  DEFAULT_SPEED_M_PER_TICK,
  type KnowledgeSource,
  type StreetGraph,
  type StreetOpsState,
  type WorldState,
} from '@tradecraft/engine';

export interface StreetMapNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly name?: string;
  readonly district?: string;
}

export interface StreetMapEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly street: string;
  readonly known: KnowledgeSource;
  readonly shape: readonly [number, number][];
  readonly oneWay: boolean;
  /** Present when a navigation aid taught the street. It is the traffic this phase. */
  readonly traffic?: 'light' | 'moderate' | 'heavy';
}

export interface StreetMapView {
  readonly nodes: readonly StreetMapNode[];
  readonly edges: readonly StreetMapEdge[];
  readonly locations: readonly { readonly loc: string; readonly name: string; readonly at: readonly [number, number] }[];
  readonly checkpoints: readonly { readonly name: string; readonly at: readonly [number, number]; readonly seen: true }[];
  readonly sectorLines: readonly { readonly name: string; readonly polyline: readonly [number, number][] }[];
  readonly position?: { readonly at: readonly [number, number]; readonly headingDeg: number };
}

export interface DriveOptionView {
  readonly relative: string;
  readonly street: string;
  readonly ticks: number;
}

export interface DriveView {
  readonly vehicle: { readonly name: string; readonly plate: string };
  readonly street: string;
  readonly heading: string;
  readonly options: readonly DriveOptionView[];
  readonly speed: 'slow' | 'normal' | 'fast';
  readonly onApproach: readonly { readonly loc: string; readonly name: string }[];
  readonly traffic: 'light' | 'moderate' | 'heavy';
  readonly checkpointAhead?: { readonly name: string; readonly distanceBand: 'near' | 'far' };
  readonly clock: { readonly phase: number; readonly ticksInPhase: number };
  readonly passengers: readonly { readonly label: string; readonly mode: 'declared' | 'concealed' }[];
}

export interface StreetView {
  readonly map: StreetMapView;
  readonly drive?: DriveView;
  readonly localMap: readonly string[];
  readonly network: readonly string[];
  readonly vehicles: readonly { readonly name: string; readonly plate: string; readonly burned: boolean }[];
  readonly told: readonly { readonly template: string; readonly day: number }[];
}

const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'] as const;

function compass(deg: number): (typeof COMPASS)[number] {
  const turned = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(turned / 45) % 8] ?? 'east';
}

function bearing(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function placeName(state: WorldState, loc: string): string {
  return state.city.locations[loc as WorldState['player']['loc']]?.name ?? loc;
}

function shownStreet(slice: StreetOpsState, id: string, street: string): string {
  return slice.mapNames[id] ?? street;
}

function trafficOf(level: number): DriveView['traffic'] {
  if (level <= 1) return 'light';
  if (level <= 3) return 'moderate';
  return 'heavy';
}

function pointAlong(
  from: { x: number; y: number },
  to: { x: number; y: number },
  at: number,
): readonly [number, number] {
  return [from.x + (to.x - from.x) * at, from.y + (to.y - from.y) * at];
}

export function streetMapView(state: WorldState, graph: StreetGraph): StreetMapView {
  const slice = state.ext?.streetOps;
  const knowledge = slice?.knowledge ?? {};
  const nodes: StreetMapNode[] = [];
  for (const [id, junction] of graph.junctions) {
    if (knowledge[id] === undefined) continue;
    nodes.push({
      id,
      x: junction.x,
      y: junction.y,
      ...(junction.name === undefined ? {} : { name: junction.name }),
      ...(junction.district === undefined ? {} : { district: junction.district }),
    });
  }
  const edges: StreetMapEdge[] = [];
  for (const [id, segment] of graph.segments) {
    const known = knowledge[id];
    if (known === undefined) continue;
    if (segment.mapped === false) continue;
    const from = graph.junctions.get(segment.from);
    const to = graph.junctions.get(segment.to);
    if (from === undefined || to === undefined) continue;
    if (knowledge[segment.from] === undefined || knowledge[segment.to] === undefined) continue;
    const phaseNames = ['morning', 'afternoon', 'evening', 'night'] as const;
    const phase = phaseNames[state.time.phase] ?? 'morning';
    edges.push({
      id,
      from: segment.from,
      to: segment.to,
      street: slice === undefined ? segment.street : shownStreet(slice, id, segment.street),
      known,
      shape: [
        [from.x, from.y],
        [to.x, to.y],
      ],
      oneWay: segment.oneWay,
      ...(known === 'aid' ? { traffic: trafficOf(segment.traffic[phase]) } : {}),
    });
  }
  const locations = [];
  for (const frontage of graph.frontages) {
    if (knowledge[frontage.segment] === undefined) continue;
    const segment = graph.segments.get(frontage.segment);
    const from = segment === undefined ? undefined : graph.junctions.get(segment.from);
    const to = segment === undefined ? undefined : graph.junctions.get(segment.to);
    if (from === undefined || to === undefined) continue;
    locations.push({ loc: frontage.location, name: placeName(state, frontage.location), at: pointAlong(from, to, frontage.at) });
  }
  const checkpoints = [];
  const seen = new Set(slice?.seenCheckpoints ?? []);
  for (const site of graph.checkpoints) {
    if (!seen.has(site.id) || knowledge[site.segment] === undefined) continue;
    const segment = graph.segments.get(site.segment);
    const from = segment === undefined ? undefined : graph.junctions.get(segment.from);
    const to = segment === undefined ? undefined : graph.junctions.get(segment.to);
    if (from === undefined || to === undefined) continue;
    const name = site.kind.slice(site.kind.lastIndexOf('/') + 1).replace(/-/g, ' ');
    checkpoints.push({ name, at: pointAlong(from, to, site.at), seen: true as const });
  }
  const session = slice?.session;
  const segment = session === undefined ? undefined : graph.segments.get(session.at.segment);
  const from = segment === undefined ? undefined : graph.junctions.get(segment.from);
  const to = segment === undefined ? undefined : graph.junctions.get(segment.to);
  let position: StreetMapView['position'];
  if (session !== undefined && from !== undefined && to !== undefined && knowledge[session.at.segment] !== undefined) {
    const start = session.at.dir === 'fwd' ? from : to;
    const end = session.at.dir === 'fwd' ? to : from;
    position = { at: pointAlong(start, end, session.at.progress), headingDeg: bearing(start, end) };
  }
  return { nodes, edges, locations, checkpoints, sectorLines: [], ...(position === undefined ? {} : { position }) };
}

export function driveView(
  state: WorldState,
  graph: StreetGraph,
  speeds: Readonly<Record<'slow' | 'normal' | 'fast', number>> = DEFAULT_SPEED_M_PER_TICK,
  ticksPerPhase = 360,
): DriveView | undefined {
  const slice = state.ext?.streetOps;
  const session = slice?.session;
  if (slice === undefined || session === undefined) return undefined;
  const segment = graph.segments.get(session.at.segment);
  if (segment === undefined) return undefined;
  const from = graph.junctions.get(session.at.dir === 'fwd' ? segment.from : segment.to);
  const to = graph.junctions.get(session.at.dir === 'fwd' ? segment.to : segment.from);
  const heading = from === undefined || to === undefined ? 'east' : compass(bearing(from, to));
  const phaseNames = ['morning', 'afternoon', 'evening', 'night'] as const;
  const phase = phaseNames[state.time.phase] ?? 'morning';
  const options =
    session.at.progress < 1
      ? []
      : graph.turnOptions(session.at, phase, speeds).map((option) => ({
          relative: option.relative,
          street: option.street,
          ticks: option.ticks,
        }));
  const vehicle = slice.vehicles.find((item) => item.id === session.vehicle);
  const rides = slice.rides[session.vehicle] ?? [];
  let checkpointAhead: DriveView['checkpointAhead'];
  for (const site of graph.checkpoints) {
    if (!slice.seenCheckpoints.includes(site.id) || site.segment !== session.at.segment) continue;
    const distance = site.at - session.at.progress;
    const ahead = session.at.dir === 'fwd' ? distance : -distance;
    if (ahead <= 0) continue;
    const metres = ahead * segment.lengthM;
    const visible = site.visibleM ?? 120;
    if (metres > visible) continue;
    const name = site.kind.slice(site.kind.lastIndexOf('/') + 1).replace(/-/g, ' ');
    checkpointAhead = { name, distanceBand: metres <= visible / 2 ? 'near' : 'far' };
    break;
  }
  return {
    vehicle: { name: vehicle?.def ?? session.vehicle, plate: vehicle?.plate ?? '' },
    street: shownStreet(slice, session.at.segment, segment.street),
    heading,
    options,
    speed: session.speed,
    onApproach: graph.frontages
      .filter((frontage) => frontage.segment === session.at.segment)
      .map((frontage) => ({ loc: frontage.location, name: placeName(state, frontage.location) })),
    traffic: trafficOf(segment.traffic[phase]),
    ...(checkpointAhead === undefined ? {} : { checkpointAhead }),
    clock: { phase: state.time.phase, ticksInPhase: session.ticks % ticksPerPhase },
    passengers: rides.map((ride) => ({ label: ride.npc, mode: ride.mode })),
  };
}

function clip(line: string, width: number): string {
  if (line.length <= width) return line;
  return `${line.slice(0, Math.max(0, width - 1))}…`;
}

/** Plain-text local map. It uses the drive view and nothing else. */
export function renderLocalMap(view: DriveView, width = 72): readonly string[] {
  const lines = [clip(`You are on ${view.street}, heading ${view.heading}, in the ${view.vehicle.name}.`, width)];
  for (const option of view.options) {
    lines.push(clip(`${option.relative}: ${option.street} (${option.ticks})`, width));
  }
  for (const place of view.onApproach) lines.push(clip(`Ahead: ${place.name}`, width));
  if (view.checkpointAhead !== undefined) {
    lines.push(clip(`Ahead: ${view.checkpointAhead.name} (${view.checkpointAhead.distanceBand})`, width));
  }
  return lines;
}

/** Streets the player knows, grouped by the district of their first junction. */
export function renderNetwork(view: StreetMapView, width = 72): readonly string[] {
  if (view.edges.length === 0) return ['You have not learned any streets.'];
  const groups = new Map<string, string[]>();
  for (const edge of view.edges) {
    const from = view.nodes.find((node) => node.id === edge.from);
    const district = from?.district ?? from?.name ?? 'streets';
    const list = groups.get(district) ?? [];
    const mark = edge.known === 'driven' ? 'driven' : 'known';
    const traffic = edge.traffic === undefined ? '' : `, ${edge.traffic} traffic`;
    list.push(`${edge.street} (${mark}${traffic})`);
    groups.set(district, list);
  }
  const lines: string[] = [];
  for (const [district, streets] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(clip(`${district}: ${streets.sort((a, b) => a.localeCompare(b)).join(', ')}`, width));
  }
  return lines;
}

export function streetView(state: WorldState, graph: StreetGraph | undefined): StreetView | null {
  if (graph === undefined || state.ext?.streetOps === undefined) return null;
  const slice = state.ext.streetOps;
  const map = streetMapView(state, graph);
  const drive = driveView(state, graph);
  return {
    map,
    ...(drive === undefined ? {} : { drive }),
    localMap: drive === undefined ? [] : renderLocalMap(drive),
    network: renderNetwork(map),
    vehicles: slice.vehicles.map((vehicle) => ({ name: vehicle.def, plate: vehicle.plate, burned: vehicle.knownBurned })),
    told: slice.told.map((story) => ({ template: story.template, day: story.at.day })),
  };
}
