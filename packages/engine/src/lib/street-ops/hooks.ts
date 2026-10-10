/**
 * Service reactions to street events (street-ops task 11).
 *
 * Beliefs move through the same exposure and cover-suspicion fields the rest
 * of the sim uses. A notification is a player-visible event: a cable, a border
 * report, or something the player could see on the street. It does not name
 * the cause.
 */

import { asTruth, revealTruth, type GameTime, type NpcId, type Truth } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { ServiceState, WatchList } from '../region/services.js';

import type { CheckpointOutcome } from './checkpoint.js';
import type { ServicePosture, StreetOpsState, StreetOpsTruth } from './state.js';

export const STREET_REACTIONS_HOOK = 'street-ops.reactions';

export interface StreetIncident {
  readonly service: string;
  readonly suspicionDelta: number;
  readonly alert: boolean;
  readonly search: boolean;
  readonly plate?: string;
  readonly notePlate: boolean;
  readonly cable: boolean;
  readonly announce: boolean;
  readonly postId: string;
  readonly border?: 'refused' | 'detained';
}

const ALERT_LINE = 'Police are stopping cars.';
const SEARCH_LINE = 'Police are searching cars.';

export function incidentForCheckpoint(input: {
  readonly service: string;
  readonly plate: string;
  readonly postId: string;
  readonly outcome: CheckpointOutcome;
  readonly suspicionDelta: number;
}): StreetIncident {
  const seized = input.outcome === 'vehicle-seized' || input.outcome === 'detained' || input.outcome === 'seizure';
  const turned = input.outcome === 'refused' || input.outcome === 'turned-back';
  let border: StreetIncident['border'];
  if (input.outcome === 'detained' || input.outcome === 'vehicle-seized') border = 'detained';
  else if (turned) border = 'refused';
  return {
    service: input.service,
    suspicionDelta: input.suspicionDelta,
    alert: seized || turned,
    search: input.outcome === 'vehicle-seized' || input.outcome === 'seizure',
    plate: input.plate,
    notePlate: seized,
    cable: input.outcome === 'detained' || input.outcome === 'vehicle-seized',
    announce: true,
    postId: input.postId,
    ...(border === undefined ? {} : { border }),
  };
}

export function incidentForTail(input: {
  readonly service: string;
  readonly suspicionDelta: number;
  readonly alert: boolean;
  readonly search: boolean;
}): StreetIncident {
  return {
    service: input.service,
    suspicionDelta: input.suspicionDelta,
    alert: input.alert,
    search: input.search,
    notePlate: false,
    cable: false,
    announce: false,
    postId: '',
  };
}

export function incidentForBluff(input: {
  readonly service: string;
  readonly suspicionDelta: number;
  readonly plate?: string;
  readonly failed: boolean;
}): StreetIncident {
  return {
    service: input.service,
    suspicionDelta: input.suspicionDelta,
    alert: input.failed,
    search: false,
    plate: input.plate,
    notePlate: input.failed && input.plate !== undefined,
    cable: false,
    announce: false,
    postId: '',
  };
}

function addPlate(plates: string[], plate: string | undefined, note: boolean): void {
  if (!note || plate === undefined || plate === '' || plates.includes(plate)) return;
  plates.push(plate);
}

/** Player-visible events only. The wording does not say why the service moved. */
export function streetEvents(
  incidents: readonly StreetIncident[],
  at: GameTime,
  posture: Readonly<Record<string, ServicePosture>>,
): { readonly events: readonly SimEvent[]; readonly posture: Readonly<Record<string, ServicePosture>>; readonly plates: readonly string[] } {
  const events: SimEvent[] = [];
  const next: Record<string, ServicePosture> = { ...posture };
  const plates: string[] = [];
  let alerted = false;
  let searching = false;
  let cabled = false;
  for (const incident of incidents) {
    const prior = next[incident.service] ?? { alert: false, search: false };
    const alert = prior.alert || incident.alert;
    const search = prior.search || incident.search;
    if (incident.announce && alert && !prior.alert && !alerted) {
      alerted = true;
      events.push({
        id: `street-alert-${at.day}-${at.phase}`,
        at,
        visibility: 'player',
        kind: 'public-announcement',
        text: ALERT_LINE,
      });
    }
    if (incident.announce && search && !prior.search && !searching) {
      searching = true;
      events.push({
        id: `street-search-${at.day}-${at.phase}`,
        at,
        visibility: 'player',
        kind: 'public-announcement',
        text: SEARCH_LINE,
      });
    }
    next[incident.service] = { alert, search };
    addPlate(plates, incident.plate, incident.notePlate);
    if (incident.border !== undefined && incident.postId.startsWith('post:')) {
      events.push({
        id: `street-border-${incident.postId}-${at.day}`,
        at,
        visibility: 'player',
        kind: 'border-outcome',
        post: incident.postId as `post:${string}`,
        outcome: incident.border,
      });
    }
    if (incident.cable && !cabled) {
      cabled = true;
      events.push({
        id: `cable-street-${at.day}-${at.phase}`,
        at,
        visibility: 'player',
        kind: 'cable',
        doc: 'doc:cable/border',
      });
    }
  }
  return { events, posture: next, plates };
}

/** The plate a border sees: the car being driven, or the first car the player still has. */
export function travelPlate(state: WorldState): string | undefined {
  const slice = state.ext?.streetOps;
  if (slice === undefined) return undefined;
  const driving = slice.session?.vehicle;
  const record =
    driving === undefined
      ? slice.vehicles[0]
      : slice.vehicles.find((item) => item.id === driving);
  return record?.plate;
}

/**
 * Close an open drive when the player leaves the city. The car stays on the
 * slice so the next city can start a drive. A parked car is left as it is.
 */
export function parkedForTravel(state: WorldState): WorldState {
  const slice = state.ext?.streetOps;
  if (slice?.session === undefined) return state;
  const parked: StreetOpsState = {
    version: slice.version,
    vehicles: slice.vehicles,
    knowledge: slice.knowledge,
    told: slice.told,
    rides: slice.rides,
    deliveries: slice.deliveries,
    notedPlates: slice.notedPlates,
    mapNames: slice.mapNames,
    seenCheckpoints: slice.seenCheckpoints,
    mapsRead: slice.mapsRead,
    counters: slice.counters,
    replay: slice.replay,
  };
  return {
    ...state,
    ext: { ...state.ext, streetOps: parked },
  };
}

export function borderWatch(service: ServiceState | undefined, notedPlates: readonly string[]): WatchList {
  const base = service === undefined ? { persons: [] as readonly NpcId[], descriptors: [] as readonly string[] } : revealTruth(service.beliefs.watch as Truth<WatchList>);
  const descriptors = [...base.descriptors];
  for (const plate of notedPlates) {
    if (!descriptors.includes(plate)) descriptors.push(plate);
  }
  return { persons: base.persons, descriptors };
}

export function noteServices(
  services: Readonly<Record<string, ServiceState>> | undefined,
  incidents: readonly StreetIncident[],
): Readonly<Record<string, ServiceState>> | undefined {
  if (services === undefined) return undefined;
  let next = services;
  for (const incident of incidents) {
    const service = next[incident.service];
    if (service === undefined) continue;
    const watch = borderWatch(service, incident.notePlate && incident.plate !== undefined ? [incident.plate] : []);
    next = {
      ...next,
      [incident.service]: {
        ...service,
        beliefs: {
          ...service.beliefs,
          coverSuspicion: service.beliefs.coverSuspicion + incident.suspicionDelta,
          watch: asTruth(watch),
        },
      },
    };
  }
  return next;
}

export function mergePlates(current: readonly string[], added: readonly string[]): string[] {
  const plates = [...current];
  for (const plate of added) addPlate(plates, plate, true);
  return plates;
}

export function postureOf(truth: StreetOpsTruth | undefined): Readonly<Record<string, ServicePosture>> {
  return truth?.posture ?? {};
}
