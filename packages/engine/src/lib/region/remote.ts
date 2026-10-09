/**
 * Remote assets (multi-city task 9.1; Requirement 8).
 *
 * A task sent to another city waits out the communication latency, and its
 * report waits out the reporting channel. Travel and exfiltration run the
 * departure's border checks. A resettled asset drops out of every service's
 * exposure.
 */

import { addPhases } from '../clock/clock.js';
import { borderCheck } from '../border/check.js';
import { chooseResponse } from '../hostile/detection.js';
import { asTruth, revealTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { CityId, IRouteId, ServiceId } from '../fidelity/types.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { ServiceState } from './services.js';
import type { Relationship } from '../recruit/asset.js';
import type { ActionQuote, ActionResult } from '../action/result.js';
import type { ExfiltrateAction, TaskAction } from '../action/types.js';
import type { TravelDocument } from './world.js';

export type ReportingChannel = 'radio' | 'courier' | 'dead-drop' | 'numbers';

export function communicationLatency(
  latency: Readonly<Record<string, number>>,
  from: CityId,
  to: CityId,
  fromCountry: string | undefined,
  toCountry: string | undefined,
): number {
  if (from === to) {
    return 0;
  }
  if (fromCountry !== undefined && fromCountry === toCountry) {
    return latency['sameCountry'] ?? 0;
  }
  return latency['crossBorder'] ?? latency['acrossCurtain'] ?? 0;
}

/** Phases a finished task still needs before its report reaches the case file. */
export function channelDelay(kind: ReportingChannel, transit: number): number {
  if (kind === 'courier') {
    return transit;
  }
  if (kind === 'dead-drop') {
    return 1;
  }
  return 0;
}

export function resultReadyAt(sent: GameTime, latency: number, kind: ReportingChannel, transit: number): GameTime {
  return addPhases(sent, latency + channelDelay(kind, transit));
}

export function assetCity(state: WorldState, asset: NpcId): CityId | null {
  const placed = state.locationOf?.[asset];
  if (placed !== undefined && 'city' in placed) {
    return placed.city;
  }
  return state.player.city ?? null;
}

/** Extra phases a task needs when the asset is in another city. Zero in slice play. */
export function remoteLatency(state: WorldState, asset: NpcId): number {
  const region = state.region;
  const here = state.player.city;
  const there = assetCity(state, asset);
  if (region === undefined || here === null || here === undefined || there === null || here === there) {
    return 0;
  }
  return communicationLatency(
    region.latency,
    here,
    there,
    region.cities[here]?.country,
    region.cities[there]?.country,
  );
}

/** Exposure of one asset against every service that resides in their city. */
export function exposureByService(
  asset: NpcId,
  city: CityId,
  exposure: number,
  services: Readonly<Record<ServiceId, ServiceState>>,
  resettled: boolean,
): readonly { readonly service: ServiceId; readonly exposure: number }[] {
  if (resettled) {
    return [];
  }
  const rows: { service: ServiceId; exposure: number }[] = [];
  for (const service of Object.values(services)) {
    if (service.residencies[city] === undefined) {
      continue;
    }
    rows.push({ service: service.id, exposure });
  }
  rows.sort((a, b) => a.service.localeCompare(b.service));
  void asset;
  return rows;
}

function papersOf(state: WorldState, ids: readonly string[]): TravelDocument[] {
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

function empty(state: WorldState): ActionResult {
  return {
    observations: [],
    factLines: [],
    scene: { loc: state.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
    events: [],
    claimsAdded: [],
  };
}

function routeOf(state: WorldState, id: IRouteId) {
  return state.region?.intercity[id];
}

export function quoteExfiltrate(state: WorldState, action: ExfiltrateAction): ActionQuote {
  if (state.region === undefined) {
    return { allowed: false, reason: 'this game has no region', phases: 0, money: 0 };
  }
  const rel = state.relationships[action.asset];
  if (rel === undefined || !rel.recruited || !rel.channel) {
    return { allowed: false, reason: 'that asset has no contact channel', phases: 0, money: 0 };
  }
  const route = routeOf(state, action.route);
  if (route === undefined) {
    return { allowed: false, reason: 'no such route', phases: 0, money: 0 };
  }
  return { allowed: true, phases: route.duration, money: 0 };
}

export function resolveExfiltrate(
  state: WorldState,
  action: ExfiltrateAction,
  rng: Prng,
): { readonly next: WorldState; readonly result: ActionResult } {
  return crossBorder(state, action, rng, true);
}

function crossBorder(
  state: WorldState,
  action: ExfiltrateAction,
  rng: Prng,
  resettle: boolean,
): { readonly next: WorldState; readonly result: ActionResult } {
  const quoted = quoteExfiltrate(state, action);
  const region = state.region;
  const route = region?.intercity[action.route];
  const rel = state.relationships[action.asset];
  if (!quoted.allowed || region === undefined || route === undefined || rel === undefined || route.toCity === undefined) {
    return { next: state, result: empty(state) };
  }
  const rules = region.rules ?? {
    detentionPhases: 1,
    contrabandCashThreshold: 40,
    papersDelay: 1,
    papersCost: 10,
    watchListSensitivity: 0.5,
  };
  let detained = false;
  let seized = false;
  let serviceId: ServiceId | undefined;
  for (const postId of route.borders) {
    const post = region.borderPosts[postId];
    if (post === undefined) {
      continue;
    }
    serviceId = post.service;
    const checked = borderCheck(
      {
        post: { id: post.id, name: post.id, strictness: post.strictness, documents: post.documents },
        at: action.at,
        traveller: { identity: action.asset, descriptor: action.asset, coverFits: true },
        papers: papersOf(state, action.papers),
        items: [],
        watch: { persons: [], descriptors: [] },
        rules,
      },
      rng,
    );
    if (checked.outcome === 'seizure') {
      seized = true;
    }
    if (checked.outcome === 'detained') {
      detained = true;
      break;
    }
    if (checked.outcome === 'refused') {
      return held(state, action.asset, 'refused', rel);
    }
  }
  if (detained) {
    const service = serviceId === undefined ? undefined : state.services?.[serviceId];
    const hold = service === undefined
      ? 'arrest'
      : chooseResponse(service.doctrine, { turnedByPlayer: rel.asset?.turned ?? false, agentSuspicion: 0 });
    const release = hold === 'feed' ? 'release' : hold;
    return held(state, action.asset, release, rel);
  }
  const dest = route.toCity;
  const loc: LocId = route.to;
  const access = rel.asset === undefined
    ? undefined
    : {
        ...rel.asset,
        access: asTruth({
          ...revealTruth(rel.asset.access),
          locs: [...revealTruth(rel.asset.access).locs, loc],
        }),
      };
  const nextRel: Relationship = {
    ...rel,
    exposure: resettle ? 0 : rel.exposure,
    ...(resettle && !seized ? { resettled: true } : {}),
    ...(access === undefined ? {} : { asset: access }),
  };
  const event: SimEvent = {
    id: `exfil-${action.asset}`,
    at: addPhases(state.time, route.duration),
    visibility: 'player',
    city: dest,
    kind: 'asset-arrived',
    npc: action.asset,
  };
  const line = resettle && !seized
    ? `${action.asset} is resettled in ${dest}.`
    : `${action.asset} arrives in ${dest}.`;
  const next: WorldState = {
    ...state,
    time: addPhases(state.time, route.duration),
    relationships: { ...state.relationships, [action.asset]: nextRel },
    locationOf: state.locationOf === undefined
      ? undefined
      : { ...state.locationOf, [action.asset]: { city: dest, loc } },
    scheduled: [...state.scheduled, event],
  };
  return {
    next,
    result: {
      observations: [{ kind: 'message', line }],
      factLines: [line],
      scene: { loc: state.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
      events: [event],
      claimsAdded: [],
    },
  };
}

function held(
  state: WorldState,
  asset: NpcId,
  hold: 'arrest' | 'double' | 'release' | 'refused',
  rel: Relationship,
): { readonly next: WorldState; readonly result: ActionResult } {
  let nextRel = rel;
  if (hold === 'arrest') {
    nextRel = { ...rel, custody: { by: 'hostile', since: state.time } };
  }
  if (hold === 'double' && rel.asset !== undefined) {
    nextRel = { ...rel, asset: { ...rel.asset, hostileControlled: asTruth(true) } };
  }
  const line = `${asset} is ${hold} at the border.`;
  const next: WorldState = {
    ...state,
    relationships: { ...state.relationships, [asset]: nextRel },
  };
  return {
    next,
    result: {
      observations: [{ kind: 'message', line }],
      factLines: [line],
      scene: { loc: state.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
      events: [],
      claimsAdded: [],
    },
  };
}

/** Travel uses the same border path as exfiltration, and keeps the asset in play. */
export function resolveTravelTask(
  state: WorldState,
  action: TaskAction & { readonly task: { readonly kind: 'travel'; readonly route: IRouteId; readonly at: GameTime; readonly papers: readonly `paper:${string}`[] } },
  rng: Prng,
): { readonly next: WorldState; readonly result: ActionResult } {
  return crossBorder(
    state,
    { kind: 'exfiltrate', asset: action.asset, route: action.task.route, at: action.task.at, papers: action.task.papers },
    rng,
    false,
  );
}
