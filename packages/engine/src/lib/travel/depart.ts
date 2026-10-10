/**
 * Intercity departures (multi-city task 6.1; Requirements 2, 12).
 *
 * `quote` names the wait, the transit, the fare and the borders. `resolve`
 * debits the fare, runs each border check, and either delivers the player to
 * the destination terminal or leaves them at the origin on cancellation or refusal.
 */

import { addPhases } from '../clock/clock.js';
import { borderCheck, borderFactLine, type BorderItem, type BorderOutcome } from '../border/check.js';
import { VEHICLE_BORDER } from '../street-ops/checkpoint.js';
import { borderWatch, parkedForTravel, travelPlate } from '../street-ops/hooks.js';
import type { CityId } from '../fidelity/types.js';
import { timeToPhases, type GameTime, type LocId, type NpcId, type Phase } from '../model/core.js';
import { createPrng, type Prng } from '../prng/prng.js';
import type { ServiceState, WatchList } from '../region/services.js';
import type {
  BorderPost,
  IntercityRoute,
  LocationOf,
  Placement,
  RegionWorld,
  Transit,
  TransitId,
  TravelDocument,
} from '../region/world.js';
import { projectActiveCity } from '../region/play-clock.js';
import { credit, debit, type Ledger } from '../station/ledger.js';
import type { WorldState, SimEvent } from '../model/state.js';
import type { ActionQuote, ActionResult } from '../action/result.js';
import type { DepartAction } from '../action/types.js';
import { moveOnSpine } from './move.js';

const PHASE_OF: Readonly<Record<string, Phase | 'any'>> = {
  morning: 0,
  midday: 1,
  afternoon: 1,
  evening: 2,
  night: 3,
  daily: 'any',
};

interface Trip {
  readonly route: IntercityRoute;
  readonly origin: CityId;
  readonly destination: CityId;
  readonly wait: number;
  readonly papers: readonly TravelDocument[];
}

function rulesOf(region: RegionWorld) {
  return (
    region.rules ?? {
      detentionPhases: 1,
      contrabandCashThreshold: 40,
      papersDelay: 1,
      papersCost: 10,
      watchListSensitivity: 0.5,
    }
  );
}

function cityOfLoc(region: RegionWorld, loc: LocId): CityId | undefined {
  for (const city of region.order) {
    const state = region.cities[city];
    if (state?.locations[loc] !== undefined) {
      return city;
    }
  }
  return undefined;
}

function playerAt(state: WorldState): { readonly city: CityId | null; readonly loc: LocId } {
  const placed = state.locationOf?.player;
  if (placed !== undefined && 'city' in placed) {
    return { city: placed.city, loc: placed.loc };
  }
  return { city: state.player.city ?? null, loc: state.player.loc };
}

function timetableAllows(route: IntercityRoute, at: GameTime): boolean {
  const slots = route.departures;
  if (slots !== undefined && slots.length > 0) {
    const weekday = at.day % 7;
    return slots.some((slot) => slot.weekday === weekday && slot.phase === at.phase);
  }
  const slot = PHASE_OF[route.timetable ?? 'daily'] ?? 'any';
  return slot === 'any' || slot === at.phase;
}

function selectedPapers(state: WorldState, ids: readonly string[]): TravelDocument[] {
  const docs = state.travelDocs ?? {};
  const papers: TravelDocument[] = [];
  for (const id of ids) {
    const paper = docs[id as keyof typeof docs];
    if (paper !== undefined) {
      papers.push(paper);
    }
  }
  return papers;
}

function requiredKinds(region: RegionWorld, route: IntercityRoute): string[] {
  const kinds: string[] = [];
  for (const postId of route.borders) {
    const post = region.borderPosts[postId];
    if (post === undefined) {
      continue;
    }
    for (const kind of post.documents) {
      if (!kinds.includes(kind)) {
        kinds.push(kind);
      }
    }
  }
  return kinds;
}

function paperReady(paper: TravelDocument, kind: string): boolean {
  return paper.kind === kind || paper.kind.endsWith(`/${kind}`);
}

/** Phases of transit still ahead, when the player is in a carriage. */
export function carriageWaitLimit(state: WorldState): number | undefined {
  const placed = state.locationOf?.player;
  if (placed === undefined || !('transit' in placed)) {
    return undefined;
  }
  const transit = state.transits?.[placed.transit];
  if (transit?.arrivesAt === undefined) {
    return undefined;
  }
  return Math.max(0, timeToPhases(transit.arrivesAt) - timeToPhases(state.time));
}

/** Travellers the spine currently places at a terminal. */
export function terminalTravellers(state: WorldState, loc: LocId): readonly string[] {
  const names: string[] = [];
  for (const [who, place] of Object.entries(state.locationOf ?? {})) {
    if ('loc' in place && place.loc === loc) {
      names.push(who);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function plan(state: WorldState, action: DepartAction): Trip | string {
  const region = state.region;
  if (region === undefined) {
    return 'this game has no region';
  }
  const route = region.intercity[action.route];
  if (route === undefined) {
    return `no such route ${action.route}`;
  }
  const here = playerAt(state);
  if (here.loc !== route.from || (route.fromCity !== undefined && here.city !== route.fromCity)) {
    return 'you are not at the origin terminal';
  }
  const origin = route.fromCity ?? cityOfLoc(region, route.from);
  const destination = route.toCity ?? cityOfLoc(region, route.to);
  if (origin === undefined || destination === undefined) {
    return 'the route does not join two cities';
  }
  const destCountry = region.cities[destination]?.country;
  if (destCountry !== undefined && (state.player.png ?? []).includes(destCountry)) {
    return `persona non grata in ${destCountry}`;
  }
  const wait = timeToPhases(action.at) - timeToPhases(state.time);
  if (wait < 0 || !timetableAllows(route, action.at)) {
    return 'that departure is not on the timetable';
  }
  const papers = selectedPapers(state, action.papers);
  const missing = requiredKinds(region, route).filter((kind) => !papers.some((paper) => paperReady(paper, kind)));
  if (missing.length > 0) {
    return `missing papers: ${missing.join(', ')}`;
  }
  return { route, origin, destination, wait, papers };
}

/** Quote a departure: wait, duration, fare, and the borders to be crossed. */
export function quoteDepart(state: WorldState, action: DepartAction): ActionQuote {
  const trip = plan(state, action);
  if (typeof trip === 'string') {
    return { allowed: false, reason: trip, phases: 0, money: 0 };
  }
  return {
    allowed: true,
    phases: trip.wait + trip.route.duration,
    money: trip.route.fare,
    wait: trip.wait,
    duration: trip.route.duration,
    borders: trip.route.borders,
  };
}

function cancelled(state: WorldState, route: IntercityRoute, origin: CityId): boolean {
  if ((state.region?.closedRoutes ?? []).includes(route.id)) {
    return true;
  }
  const weather = state.region?.cities[origin]?.weather.condition;
  return weather !== undefined && (route.cancellingWeather ?? []).includes(weather);
}

function postInput(post: BorderPost): { id: string; name: string; strictness: number; documents: readonly string[] } {
  return { id: post.id, name: post.id, strictness: post.strictness, documents: post.documents };
}

function watchFor(state: WorldState, service: ServiceState | undefined): WatchList {
  return borderWatch(service, state.ext?.streetOps?.notedPlates ?? []);
}

/**
 * Resolve a quoted departure. A disallowed quote never reaches here.
 * Cancellation refunds the fare. Refusal and detention leave the player at the origin.
 */
export function resolveDepart(
  state: WorldState,
  action: DepartAction,
  rng: Prng,
): { readonly next: WorldState; readonly result: ActionResult } {
  const quoted = quoteDepart(state, action);
  const trip = plan(state, action);
  if (typeof trip === 'string' || !quoted.allowed) {
    return { next: state, result: empty(state) };
  }
  const debited = trip.route.fare === 0
    ? state.station.ledger
    : debit(state.station.ledger, trip.route.fare, 'fare', state.time, trip.route.id);
  if (typeof debited === 'string') {
    return { next: state, result: empty(state) };
  }
  if (cancelled(state, trip.route, trip.origin)) {
    const refunded = trip.route.fare === 0
      ? debited
      : credit(debited, trip.route.fare, 'fare-refund', action.at, trip.route.id);
    const waited = addPhases(state.time, trip.wait);
    const event: SimEvent = {
      id: `depart-cancel-${trip.route.id}`,
      at: action.at,
      visibility: 'player',
      city: trip.origin,
      kind: 'departure-cancelled',
      route: trip.route.id,
    };
    const next = atOrigin({ ...state, time: waited }, trip, refunded);
    return {
      next: { ...next, scheduled: [...state.scheduled, event] },
      result: resultOf(next, [`The departure on ${trip.route.id} is cancelled. The fare is refunded.`], [event]),
    };
  }

  const region = state.region;
  if (region === undefined) {
    return { next: state, result: empty(state) };
  }
  let phasesAdded = 0;
  const lines: string[] = [];
  const events: SimEvent[] = [];
  let services = state.services ?? {};
  let refused = false;
  let detained = false;
  const items: BorderItem[] = [];
  for (const postId of trip.route.borders) {
    const post = region.borderPosts[postId];
    if (post === undefined) {
      continue;
    }
    const service = services[post.service];
    const plate = travelPlate(state);
    const checked = borderCheck(
      {
        post: postInput(post),
        at: action.at,
        traveller: {
          identity: 'player',
          descriptor: 'player',
          coverFits: true,
          ...(plate === undefined ? {} : { vehicle: { plate } }),
        },
        papers: trip.papers,
        items,
        watch: watchFor(state, service),
        rules: rulesOf(region),
      },
      rng,
      VEHICLE_BORDER,
    );
    lines.push(borderFactLine(checked.outcome, post.id));
    if (checked.phasesAdded > 0) {
      lines.push(`The crossing adds ${checked.phasesAdded} phase(s).`);
      phasesAdded += checked.phasesAdded;
    }
    if (checked.suspicionDelta > 0 && service !== undefined) {
      services = {
        ...services,
        [service.id]: {
          ...service,
          beliefs: { ...service.beliefs, coverSuspicion: service.beliefs.coverSuspicion + checked.suspicionDelta },
        },
      };
    }
    const outcome = eventOutcome(checked.outcome);
    if (outcome !== undefined) {
      events.push({
        id: `border-${post.id}-${action.at.day}`,
        at: action.at,
        visibility: 'player',
        city: trip.origin,
        kind: 'border-outcome',
        post: post.id,
        outcome,
      });
    }
    if (checked.outcome === 'detained') {
      detained = true;
      events.push({
        id: `cable-border-${post.id}`,
        at: action.at,
        visibility: 'player',
        city: trip.origin,
        kind: 'cable',
        doc: 'doc:cable/border',
      });
      break;
    }
    if (checked.outcome === 'refused') {
      refused = true;
      break;
    }
  }

  const total = refused || detained ? trip.wait + phasesAdded : quoted.phases + phasesAdded;
  const time = addPhases(state.time, total);
  if (refused || detained) {
    const next = atOrigin({ ...state, time, services }, trip, debited);
    return {
      next: { ...next, scheduled: [...state.scheduled, ...events] },
      result: resultOf(next, lines, events),
    };
  }

  const transitId = `transit:${trip.route.id.slice('route:'.length)}-${action.at.day}-${action.at.phase}` as TransitId;
  const arrivesAt = addPhases(action.at, trip.route.duration + phasesAdded);
  const carriage = `loc:carriage-${transitId.slice('transit:'.length)}` as LocId;
  let locationOf: LocationOf = state.locationOf ?? {
    player: { city: trip.origin, loc: trip.route.from },
  };
  let spine = state.cityStreams?.spine ?? {};
  const saved = spine[trip.origin];
  const admitted: Array<'player' | NpcId> = ['player'];
  let stream = saved;
  if (stream !== undefined) {
    for (const who of terminalBoarders(locationOf, trip.route.from)) {
      let blocked = false;
      for (const postId of trip.route.borders) {
        const post = region.borderPosts[postId];
        if (post === undefined) {
          continue;
        }
        const service = services[post.service];
        const gate = createPrng(stream);
        const checked = borderCheck(
          {
            post: postInput(post),
            at: action.at,
            traveller: { identity: who, descriptor: who, coverFits: true },
            papers: [],
            items: [],
            watch: watchFor(state, service),
            rules: rulesOf(region),
          },
          gate,
          VEHICLE_BORDER,
        );
        stream = gate.state();
        if (checked.outcome === 'refused' || checked.outcome === 'detained' || checked.outcome === 'seizure') {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        admitted.push(who);
      }
    }
  }
  const riders = admitted;
  const transit: Transit = {
    id: transitId,
    route: trip.route.id,
    travellers: riders,
    status: 'arrived',
    departure: action.at,
    arrivesAt,
    carriage,
    duration: trip.route.duration,
  };
  if (stream !== undefined) {
    for (const who of riders) {
      const boarded = moveOnSpine(locationOf, stream, {
        city: trip.origin,
        who,
        transit: transitId,
        board: true,
        at: action.at,
        duration: trip.route.duration,
      });
      locationOf = boarded.locationOf;
      stream = boarded.spine;
    }
    for (const who of riders) {
      const alighted = moveOnSpine(locationOf, stream, {
        city: trip.origin,
        who,
        transit: transitId,
        board: false,
        dest: { city: trip.destination, loc: trip.route.to },
        at: arrivesAt,
        duration: trip.route.duration,
      });
      locationOf = alighted.locationOf;
      stream = alighted.spine;
    }
    spine = { ...spine, [trip.origin]: stream };
  } else {
    const placed: Record<string, Placement> = { ...locationOf };
    for (const who of riders) {
      placed[who] = { city: trip.destination, loc: trip.route.to };
    }
    locationOf = placed as LocationOf;
  }
  const next: WorldState = {
    ...state,
    time,
    services,
    locationOf,
    cityStreams: state.cityStreams === undefined ? undefined : { ...state.cityStreams, spine },
    transits: { ...(state.transits ?? {}), [transitId]: { ...transit, travellers: riders } },
    player: {
      ...state.player,
      loc: trip.route.to,
      city: trip.destination,
    },
    station: { ...state.station, ledger: debited },
    scheduled: [...state.scheduled, ...events],
  };
  lines.unshift(`You arrive at ${trip.route.to}.`);
  const arrived = projectActiveCity(parkedForTravel(next));
  return { next: arrived, result: resultOf(arrived, lines, events) };
}

function eventOutcome(outcome: BorderOutcome): 'passed' | 'refused' | 'detained' | undefined {
  if (outcome === 'pass') {
    return 'passed';
  }
  if (outcome === 'refused' || outcome === 'detained') {
    return outcome;
  }
  return undefined;
}

function atOrigin(state: WorldState, trip: Trip, ledger: Ledger): WorldState {
  return {
    ...state,
    player: { ...state.player, loc: trip.route.from, city: trip.origin },
    station: { ...state.station, ledger },
    locationOf: state.locationOf === undefined
      ? undefined
      : { ...state.locationOf, player: { city: trip.origin, loc: trip.route.from } },
  };
}

function empty(state: WorldState): ActionResult {
  return {
    observations: [],
    factLines: [],
    scene: sceneDescriptor(state.player.loc),
    events: [],
    claimsAdded: [],
  };
}

function resultOf(state: WorldState, lines: readonly string[], events: readonly SimEvent[]): ActionResult {
  return {
    observations: lines.map((line) => ({ kind: 'message' as const, line })),
    factLines: lines,
    scene: sceneDescriptor(state.player.loc),
    events,
    claimsAdded: [],
  };
}

/** NPCs standing at the origin terminal board with the player. */
export function terminalBoarders(locationOf: LocationOf, loc: LocId): readonly NpcId[] {
  const ids: NpcId[] = [];
  for (const [who, place] of Object.entries(locationOf)) {
    if (who !== 'player' && 'loc' in place && place.loc === loc) {
      ids.push(who as NpcId);
    }
  }
  return ids;
}

function sceneDescriptor(loc: LocId): ActionResult['scene'] {
  return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
}
