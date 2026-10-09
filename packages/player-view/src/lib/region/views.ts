/**
 * Regional player-view projections (multi-city Requirement 17).
 *
 * The region map, the departures board, held papers and the carriage are built
 * from published region content and the player's own papers. Travel-document
 * quality is left off the papers view. Another person's ground-truth placement
 * is not read here.
 */

import type { GameTime, LocId, Phase, WorldState } from '@tradecraft/engine';

import { paperViews, type PaperView } from './papers.js';

export interface RegionLocationView {
  readonly id: string;
  readonly name: string;
}

export interface RegionCityView {
  readonly id: string;
  readonly name: string;
  readonly country?: string;
  readonly locations: readonly RegionLocationView[];
}

export interface RegionRouteView {
  readonly id: string;
  readonly mode: string;
  readonly fromCity: string;
  readonly toCity: string;
  readonly fromName: string;
  readonly toName: string;
  readonly duration: number;
  readonly fare: number;
  readonly borders: readonly string[];
}

export interface DepartureView {
  readonly route: string;
  readonly mode: string;
  readonly destination: string;
  readonly at: GameTime;
  readonly duration: number;
  readonly fare: number;
  readonly borders: readonly string[];
  readonly papers: readonly string[];
  readonly quote?: {
    readonly allowed: boolean;
    readonly reason?: string;
    readonly phases: number;
    readonly money: number;
    readonly wait?: number;
    readonly duration?: number;
    readonly borders?: readonly string[];
  };
}

export interface RegionMapView {
  readonly template: string;
  readonly here?: string;
  readonly cities: readonly RegionCityView[];
  readonly routes: readonly RegionRouteView[];
  readonly departures: readonly DepartureView[];
  readonly papers: readonly PaperView[];
}

export interface CarriageView {
  readonly transit: string;
  readonly destination: string;
  readonly arrives?: GameTime;
  readonly travellers: readonly string[];
}

const PHASE_OF: Readonly<Record<string, Phase | 'any'>> = {
  morning: 0,
  midday: 1,
  afternoon: 1,
  evening: 2,
  night: 3,
  daily: 'any',
};

function cityName(state: WorldState, id: string | undefined): string {
  if (id === undefined) {
    return '';
  }
  return state.region?.cities[id as keyof NonNullable<WorldState['region']>['cities']]?.name ?? localOf(id);
}

function localOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

function nextDeparture(now: GameTime, timetable: string | undefined): GameTime {
  const slot = PHASE_OF[timetable ?? 'daily'] ?? 'any';
  if (slot === 'any' || slot === now.phase) {
    return now;
  }
  if (slot > now.phase) {
    return { day: now.day, phase: slot };
  }
  return { day: now.day + 1, phase: slot };
}

function knownInCity(state: WorldState, locations: WorldState['city']['locations']): RegionLocationView[] {
  const known = new Set<string>(state.player.known.entities);
  const rows: RegionLocationView[] = [];
  for (const loc of Object.values(locations)) {
    if (loc.public || known.has(loc.id)) {
      rows.push({ id: loc.id, name: loc.name });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/** The region map. Undefined in slice mode, where `region` is unset. */
export function regionMapView(state: WorldState): RegionMapView | undefined {
  const region = state.region;
  if (region === undefined) {
    return undefined;
  }
  const cities: RegionCityView[] = region.order.map((id) => {
    const city = region.cities[id];
    return {
      id,
      name: city?.name ?? localOf(id),
      ...(city?.country === undefined ? {} : { country: city.country }),
      locations: knownInCity(state, city?.locations ?? {}),
    };
  });
  const routes: RegionRouteView[] = Object.values(region.intercity)
    .map((route) => ({
      id: route.id,
      mode: route.mode,
      fromCity: route.fromCity ?? '',
      toCity: route.toCity ?? '',
      fromName: cityName(state, route.fromCity),
      toName: cityName(state, route.toCity),
      duration: route.duration,
      fare: route.fare,
      borders: [...route.borders],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const here = state.player.city ?? undefined;
  return {
    template: region.template,
    ...(here === undefined || here === null ? {} : { here }),
    cities,
    routes,
    departures: departuresView(state),
    papers: papersView(state),
  };
}

/** Next departures from the terminal the player is standing at. */
export function departuresView(state: WorldState): readonly DepartureView[] {
  const region = state.region;
  if (region === undefined) {
    return [];
  }
  const here = state.player.loc;
  const papers = [...(state.player.papers ?? [])];
  const rows: DepartureView[] = [];
  for (const route of Object.values(region.intercity)) {
    if (route.from !== here) {
      continue;
    }
    rows.push({
      route: route.id,
      mode: route.mode,
      destination: cityName(state, route.toCity),
      at: nextDeparture(state.time, route.timetable),
      duration: route.duration,
      fare: route.fare,
      borders: [...route.borders],
      papers,
    });
  }
  rows.sort((a, b) => a.route.localeCompare(b.route));
  return rows;
}

/** Held papers, without quality (Requirement 4.5). */
export function papersView(state: WorldState): readonly PaperView[] {
  return paperViews([...(state.player.papers ?? [])], state.travelDocs ?? {});
}

/** The carriage the player is riding, or undefined when they are in a city. */
export function carriageView(state: WorldState): CarriageView | undefined {
  const placed = state.locationOf?.player;
  if (placed === undefined || !('transit' in placed)) {
    return undefined;
  }
  const transit = state.transits?.[placed.transit];
  if (transit === undefined) {
    return undefined;
  }
  const route = state.region?.intercity[transit.route];
  const travellers = transit.travellers.map((who) => (who === 'player' ? 'you' : who));
  return {
    transit: transit.id,
    destination: cityName(state, route?.toCity),
    ...(transit.arrivesAt === undefined ? {} : { arrives: transit.arrivesAt }),
    travellers,
  };
}

/** A location id the region places in a city, or undefined. */
export function cityOfPlace(state: WorldState, place: LocId | undefined): string | undefined {
  if (place === undefined || state.region === undefined) {
    return undefined;
  }
  for (const id of state.region.order) {
    if (state.region.cities[id]?.locations[place] !== undefined) {
      return id;
    }
  }
  return undefined;
}
