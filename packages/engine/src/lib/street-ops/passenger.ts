/**
 * Passengers and concealment (street-ops task 9).
 *
 * Placement is view-safe: the player chose the seat or the spot. Composure and
 * the time already spent hidden live on the truth slice. A search that cannot
 * reach a spot never finds what is in it. A concealed passenger who has spent
 * longer than the spot allows is found by every search that can reach it.
 */

import type { SearchLevel, HiddenCargo } from './checkpoint.js';
import type { ConcealmentRecord, PassengerView, SmuggleDelivery } from './state.js';

export const STRAIN_LINE = 'Your passenger is struggling to stay quiet.';
export const COMPOSURE_FLOOR = 0;
export const SMUGGLE_OBJECTIVE = 'smuggle';
export const FOUND_PASSENGER_EXPOSURE = 0.25;

export interface VehicleSpot {
  readonly id: string;
  readonly capacity: number;
  readonly search: number;
  readonly endurance: number;
  readonly reachedBy?: readonly SearchLevel[];
}

export interface SpotDef {
  readonly id: string;
  readonly capacity: number;
  readonly difficulty: number;
  readonly endurance: number;
  readonly reachedBy?: readonly SearchLevel[];
}

export interface ComposureRow {
  readonly tags: readonly string[];
  readonly composure: number;
}

export function toSpot(spot: VehicleSpot): SpotDef {
  return {
    id: spot.id,
    capacity: spot.capacity,
    difficulty: spot.search,
    endurance: spot.endurance,
    ...(spot.reachedBy === undefined ? {} : { reachedBy: spot.reachedBy }),
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Archetype id, voice and mannerisms, which the composure table matches. */
export function composureTags(npc: {
  readonly archetype: string;
  readonly persona: { readonly voiceTraits: readonly string[]; readonly mannerisms: readonly string[] };
}): string[] {
  const slash = npc.archetype.lastIndexOf('/');
  const local = slash < 0 ? npc.archetype : npc.archetype.slice(slash + 1);
  return [local, ...npc.persona.voiceTraits, ...npc.persona.mannerisms];
}

/**
 * The row with the most matching tags wins. Openness scales it. With no row,
 * openness itself is the composure.
 */
export function composureFor(tags: readonly string[], openness: number, rows: readonly ComposureRow[]): number {
  const have = new Set(tags);
  let best: { readonly score: number; readonly composure: number; readonly index: number } | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined || !row.tags.every((tag) => have.has(tag))) continue;
    if (best === undefined || row.tags.length > best.score) {
      best = { score: row.tags.length, composure: row.composure, index };
    }
  }
  const persona = clamp01(openness);
  if (best === undefined) return persona;
  return clamp01(best.composure * (0.5 + 0.5 * persona));
}

export function canRide(input: {
  readonly present: boolean;
  readonly recruited: boolean;
  readonly trust: number;
  readonly trustMin: number;
  readonly namedByDirective: boolean;
}): boolean {
  if (!input.present) return false;
  if (input.namedByDirective) return true;
  return input.recruited && input.trust >= input.trustMin;
}

export function board(input: {
  readonly rides: readonly PassengerView[];
  readonly seats: number;
  readonly mode: 'declared' | 'concealed';
  readonly npc: string;
  readonly spot?: SpotDef;
}): PassengerView[] | string {
  if (input.rides.some((ride) => ride.npc === input.npc)) return 'already in the car';
  if (input.mode === 'declared') {
    const seated = input.rides.filter((ride) => ride.mode === 'declared').length;
    if (seated + 1 > input.seats - 1) return 'no seat free';
    return [...input.rides, { npc: input.npc, mode: 'declared', crossed: false }];
  }
  if (input.spot === undefined) return 'no such spot';
  const used = input.rides.filter((ride) => ride.mode === 'concealed' && ride.spot === input.spot?.id).length;
  if (used >= input.spot.capacity) return 'that spot is full';
  return [...input.rides, { npc: input.npc, mode: 'concealed', spot: input.spot.id, crossed: false }];
}

export function alight(rides: readonly PassengerView[], npc: string): PassengerView[] | string {
  if (!rides.some((ride) => ride.npc === npc)) return 'no such passenger';
  return rides.filter((ride) => ride.npc !== npc);
}

export function withCrossed(rides: readonly PassengerView[]): PassengerView[] {
  return rides.map((ride) => (ride.crossed ? ride : { ...ride, crossed: true }));
}

export function deliveryFor(ride: PassengerView, loc: string, at: SmuggleDelivery['at']): SmuggleDelivery | undefined {
  if (!ride.crossed) return undefined;
  return { npc: ride.npc, loc, at };
}

export function isSmuggleMet(
  deliveries: readonly { readonly npc: string; readonly loc: string }[],
  npc: string,
  loc: string,
): boolean {
  return deliveries.some((delivery) => delivery.npc === npc && delivery.loc === loc);
}

/** Add this step's ticks. Past the spot's endurance, composure falls and the passenger is straining. */
export function syncConcealment(input: {
  readonly nextRides: readonly PassengerView[];
  readonly records: readonly ConcealmentRecord[];
  readonly spots: readonly SpotDef[];
  readonly added: number;
  readonly composureForNpc: (npc: string) => number;
}): { readonly records: ConcealmentRecord[]; readonly facts: readonly string[] } {
  const added = Math.max(0, input.added);
  const records: ConcealmentRecord[] = [];
  let strainedNow = false;
  for (const ride of input.nextRides) {
    if (ride.mode !== 'concealed') continue;
    const prior = input.records.find((record) => record.npc === ride.npc);
    const base: ConcealmentRecord = prior ?? {
      npc: ride.npc,
      ticksConcealed: 0,
      composure: input.composureForNpc(ride.npc),
      strained: false,
    };
    const spot = input.spots.find((item) => item.id === ride.spot);
    const endurance = spot === undefined ? Number.POSITIVE_INFINITY : spot.endurance;
    const ticks = base.ticksConcealed + added;
    const strained = base.strained || ticks > endurance;
    if (strained && !base.strained) strainedNow = true;
    records.push({
      npc: base.npc,
      ticksConcealed: ticks,
      composure: strained ? COMPOSURE_FLOOR : base.composure,
      strained,
    });
  }
  return { records, facts: strainedNow ? [STRAIN_LINE] : [] };
}

export function concealedCargo(
  rides: readonly PassengerView[],
  records: readonly ConcealmentRecord[],
  spots: readonly SpotDef[],
): HiddenCargo[] {
  const cargo: HiddenCargo[] = [];
  for (const ride of rides) {
    if (ride.mode !== 'concealed' || ride.spot === undefined) continue;
    const spot = spots.find((item) => item.id === ride.spot);
    const record = records.find((item) => item.npc === ride.npc);
    cargo.push({
      id: ride.npc,
      difficulty: spot?.difficulty ?? 0,
      endurance: spot?.endurance ?? 0,
      ticksConcealed: record?.ticksConcealed ?? 0,
      composure: record?.strained ? COMPOSURE_FLOOR : (record?.composure ?? 0),
      kind: 'passenger',
      ...(spot?.reachedBy === undefined ? {} : { reachedBy: spot.reachedBy }),
    });
  }
  return cargo;
}
