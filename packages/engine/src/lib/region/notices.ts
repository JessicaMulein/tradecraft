/**
 * Regional notice delivery (multi-city task 11; Requirements 5.4, 13).
 *
 * A player-visible event from another city waits out the communication
 * latency. While the player is in transit, only carriage events (no city)
 * are delivered. Foreign newspaper editions stay off the local kiosks until
 * the next day.
 */

import { addPhases } from '../clock/clock.js';
import { compareTime, type DocId, type GameTime, type LocId } from '../model/core.js';
import type { CityId } from '../fidelity/types.js';
import type { Document } from '../docs/document.js';
import type { PendingNotice, SimEvent, WorldState } from '../model/state.js';
import { communicationLatency } from './remote.js';

export interface NoticeRoute {
  readonly playerCity: CityId | null | undefined;
  readonly inTransit: boolean;
  readonly latency: Readonly<Record<string, number>>;
  readonly countryOf: (city: string) => string | undefined;
}

export function playerInTransit(state: WorldState): boolean {
  const placed = state.locationOf?.player;
  return placed !== undefined && 'transit' in placed;
}

export function noticeRoute(state: WorldState): NoticeRoute {
  const region = state.region;
  return {
    playerCity: state.player.city,
    inTransit: playerInTransit(state),
    latency: region?.latency ?? {},
    countryOf: (city) => region?.cities[city as CityId]?.country,
  };
}

/** When a notice may first be shown. Same city and slice events wait only until `at`. */
export function noticeRelease(event: SimEvent, route: NoticeRoute): GameTime {
  const there = event.city;
  const here = route.playerCity;
  if (there === undefined || there === null || here === undefined || here === null || there === here) {
    return event.at;
  }
  const wait = communicationLatency(route.latency, there, here, route.countryOf(there), route.countryOf(here));
  return addPhases(event.at, wait);
}

export function enqueueNotices(events: readonly SimEvent[], route: NoticeRoute): readonly PendingNotice[] {
  return events.map((event) => ({ event, releaseAt: noticeRelease(event, route) }));
}

function isCarriage(event: SimEvent): boolean {
  return event.city === null;
}

/** Release notices whose time has come. Transit holds every notice except carriage events. */
export function releaseNotices(
  pending: readonly PendingNotice[],
  now: GameTime,
  inTransit: boolean,
): { readonly due: readonly SimEvent[]; readonly pending: readonly PendingNotice[] } {
  const due: SimEvent[] = [];
  const held: PendingNotice[] = [];
  for (const notice of pending) {
    const ready = compareTime(notice.releaseAt, now) <= 0;
    const carriage = isCarriage(notice.event);
    if (ready && (!inTransit || carriage)) {
      due.push(notice.event);
    } else {
      held.push(notice);
    }
  }
  return { due, pending: held };
}

function editionId(city: CityId, day: number): DocId {
  const local = city.slice('city:'.length);
  return `doc:edition:${local}:${day}` as DocId;
}

function editionCity(id: string): string | undefined {
  const match = /^doc:edition:([^:]+):\d+$/.exec(id);
  if (match === null) {
    return undefined;
  }
  return `city:${match[1]}`;
}

/**
 * Publish one edition per other city, not yet on local kiosks, and put
 * yesterday's foreign editions on the current city's kiosks.
 */
export function publishCityEditions(
  state: WorldState,
  at: GameTime,
  kiosks: readonly LocId[],
): { readonly state: WorldState; readonly events: readonly SimEvent[] } {
  const region = state.region;
  const here = state.player.city;
  if (region === undefined || here === null || here === undefined) {
    return { state, events: [] };
  }
  const documents = { ...state.documents };
  const events: SimEvent[] = [];
  for (const city of region.order) {
    if (city === here) {
      continue;
    }
    const id = editionId(city, at.day);
    if (documents[id] === undefined) {
      const paper: Document = {
        id,
        kind: 'newspaper',
        title: `${city} edition`,
        date: at,
        body: `The ${city} edition for day ${at.day}.`,
        asserts: [],
        obtainableAt: [],
      };
      documents[id] = paper;
      events.push({
        id: `news-evt:${city}:${at.day}` as SimEvent['id'],
        at,
        visibility: 'player',
        city,
        kind: 'newspaper',
        doc: id,
      });
    }
  }
  const yesterday = at.day - 1;
  if (yesterday >= 0) {
    for (const doc of Object.values(documents)) {
      const city = editionCity(doc.id);
      if (city === undefined || city === here || doc.date.day !== yesterday) {
        continue;
      }
      documents[doc.id] = { ...doc, obtainableAt: kiosks };
    }
  }
  return { state: { ...state, documents }, events };
}

/** Slice cable delay plus the latency from the player's city to the hub. */
export function cableLatency(state: WorldState, sliceDelay: number): number {
  const region = state.region;
  const here = state.player.city;
  if (region === undefined || here === null || here === undefined) {
    return sliceDelay;
  }
  const hub = hubCity(state) ?? region.order[0];
  if (hub === undefined) {
    return sliceDelay;
  }
  return sliceDelay + communicationLatency(region.latency, here, hub, region.cities[here]?.country, region.cities[hub]?.country);
}

function hubCity(state: WorldState): CityId | undefined {
  const chief = state.stations?.hub.chief;
  const placed = chief === undefined ? undefined : state.locationOf?.[chief];
  if (placed !== undefined && 'city' in placed) {
    return placed.city;
  }
  return undefined;
}
