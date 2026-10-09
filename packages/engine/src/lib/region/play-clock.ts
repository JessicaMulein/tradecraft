/**
 * The regional half of the turn clock.
 *
 * Slice worlds leave `region` unset and never enter this module. When a
 * scenario names a region, each phase draws every city's spine stream, the
 * day boundary runs the service day (residency ticks, rivalry, persona non
 * grata), and player-visible events from another city wait out the
 * communication latency.
 */

import { ambientDayBoundary, ambientPhase } from '../ambient/tick.js';
import { settleDuties } from '../ambient/cover.js';
import { stepPopulace } from '../ambient/populace.js';
import { stepTies } from '../ambient/ties.js';
import type { AmbientState } from '../ambient/state.js';
import type { CityId, ServiceId } from '../fidelity/types.js';
import { spineTick } from '../fidelity/clock.js';
import type { EndCondition } from '../endings/end-conditions.js';
import { revealTruth, type GameTime, type LocId } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import type { ServiceState } from './services.js';
import { enqueueNotices, noticeRoute, playerInTransit, releaseNotices } from './notices.js';
import { serviceDay, type ServiceDayInput } from './service-day.js';

export function projectActiveCity(state: WorldState): WorldState {
  const region = state.region;
  const cityId = state.player.city;
  if (region === undefined || cityId === undefined || cityId === null) {
    return state;
  }
  const city = region.cities[cityId];
  if (city === undefined) {
    return state;
  }
  const displayName = city.name ?? state.city.displayName;
  if (state.city.locations === city.locations && state.city.displayName === displayName) {
    return state;
  }
  return {
    ...state,
    city: {
      ...state.city,
      displayName,
      districts: city.districts,
      locations: city.locations,
      routes: city.routes,
    },
  };
}

/**
 * Draw each city's spine once, and on a day boundary run the service day.
 * Time is not advanced here; the turn clock already entered `at`.
 */
export function stepRegionPhase(
  state: WorldState,
  at: GameTime,
  dayStart: boolean,
): { readonly state: WorldState; readonly events: readonly SimEvent[]; readonly ended?: EndCondition } {
  if (state.region === undefined) {
    return { state, events: [] };
  }
  let next = tickSpines(state);
  const lived = stepAmbient(next, dayStart);
  next = lived.state;
  const events: SimEvent[] = [...lived.events];
  let ended: EndCondition | undefined;
  if (dayStart && next.services !== undefined) {
    const day = runServiceDay(next, at);
    next = day.state;
    events.push(...day.events);
    ended = day.ended;
  }
  return { state: projectActiveCity(next), events, ...(ended === undefined ? {} : { ended }) };
}

/**
 * Hold player-visible events from another city until their latency elapses.
 * Events with no city, and events in the player's city, release immediately.
 * A slice world is returned unchanged.
 */
export function foldRegionNotices(
  state: WorldState,
  events: readonly SimEvent[],
): { readonly state: WorldState; readonly events: readonly SimEvent[] } {
  if (state.region === undefined) {
    return { state, events };
  }
  const route = noticeRoute(state);
  const quiet: SimEvent[] = [];
  const visible: SimEvent[] = [];
  for (const event of events) {
    if (event.visibility === 'player') {
      visible.push(event);
    } else {
      quiet.push(event);
    }
  }
  const queued = enqueueNotices(visible, route);
  const pending = [...(state.pendingNotices ?? []), ...queued];
  const released = releaseNotices(pending, state.time, playerInTransit(state));
  return {
    state: { ...state, pendingNotices: released.pending },
    events: [...quiet, ...released.due],
  };
}

function tickSpines(state: WorldState): WorldState {
  const streams = state.cityStreams;
  const order = state.region?.order;
  if (streams === undefined || order === undefined) {
    return state;
  }
  const spine = { ...streams.spine };
  for (const city of order) {
    const current = spine[city];
    if (current === undefined) {
      continue;
    }
    const rng = createPrng(current);
    spineTick(city, rng);
    spine[city] = rng.state();
  }
  return { ...state, cityStreams: { ...streams, spine } };
}

function runServiceDay(
  state: WorldState,
  at: GameTime,
): { readonly state: WorldState; readonly events: readonly SimEvent[]; readonly ended?: EndCondition } {
  const region = state.region;
  const services = state.services;
  if (region === undefined || services === undefined) {
    return { state, events: [] };
  }
  const playerCity = state.player.city ?? null;
  const mirrored = mirrorSuspicion(services, playerCity, revealTruth(state.player.coverSuspicion));
  const cities = region.order.map((id) => {
    const country = region.cities[id]?.country;
    return country === undefined ? { id } : { id, country };
  });
  const countries: string[] = [];
  for (const city of cities) {
    if (city.country !== undefined && !countries.includes(city.country)) {
      countries.push(city.country);
    }
  }
  countries.sort((a, b) => a.localeCompare(b));
  const input: ServiceDayInput = {
    seed: state.meta.seed,
    order: region.order,
    services: mirrored,
    rivalry: state.rivalry ?? [],
    candidates: {},
    at,
    shares: state.queuedShares ?? [],
    burnThreshold: state.meta.preset.coverSuspicionBurnThreshold,
    playerCity,
    countries,
    cities,
    routes: Object.values(region.intercity).map((route) => ({
      id: route.id,
      fromCity: route.fromCity,
      toCity: route.toCity,
      to: route.to,
      duration: route.duration,
    })),
    png: state.player.png ?? [],
    burned: state.player.burned,
  };
  const result = serviceDay(input);
  const loc: LocId | undefined = result.playerLoc;
  const city = result.playerCity;
  const locationOf = state.locationOf === undefined || city === null
    ? state.locationOf
    : {
        ...state.locationOf,
        player: { city, loc: loc ?? state.player.loc },
      };
  const next: WorldState = {
    ...state,
    services: result.services,
    queuedShares: result.shares,
    player: {
      ...state.player,
      burned: result.burned,
      png: result.png,
      city,
      ...(loc === undefined ? {} : { loc }),
    },
    ...(locationOf === undefined ? {} : { locationOf }),
    ...(result.ended === undefined ? {} : { ended: result.ended }),
  };
  return { state: next, events: result.events, ...(result.ended === undefined ? {} : { ended: result.ended }) };
}

/**
 * The slice records one cover-suspicion figure. Regional burn and persona non
 * grata read each service's own figure, so the services watching the player's
 * city are brought up to the suspicion play has already earned.
 */
function mirrorSuspicion(
  services: Readonly<Record<ServiceId, ServiceState>>,
  city: CityId | null,
  suspicion: number,
): Record<ServiceId, ServiceState> {
  if (city === null) {
    return { ...services };
  }
  const next: Record<ServiceId, ServiceState> = { ...services };
  for (const service of Object.values(services)) {
    const watchesHere = service.residencies[city] !== undefined || service.kind === 'hostile';
    if (!watchesHere || service.beliefs.coverSuspicion >= suspicion) {
      continue;
    }
    next[service.id] = {
      ...service,
      beliefs: { ...service.beliefs, coverSuspicion: suspicion },
    };
  }
  return next;
}

function stepAmbient(
  state: WorldState,
  dayStart: boolean,
): { readonly state: WorldState; readonly events: readonly SimEvent[] } {
  const region = state.region;
  if (region === undefined) {
    return { state, events: [] };
  }
  const living = region.order.some((cityId) => region.cities[cityId]?.ambient !== undefined);
  if (!living) {
    return { state, events: [] };
  }
  const events: SimEvent[] = [];
  const cities = { ...region.cities };
  for (const cityId of region.order) {
    const city = cities[cityId];
    const ambient = city?.ambient;
    if (city === undefined || ambient === undefined) {
      continue;
    }
    const full = cityId === state.player.city;
    let world = projectCity(state, city, { ...ambient, multiCity: true, pendingCouplings: ambient.pendingCouplings ?? [] });
    if (dayStart) {
      const day = ambientDayBoundary(world);
      world = day.state;
      events.push(...tagCity(day.events, cityId));
    }
    if (full) {
      const stepped = ambientPhase(world);
      world = stepped.state;
      events.push(...tagCity(stepped.events, cityId));
    } else {
      world = settleDuties(stepTies(stepPopulace(world)));
    }
    if (world.ambient !== undefined) {
      cities[cityId] = { ...city, ambient: world.ambient };
    }
  }
  const playerCity = state.player.city;
  const playerAmbient = playerCity === undefined || playerCity === null ? undefined : cities[playerCity]?.ambient;
  return {
    state: {
      ...state,
      region: { ...region, cities },
      ...(playerAmbient === undefined ? {} : { ambient: playerAmbient }),
    },
    events,
  };
}

function projectCity(state: WorldState, city: { readonly name?: string; readonly districts: WorldState['city']['districts']; readonly locations: WorldState['city']['locations']; readonly routes: WorldState['city']['routes'] }, ambient: AmbientState): WorldState {
  return {
    ...state,
    ambient,
    city: {
      ...state.city,
      displayName: city.name ?? state.city.displayName,
      districts: city.districts,
      locations: city.locations,
      routes: city.routes,
    },
  };
}

function tagCity(events: readonly SimEvent[], city: CityId): SimEvent[] {
  return events.map((event) => (event.city === undefined ? { ...event, city } : event));
}
