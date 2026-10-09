/**
 * Region clock (multi-city task 5.2; Requirements 6.3, 11.1, 11.2, 11.5, 11.7).
 *
 * One phase runs the spine of every city, in template order, on that city's
 * spine stream, then the ambient advance at that city's tier, then the same
 * couplings at either tier. A day boundary then runs each service's daily tick
 * per residency city, service id first and city index second. Arrival
 * reconciliation runs before the arrival fact lines. Slice `advanceWorld` is
 * not this clock: a world with no region never enters here.
 *
 * NPC departures land in `spineTick` when travel does (task 6). The tick
 * already owns the stream, so that work cannot depend on which tier the city
 * was simulated at.
 */

import { addPhases, isDayStart } from '../clock/clock.js';
import { dailyTick } from '../hostile/hostile.js';
import type { DetectionCandidate } from '../hostile/detection.js';
import type { GameTime, Proposition } from '../model/core.js';
import { createPrng, type Prng, type PrngState } from '../prng/prng.js';
import type { CityTier, LocationOf, Placement } from '../region/world.js';
import type { ServiceState } from '../region/services.js';
import { recordRegionTiming, type RegionMetricsTarget } from '../region/metrics-log.js';
import { cityDailySeed } from '../region/streams.js';

import { applyCouplings, emptyCouplingDraft, type CouplingDraft } from './apply.js';
import { AmbientContractError } from './contract.js';
import type { AmbientSimulator, CityId, ServiceId, SpineView } from './types.js';

export interface RegionClockState<S> {
  readonly time: GameTime;
  readonly seed: string;
  readonly order: readonly CityId[];
  readonly playerCity: CityId | null;
  readonly tiers: Readonly<Record<CityId, CityTier>>;
  readonly spine: Readonly<Record<CityId, PrngState>>;
  readonly ambientStreams: Readonly<Record<CityId, PrngState>>;
  readonly ambient: Readonly<Record<CityId, S>>;
  readonly placements: SpineView['placements'];
  readonly coupling: CouplingDraft;
  readonly services: Readonly<Record<ServiceId, ServiceState>>;
  readonly serviceLog: readonly { readonly service: ServiceId; readonly city: CityId }[];
  readonly factLines: readonly string[];
  readonly contractLog: readonly string[];
}

export interface RegionClockOptions<S> {
  /** When set, these tiers replace the player-city assignment for this step. */
  readonly tiers?: Readonly<Record<CityId, CityTier>>;
  /** Debug builds throw {@link AmbientContractError} when a sampled city's couplings differ. */
  readonly debug?: boolean;
  readonly candidates?: Readonly<Record<CityId, readonly DetectionCandidate[]>>;
  /** Defaults to reading a `disclosed` list off the ambient state. */
  readonly holdsDisclosed?: (state: S, facts: readonly Proposition[]) => boolean;
  /** When set and enabled, coarse, full and reconciliation timings are logged. */
  readonly metrics?: RegionMetricsTarget;
}

/** Full for the city the player is in. Coarse everywhere else, and for every city during transit. */
export function assignTiers(
  order: readonly CityId[],
  playerCity: CityId | null,
): Record<CityId, CityTier> {
  const tiers: Record<CityId, CityTier> = {};
  for (const city of order) {
    tiers[city] = playerCity !== null && city === playerCity ? 'full' : 'coarse';
  }
  return tiers;
}

/**
 * Advance one city's spine stream. The draw is the clock's consumption of that
 * stream; plot stages, schedules and departures extend this function later and
 * must keep using the same `rng`.
 */
/** Draw the city's spine stream, then apply one departure placement. */
export function spineTick(
  _city: CityId,
  rng: Prng,
  move?: { readonly locationOf: LocationOf; readonly who: string; readonly next: Placement },
): LocationOf | undefined {
  rng.next();
  if (move === undefined) {
    return undefined;
  }
  return { ...move.locationOf, [move.who]: move.next };
}

/** Service id, then residency cities in region order. */
export function serviceTickOrder(
  order: readonly CityId[],
  services: Readonly<Record<ServiceId, ServiceState>>,
): readonly { readonly service: ServiceId; readonly city: CityId }[] {
  const index = new Map(order.map((city, at) => [city, at]));
  const ticks: { service: ServiceId; city: CityId }[] = [];
  const ids = Object.keys(services).sort((a, b) => a.localeCompare(b));
  for (const service of ids) {
    const record = services[service as ServiceId];
    if (record === undefined) {
      continue;
    }
    const cities = Object.keys(record.residencies).sort((a, b) => {
      const left = index.get(a as CityId);
      const right = index.get(b as CityId);
      if (left !== undefined && right !== undefined) {
        return left - right;
      }
      if (left !== undefined) {
        return -1;
      }
      if (right !== undefined) {
        return 1;
      }
      return a.localeCompare(b);
    });
    for (const city of cities) {
      ticks.push({ service: service as ServiceId, city: city as CityId });
    }
  }
  return ticks;
}

/** Spine fact lines for an arrival: who the spine places in the city. Ambient text is not included. */
export function arrivalFactLines(spine: SpineView, city: CityId): readonly string[] {
  const lines: string[] = [];
  const ids = Object.keys(spine.placements).sort((a, b) => a.localeCompare(b));
  for (const id of ids) {
    const place = spine.placements[id];
    if (place !== undefined && place.city === city) {
      lines.push(`${id} at ${place.loc}`);
    }
  }
  return lines;
}

/** Spine fields only. Ambient state and fidelity tiers are left out. */
export function spineProjection<S>(state: RegionClockState<S>): {
  readonly time: GameTime;
  readonly spine: RegionClockState<S>['spine'];
  readonly coupling: CouplingDraft;
  readonly services: RegionClockState<S>['services'];
  readonly serviceLog: RegionClockState<S>['serviceLog'];
  readonly factLines: readonly string[];
  readonly placements: SpineView['placements'];
} {
  return {
    time: state.time,
    spine: state.spine,
    coupling: state.coupling,
    services: state.services,
    serviceLog: state.serviceLog,
    factLines: state.factLines,
    placements: state.placements,
  };
}

export function initialRegionClock<S>(input: {
  readonly seed: string;
  readonly order: readonly CityId[];
  readonly playerCity: CityId | null;
  readonly ambient: Readonly<Record<CityId, S>>;
  readonly spine: Readonly<Record<CityId, PrngState>>;
  readonly ambientStreams: Readonly<Record<CityId, PrngState>>;
  readonly services?: Readonly<Record<ServiceId, ServiceState>>;
  readonly placements?: SpineView['placements'];
  readonly time?: GameTime;
}): RegionClockState<S> {
  return {
    time: input.time ?? { day: 0, phase: 0 },
    seed: input.seed,
    order: input.order,
    playerCity: input.playerCity,
    tiers: assignTiers(input.order, input.playerCity),
    spine: input.spine,
    ambientStreams: input.ambientStreams,
    ambient: input.ambient,
    placements: input.placements ?? {},
    coupling: emptyCouplingDraft(),
    services: input.services ?? {},
    serviceLog: [],
    factLines: [],
    contractLog: [],
  };
}

function debugBuild(flag: boolean | undefined): boolean {
  if (flag !== undefined) {
    return flag;
  }
  return process.env.NODE_ENV !== 'production';
}

function spineViewOf<S>(state: RegionClockState<S>): SpineView {
  return { time: state.time, placements: state.placements };
}

function disclosedHolds<S>(
  state: S,
  facts: readonly Proposition[],
  holds: RegionClockOptions<S>['holdsDisclosed'],
): boolean {
  if (holds !== undefined) {
    return holds(state, facts);
  }
  if (typeof state !== 'object' || state === null || !('disclosed' in state)) {
    return true;
  }
  const disclosed = (state as { readonly disclosed?: readonly Proposition[] }).disclosed;
  if (!Array.isArray(disclosed)) {
    return facts.length === 0;
  }
  const ids = new Set(disclosed.map((fact) => fact.id));
  return facts.every((fact) => ids.has(fact.id));
}

function probeCouplings<S>(
  simulator: AmbientSimulator<S>,
  city: CityId,
  before: S,
  stream: PrngState,
  spine: SpineView,
): string | undefined {
  const full = simulator.advanceFull(city, before, spine, createPrng(stream));
  const coarse = simulator.advanceCoarse(city, before, spine, createPrng(stream));
  const fullCouplings = simulator.couplings(city, full.next, spine.time);
  const coarseCouplings = simulator.couplings(city, coarse.next, spine.time);
  if (JSON.stringify(fullCouplings) !== JSON.stringify(coarseCouplings)) {
    return `couplings differ between tiers in ${city}`;
  }
  return undefined;
}

function tickServices<S>(
  state: RegionClockState<S>,
  at: GameTime,
  candidates: Readonly<Record<CityId, readonly DetectionCandidate[]>>,
): { services: Record<ServiceId, ServiceState>; serviceLog: RegionClockState<S>['serviceLog'] } {
  const ticks = serviceTickOrder(state.order, state.services);
  const services: Record<ServiceId, ServiceState> = { ...state.services };
  const daily = new Map<CityId, ReturnType<typeof createPrng>>();
  const serviceLog = [...state.serviceLog];
  for (const tick of ticks) {
    const service = services[tick.service];
    if (service === undefined) {
      continue;
    }
    let rng = daily.get(tick.city);
    if (rng === undefined) {
      const index = state.order.indexOf(tick.city);
      rng = createPrng(cityDailySeed(state.seed, index < 0 ? 0 : index, at.day));
      daily.set(tick.city, rng);
    }
    const result = dailyTick(
      { doctrine: service.doctrine, beliefs: service.beliefs },
      candidates[tick.city] ?? [],
      at,
      rng,
    );
    services[tick.service] = {
      ...service,
      doctrine: result.next.doctrine,
      beliefs: { ...service.beliefs, ...result.next.beliefs },
    };
    serviceLog.push(tick);
  }
  return { services, serviceLog };
}

/**
 * One region phase. Spine streams move before any ambient advance, and the
 * couplings applied are the ones `couplings` reports for the tier that ran.
 */
export function advanceRegion<S>(
  state: RegionClockState<S>,
  simulator: AmbientSimulator<S>,
  options: RegionClockOptions<S> = {},
): RegionClockState<S> {
  const tiers = options.tiers ?? assignTiers(state.order, state.playerCity);
  const debug = debugBuild(options.debug);
  const spineView = spineViewOf(state);
  const sample = state.order[state.time.day % state.order.length];
  const spine: Record<CityId, PrngState> = { ...state.spine };
  for (const city of state.order) {
    const saved = spine[city];
    if (saved === undefined) {
      throw new Error(`region clock has no spine stream for ${city}`);
    }
    const rng = createPrng(saved);
    spineTick(city, rng);
    spine[city] = rng.state();
  }

  const ambient: Record<CityId, S> = { ...state.ambient };
  const ambientStreams: Record<CityId, PrngState> = { ...state.ambientStreams };
  let coupling = state.coupling;
  const contractLog = [...state.contractLog];
  for (const city of state.order) {
    const before = ambient[city];
    const stream = ambientStreams[city];
    if (before === undefined || stream === undefined) {
      throw new Error(`region clock has no ambient state for ${city}`);
    }
    if (city === sample) {
      const mismatch = probeCouplings(simulator, city, before, stream, spineView);
      if (mismatch !== undefined) {
        if (debug) {
          throw new AmbientContractError(mismatch);
        }
        contractLog.push(mismatch);
      }
    }
    const rng = createPrng(stream);
    const tier = tiers[city] === 'full' ? 'full' : 'coarse';
    const started = performance.now();
    const step =
      tier === 'full'
        ? simulator.advanceFull(city, before, spineView, rng)
        : simulator.advanceCoarse(city, before, spineView, rng);
    recordRegionTiming(options.metrics, {
      purpose: tier === 'full' ? 'region-advance-full' : 'region-advance-coarse',
      durationMs: performance.now() - started,
      day: state.time.day,
      phase: state.time.phase,
      city,
    });
    ambient[city] = step.next;
    ambientStreams[city] = rng.state();
    coupling = applyCouplings(coupling, simulator.couplings(city, step.next, spineView.time));
  }

  const time = addPhases(state.time, 1);
  let services = state.services;
  let serviceLog = state.serviceLog;
  if (isDayStart(time)) {
    const ticked = tickServices({ ...state, time }, time, options.candidates ?? {});
    services = ticked.services;
    serviceLog = ticked.serviceLog;
  }

  return {
    ...state,
    time,
    tiers,
    spine,
    ambient,
    ambientStreams,
    coupling,
    services,
    serviceLog,
    factLines: [],
    contractLog,
  };
}

/**
 * The player arrives in `city`. Reconciliation runs on the coarse ambient
 * state first. Fact lines are read from the spine after that, so a rejected
 * reconciliation cannot change them.
 */
export function arrive<S>(
  state: RegionClockState<S>,
  city: CityId,
  disclosed: readonly Proposition[],
  simulator: AmbientSimulator<S>,
  options: RegionClockOptions<S> = {},
): RegionClockState<S> {
  if (!state.order.includes(city)) {
    throw new Error(`region clock cannot arrive in ${city}`);
  }
  const before = state.ambient[city];
  const stream = state.ambientStreams[city];
  if (before === undefined || stream === undefined) {
    throw new Error(`region clock has no ambient state for ${city}`);
  }
  const spineView = spineViewOf(state);
  const rng = createPrng(stream);
  const started = performance.now();
  const reconciled = simulator.reconcile(city, before, spineView, disclosed, rng);
  recordRegionTiming(options.metrics, {
    purpose: 'region-reconcile',
    durationMs: performance.now() - started,
    day: state.time.day,
    phase: state.time.phase,
    city,
  });
  const contractLog = [...state.contractLog];
  let next = reconciled;
  if (!disclosedHolds(reconciled, disclosed, options.holdsDisclosed)) {
    next = before;
    contractLog.push(`reconciliation contradicted a disclosed fact in ${city}`);
  }
  const playerCity = city;
  return {
    ...state,
    playerCity,
    tiers: assignTiers(state.order, playerCity),
    ambient: { ...state.ambient, [city]: next },
    ambientStreams: { ...state.ambientStreams, [city]: rng.state() },
    factLines: arrivalFactLines(spineView, city),
    contractLog,
  };
}
