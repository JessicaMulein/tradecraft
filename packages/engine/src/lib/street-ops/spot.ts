/**
 * Spotting (street-ops task 7.2).
 *
 * An observation names a vehicle that was on that segment. Innocent traffic
 * can repeat, which is a false alarm. A line never says the vehicle is a tail.
 */

import type { StreetGraph } from './graph.js';
import { streetSubstream } from './stream.js';

export interface SpotVehicle {
  readonly id: string;
  readonly segment: string;
  readonly descriptor: string;
  readonly discipline: number;
  readonly conspicuousness: number;
}

export interface StreetObservation {
  readonly step: number;
  readonly segment: string;
  readonly vehicleId: string;
  readonly descriptor: string;
  readonly line: string;
}

const COLOURS = ['grey', 'black', 'green', 'brown', 'blue'] as const;
const KINDS = ['sedan', 'van', 'coupe', 'taxi', 'lorry'] as const;

export function descriptorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash + id.charCodeAt(i) * (i + 1)) % 10007;
  const colour = COLOURS[hash % COLOURS.length] ?? 'grey';
  const kind = KINDS[Math.floor(hash / COLOURS.length) % KINDS.length] ?? 'sedan';
  const plate = id.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 3);
  return `${colour} ${kind}, partial plate ${plate}`;
}

export function observationLine(descriptor: string, street: string): string {
  return `A ${descriptor} was on ${street}.`;
}

function adjacent(graph: StreetGraph, segmentId: string): ReadonlySet<string> {
  const segment = graph.segments.get(segmentId);
  const near = new Set<string>([segmentId]);
  if (segment === undefined) return near;
  for (const item of graph.segments.values()) {
    const shares =
      item.from === segment.from ||
      item.from === segment.to ||
      item.to === segment.from ||
      item.to === segment.to;
    if (shares) near.add(item.id);
  }
  return near;
}

export function inSight(graph: StreetGraph, playerSegment: string, vehicleSegment: string, sightRangeM: number): boolean {
  const length = graph.segments.get(vehicleSegment)?.lengthM ?? Number.POSITIVE_INFINITY;
  if (length > sightRangeM) return false;
  return adjacent(graph, playerSegment).has(vehicleSegment);
}

export interface SpotInput {
  readonly seed: string;
  readonly sessionKey: string;
  readonly step: number;
  readonly segment: string;
  readonly street: string;
  readonly traffic: number;
  readonly attention: number;
  readonly noticeBase: number;
  readonly regularRate: number;
  readonly sightRangeM: number;
  readonly graph: StreetGraph;
  readonly tails: readonly SpotVehicle[];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function noticeChance(input: {
  readonly base: number;
  readonly attention: number;
  readonly conspicuousness: number;
  readonly discipline: number;
  readonly traffic: number;
  readonly sameSegment: boolean;
}): number {
  const trafficVisibility = 1 / (1 + Math.max(0, input.traffic));
  const distanceFactor = input.sameSegment ? 1 : 0.5;
  return clamp01(
    input.base * input.attention * input.conspicuousness * (1 - input.discipline) * trafficVisibility * distanceFactor,
  );
}

function draw(seed: string, key: string): number {
  return streetSubstream(seed, 'spot', key).next();
}

/** Vehicles that exist on this step, tails and innocent traffic together. */
export function presentVehicles(input: SpotInput): readonly SpotVehicle[] {
  const present: SpotVehicle[] = [];
  for (const vehicle of input.tails) {
    if (inSight(input.graph, input.segment, vehicle.segment, input.sightRangeM)) present.push(vehicle);
  }
  const count = Math.max(0, Math.min(3, input.traffic));
  for (let index = 0; index < count; index += 1) {
    const id = `traffic:${input.segment}:${index}`;
    present.push({
      id,
      segment: input.segment,
      descriptor: descriptorFor(id),
      discipline: 0,
      conspicuousness: 0.5,
    });
  }
  const regularDraw = draw(input.seed, `${input.sessionKey}:traffic:${input.segment}`);
  if (regularDraw < input.regularRate) {
    const id = `regular:${input.segment}`;
    present.push({
      id,
      segment: input.segment,
      descriptor: descriptorFor(id),
      discipline: 0,
      conspicuousness: 0.6,
    });
  }
  return present;
}

/** Observations of vehicles that are present. The line does not name a tail. */
export function spotVehicles(input: SpotInput): { readonly present: readonly SpotVehicle[]; readonly noticed: readonly StreetObservation[] } {
  const present = presentVehicles(input);
  const noticed: StreetObservation[] = [];
  for (const vehicle of present) {
    const chance = noticeChance({
      base: input.noticeBase,
      attention: input.attention,
      conspicuousness: vehicle.conspicuousness,
      discipline: vehicle.discipline,
      traffic: input.traffic,
      sameSegment: vehicle.segment === input.segment,
    });
    const rolled = draw(input.seed, `${input.sessionKey}:notice:${vehicle.id}:${input.step}`);
    if (rolled >= chance) continue;
    noticed.push({
      step: input.step,
      segment: vehicle.segment,
      vehicleId: vehicle.id,
      descriptor: vehicle.descriptor,
      line: observationLine(vehicle.descriptor, input.street),
    });
  }
  return { present, noticed };
}
