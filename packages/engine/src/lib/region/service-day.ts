/**
 * One regional service day (multi-city task 7.1; Requirements 6.2–6.9).
 *
 * The region clock already runs `dailyTick` per residency. This pass follows
 * that tick: it delivers shared beliefs after their delay, lets rival hostile
 * services compete and expose agents, and applies the burn rule and persona
 * non grata. Slice worlds never call it.
 */

import { dailyTick } from '../hostile/hostile.js';
import { adoptBelief } from '../hostile/beliefs.js';
import type { DetectionCandidate } from '../hostile/detection.js';
import { serviceTickOrder } from '../fidelity/clock.js';
import { cityDailySeed } from './streams.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { timeToPhases, type GameTime, type LocId, type NpcId, type Proposition } from '../model/core.js';
import type { CityId, IRouteId, ServiceId } from '../fidelity/types.js';
import type { EndCondition } from '../endings/end-conditions.js';
import type { SimEvent } from '../model/state.js';
import type { RivalryEdge, ServiceState } from './services.js';

export interface QueuedShare {
  readonly from: ServiceId;
  readonly to: ServiceId;
  readonly prop: Proposition;
  readonly queuedAt: number;
  readonly delay: number;
}

export interface BeliefAdoption {
  readonly service: ServiceId;
  readonly prop: Proposition;
  readonly origin: 'detection' | 'share' | 'penetration';
  readonly from?: ServiceId;
  readonly delay?: number;
}

export interface ServiceRoute {
  readonly id: IRouteId;
  readonly fromCity?: CityId;
  readonly toCity?: CityId;
  readonly to?: LocId;
  readonly duration: number;
}

export interface ServiceCity {
  readonly id: CityId;
  readonly country?: string;
}

export interface ServiceDayInput {
  readonly seed: string;
  readonly order: readonly CityId[];
  readonly services: Readonly<Record<ServiceId, ServiceState>>;
  readonly rivalry: readonly RivalryEdge[];
  readonly candidates: Readonly<Record<CityId, readonly DetectionCandidate[]>>;
  readonly at: GameTime;
  readonly shares: readonly QueuedShare[];
  readonly burnThreshold: number;
  readonly playerCity: CityId | null;
  readonly countries: readonly string[];
  readonly cities: readonly ServiceCity[];
  readonly routes: readonly ServiceRoute[];
  readonly png: readonly string[];
  readonly burned: boolean;
}

export interface ServiceDayResult {
  readonly services: Readonly<Record<ServiceId, ServiceState>>;
  readonly shares: readonly QueuedShare[];
  readonly events: readonly SimEvent[];
  readonly png: readonly string[];
  readonly burned: boolean;
  readonly playerCity: CityId | null;
  readonly playerLoc?: LocId;
  readonly ended?: EndCondition;
  readonly adoptions: readonly BeliefAdoption[];
}

function beliefKey(prop: Proposition): string {
  return `${prop.predicate}|${prop.subject}|${JSON.stringify(prop.object)}`;
}

function countryOf(cities: readonly ServiceCity[], city: CityId | null): string | undefined {
  if (city === null) {
    return undefined;
  }
  return cities.find((item) => item.id === city)?.country;
}

function localSecurity(services: Readonly<Record<ServiceId, ServiceState>>, country: string | undefined): ServiceState | undefined {
  if (country === undefined) {
    return undefined;
  }
  return Object.values(services).find((service) => service.kind === 'local-security' && service.country === country);
}

/** Run the residency ticks, then sharing, rivalry, burn and expulsion. */
export function serviceDay(input: ServiceDayInput): ServiceDayResult {
  const ticks = serviceTickOrder(input.order, input.services);
  const services: Record<ServiceId, ServiceState> = { ...input.services };
  const before = new Map<ServiceId, readonly string[]>();
  for (const service of Object.values(services)) {
    before.set(service.id, service.beliefs.adopted.map(beliefKey));
  }
  const daily = new Map<CityId, Prng>();
  const events: SimEvent[] = [];
  const adoptions: BeliefAdoption[] = [];
  for (const tick of ticks) {
    const service = services[tick.service];
    if (service === undefined) {
      continue;
    }
    let rng = daily.get(tick.city);
    if (rng === undefined) {
      const index = input.order.indexOf(tick.city);
      rng = createPrng(cityDailySeed(input.seed, index < 0 ? 0 : index, input.at.day));
      daily.set(tick.city, rng);
    }
    const result = dailyTick(
      { doctrine: service.doctrine, beliefs: service.beliefs },
      input.candidates[tick.city] ?? [],
      input.at,
      rng,
    );
    const beliefs = { ...service.beliefs, ...result.next.beliefs };
    services[tick.service] = { ...service, doctrine: result.next.doctrine, beliefs };
    for (const event of result.events) {
      events.push(event);
      if (event.kind === 'asset-detected' && service.kind !== 'liaison') {
        adoptions.push({ service: service.id, prop: located(event.npc, tick.city), origin: 'detection' });
      }
      if (event.kind === 'asset-arrested' && service.kind === 'local-security') {
        events.push({
          id: `public-arrest-${event.npc}-${input.at.day}`,
          at: input.at,
          visibility: 'player',
          city: tick.city,
          kind: 'public-announcement',
          text: `The local security service arrests ${event.npc}.`,
        });
      }
    }
  }

  const now = timeToPhases(input.at);
  const shares = [...input.shares];
  for (const service of Object.values(services)) {
    const seen = new Set(before.get(service.id) ?? []);
    for (const prop of service.beliefs.adopted) {
      if (seen.has(beliefKey(prop))) {
        continue;
      }
      for (const edge of input.rivalry) {
        if (edge.share && edge.from === service.id && services[edge.to] !== undefined) {
          shares.push({
            from: service.id,
            to: edge.to,
            prop,
            queuedAt: now,
            delay: edge.delayPhases,
          });
        }
      }
    }
  }

  const pending: QueuedShare[] = [];
  for (const share of shares) {
    if (now < share.queuedAt + share.delay) {
      pending.push(share);
      continue;
    }
    const receiver = services[share.to];
    if (receiver === undefined) {
      continue;
    }
    const adopted = adoptBelief(receiver.beliefs, share.prop);
    services[share.to] = { ...receiver, beliefs: { ...receiver.beliefs, ...adopted.beliefs } };
    adoptions.push({
      service: share.to,
      prop: share.prop,
      origin: 'share',
      from: share.from,
      delay: share.delay,
    });
    events.push({
      id: `share-${share.from}-${share.to}-${share.prop.id}`,
      at: input.at,
      visibility: 'hidden',
      kind: 'belief-shared',
      from: share.from,
      to: share.to,
    });
  }

  const exposureRng = createPrng(cityDailySeed(input.seed, input.order.length, input.at.day));
  exposeRivals(services, input.rivalry, input.cities, input.at, exposureRng, events);

  return applyStanding({
    services,
    shares: pending,
    events,
    adoptions,
    input,
  });
}

function located(npc: NpcId, city: CityId): Proposition {
  return {
    id: `prop:detected-${npc}`,
    subject: npc,
    predicate: 'LOCATED_AT',
    object: { kind: 'text', value: city },
  };
}

function exposeRivals(
  services: Record<ServiceId, ServiceState>,
  rivalry: readonly RivalryEdge[],
  cities: readonly ServiceCity[],
  at: GameTime,
  rng: Prng,
  events: SimEvent[],
): void {
  for (const edge of rivalry) {
    if (!edge.compete) {
      continue;
    }
    const left = services[edge.from];
    const right = services[edge.to];
    if (left === undefined || right === undefined || left.kind !== 'hostile' || right.kind !== 'hostile') {
      continue;
    }
    const pitcher = left.doctrine.riskTolerance > right.doctrine.riskTolerance
      || (left.doctrine.riskTolerance === right.doctrine.riskTolerance && left.id < right.id)
      ? left
      : right;
    const other = pitcher === left ? right : left;
    const shared = pitcher.beliefs.suspectedAssets.filter((npc) => other.beliefs.suspectedAssets.includes(npc));
    if (shared.length > 0) {
      const target = shared[0];
      if (target !== undefined) {
        events.push({
          id: `compete-${pitcher.id}-${at.day}`,
          at,
          visibility: 'hidden',
          kind: 'rival-exposure',
          npc: target,
          service: pitcher.id,
        });
      }
    }
    for (const city of Object.keys(other.residencies) as CityId[]) {
      const residency = other.residencies[city];
      if (residency === undefined) {
        continue;
      }
      const country = countryOf(cities, city);
      const arresting = localSecurity(services, country)
        ?? Object.values(services).find((service) => service.kind === 'local-security');
      for (const officer of residency.officers) {
        if (rng.next() >= edge.expose) {
          continue;
        }
        events.push({
          id: `expose-${officer}-${at.day}`,
          at,
          visibility: 'hidden',
          city,
          kind: 'rival-exposure',
          npc: officer,
          service: arresting?.id ?? pitcher.id,
        });
        events.push({
          id: `public-expose-${officer}-${at.day}`,
          at,
          visibility: 'player',
          city,
          kind: 'public-announcement',
          text: `The local security service arrests ${officer}.`,
        });
      }
    }
  }
}

function applyStanding(args: {
  readonly services: Record<ServiceId, ServiceState>;
  readonly shares: readonly QueuedShare[];
  readonly events: SimEvent[];
  readonly adoptions: BeliefAdoption[];
  readonly input: ServiceDayInput;
}): ServiceDayResult {
  const png = [...args.input.png];
  let burned = args.input.burned;
  let playerCity = args.input.playerCity;
  let playerLoc: LocId | undefined;
  for (const service of Object.values(args.services)) {
    if (service.beliefs.coverSuspicion < args.input.burnThreshold) {
      continue;
    }
    if (service.kind === 'hostile') {
      burned = true;
      args.events.push({
        id: `burned-${service.id}`,
        at: args.input.at,
        visibility: 'hidden',
        kind: 'player-burned',
      });
    }
    if (service.kind === 'local-security' && service.country !== undefined && !png.includes(service.country)) {
      png.push(service.country);
      const here = countryOf(args.input.cities, playerCity);
      if (here === service.country) {
        const exile = exileTo(args.input, png, playerCity);
        if (exile !== undefined) {
          playerCity = exile.city;
          playerLoc = exile.loc;
          args.events.push({
            id: `expelled-${service.country}`,
            at: args.input.at,
            visibility: 'player',
            city: exile.city,
            kind: 'expelled',
            country: service.country,
          });
        }
      }
    }
  }
  const everyCountry = args.input.countries.length > 0 && args.input.countries.every((country) => png.includes(country));
  if (everyCountry) {
    burned = true;
  }
  const ended: EndCondition | undefined = burned
    ? { outcome: 'failure', at: args.input.at, cause: 'burned' }
    : undefined;
  return {
    services: args.services,
    shares: args.shares,
    events: args.events,
    png,
    burned,
    playerCity,
    ...(playerLoc === undefined ? {} : { playerLoc }),
    ...(ended === undefined ? {} : { ended }),
    adoptions: args.adoptions,
  };
}

function exileTo(
  input: ServiceDayInput,
  png: readonly string[],
  from: CityId | null,
): { readonly city: CityId; readonly loc?: LocId } | undefined {
  const open = input.cities.filter((city) => city.country === undefined || !png.includes(city.country));
  const routes = input.routes
    .filter((route) => route.fromCity === from && route.toCity !== undefined)
    .filter((route) => open.some((city) => city.id === route.toCity))
    .sort((a, b) => a.duration - b.duration || (a.toCity ?? '').localeCompare(b.toCity ?? ''));
  const nearest = routes[0];
  if (nearest?.toCity !== undefined) {
    return { city: nearest.toCity, ...(nearest.to === undefined ? {} : { loc: nearest.to }) };
  }
  const fallback = open.find((city) => city.id !== from);
  return fallback === undefined ? undefined : { city: fallback.id };
}

/** A mole reports only what its posting can see. A hub posting sees every city. */
export function visibleToPosting(hub: boolean, posting: CityId, city: CityId): boolean {
  return hub || city === posting;
}

export function leakageBounded(
  adoptions: readonly BeliefAdoption[],
  relayed: readonly Proposition[],
  shared: readonly Proposition[],
  mole: readonly { readonly city: CityId; readonly hub: boolean; readonly seen: readonly CityId[] }[],
): boolean {
  for (const adoption of adoptions) {
    if (adoption.origin === 'share' && (adoption.from === undefined || adoption.delay === undefined || adoption.delay < 0)) {
      return false;
    }
    if (adoption.origin === 'penetration' && adoption.from === undefined) {
      return false;
    }
  }
  if (relayed.length !== shared.length) {
    return false;
  }
  for (let index = 0; index < shared.length; index += 1) {
    if (relayed[index]?.id !== shared[index]?.id) {
      return false;
    }
  }
  return mole.every((report) => report.hub || report.seen.every((city) => city === report.city));
}
