/**
 * Ambient-world's AmbientSimulator. Full runs the existing day and phase
 * steps. Coarse runs the same gossip inputs (ties, promotions, duties) and
 * skips life, news, and incidents. Hooks queue as couplings while multiCity is set,
 * and overlays of location status, curfew, crowd and routes are read back as
 * couplings. This path does not write the plot spine.
 */

import type { AmbientContract } from '../fidelity/contract.js';
import type {
  AmbientCoupling,
  AmbientOriginEvent,
  AmbientSimulator,
  CityId,
  IRouteId,
  SpineView,
} from '../fidelity/types.js';
import { revealTruth, type GameTime, type LocId, type NpcId, type Proposition } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';

import { stepCityEvents } from './city-step.js';
import { settleDuties, stepCover } from './cover.js';
import { stepGossip } from './gossip.js';
import { emptyLife, stepLife } from './life.js';
import { memoryOf, stepMemory } from './memory.js';
import { refreshPromptCache } from './prompt.js';
import { stepPopulace } from './populace.js';
import { stepThreads } from './threads.js';
import { threadCatalogue } from './thread-catalogue.js';
import { stepTies } from './ties.js';
import { ambientDayBoundary, ambientPhase, resetAmbientDay } from './tick.js';
import type { Overlay } from './locations.js';
import { regionGraphFor } from '../region/verify.js';
import type { AmbientState } from './state.js';

export interface CityAmbient {
  readonly world: WorldState;
  readonly disclosed: readonly Proposition[];
}

const PHASES = [0, 1, 2, 3] as const;

function cityOf(world: WorldState): CityId {
  const raw = world.ambient?.cityId ?? 'unknown';
  return (raw.startsWith('city:') ? raw : `city:${raw}`) as CityId;
}

function atTime(world: WorldState, time: GameTime): WorldState {
  return { ...world, time };
}

function attachedRegion(
  region: AmbientState['region'],
  seed: string | undefined,
): { readonly region: NonNullable<AmbientState['region']> } | Record<string, never> {
  if (region !== undefined) {
    return {};
  }
  const registered = seed === undefined ? undefined : regionGraphFor(seed);
  return registered === undefined ? {} : { region: registered };
}

function arm(world: WorldState, spine?: SpineView): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      multiCity: true,
      pendingCouplings: ambient.pendingCouplings ?? [],
      ...(spine === undefined ? {} : { spinePlacements: spine.placements }),
      ...attachedRegion(ambient.region, world.meta?.seed),
    },
  };
}

/** Placements are an input to this step, not city state. */
function release(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient?.spinePlacements === undefined) {
    return world;
  }
  const { spinePlacements, ...rest } = ambient;
  void spinePlacements;
  return { ...world, ambient: rest };
}

function tag(events: readonly SimEvent[]): AmbientOriginEvent[] {
  return events.map((event) => ({
    kind: event.kind,
    origin: 'ambient' as const,
    visibility: event.visibility,
  }));
}

function asLoc(value: string): LocId {
  return (value.startsWith('loc:') ? value : `loc:${value}`) as LocId;
}

function asRoute(value: string): IRouteId {
  return (value.startsWith('route:') ? value : `route:${value}`) as IRouteId;
}

function overlayCouplings(overlays: readonly Overlay[], t: GameTime): AmbientCoupling[] {
  const found: AmbientCoupling[] = [];
  for (const overlay of overlays) {
    if (t.day < overlay.fromDay || t.day >= overlay.toDay) {
      continue;
    }
    const effect = overlay.effect;
    if (effect.kind === 'location-status' && effect.status !== 'open' && effect.status !== 'newly-opened') {
      found.push({ kind: 'location-closed', loc: asLoc(overlay.target), phases: 4 });
    } else if (effect.kind === 'curfew') {
      found.push({ kind: 'location-closed', loc: asLoc(overlay.target), phases: effect.phases.length });
    } else if (effect.kind === 'crowd-modifier') {
      found.push({ kind: 'crowd-modifier', loc: asLoc(overlay.target), factor: effect.factor });
    } else if (effect.kind === 'route-closure' || effect.kind === 'route-checkpoint') {
      found.push({ kind: 'route-delay', route: asRoute(overlay.target), phases: 4 });
    }
  }
  return found;
}

function couplingsOf(ambient: AmbientState | undefined, t: GameTime): readonly AmbientCoupling[] {
  if (ambient === undefined) {
    return [];
  }
  return [...overlayCouplings(ambient.overlays, t), ...(ambient.pendingCouplings ?? [])];
}

/**
 * Decay, events, cover, threads, gossip, and memory. Life, news and incidents
 * stay on the full tier. Tie drift and promotions run in the phase loop,
 * because the next day's gossip reads both.
 */
function sharedDay(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  let state = stepCityEvents(resetAmbientDay(world));
  state = stepCover(state);
  state = stepThreads(state, threadCatalogue(state));
  state = stepGossip(state);
  state = stepMemory(state);
  return refreshPromptCache(state);
}

export function playerConcerning(state: CityAmbient): {
  readonly memory: readonly string[];
  readonly gossip: readonly string[];
  readonly informants: readonly string[];
} {
  const ambient = state.world.ambient;
  if (ambient === undefined) {
    return { memory: [], gossip: [], informants: [] };
  }
  const lines: string[] = [];
  for (const [id, recs] of Object.entries(memoryOf(state.world))) {
    for (const rec of recs) {
      if (rec.aboutPlayer) {
        lines.push(`${id}:${rec.id}:${rec.kind}`);
      }
    }
  }
  lines.sort();
  const gossip = Object.entries(ambient.falseBeliefs)
    .map(([id, facts]) => `${id}:${facts.map((fact) => fact.id).join(',')}`)
    .sort();
  const informants = Object.keys(revealTruth(ambient.informants)).sort();
  return { memory: lines, gossip, informants };
}

export function coarseSignature(state: CityAmbient): unknown {
  const ambient = state.world.ambient;
  if (ambient === undefined) {
    return null;
  }
  return { life: ambient.life, stories: ambient.stories, townsfolk: ambient.townsfolk };
}

export function spineSignature(state: CityAmbient): unknown {
  return {
    suspicion: revealTruth(state.world.player.coverSuspicion),
    stages: state.world.plot.stages,
  };
}

export function createAmbientSimulator(): AmbientSimulator<CityAmbient> {
  return {
    advanceFull(_city, state, spine) {
      let world = arm(atTime(state.world, spine.time), spine);
      const day = ambientDayBoundary(world);
      world = day.state;
      const events = [...day.events];
      for (const phase of PHASES) {
        world = atTime(world, { day: spine.time.day, phase });
        const stepped = ambientPhase(world);
        world = stepped.state;
        events.push(...stepped.events);
      }
      return { next: { world: release(world), disclosed: state.disclosed }, events: tag(events) };
    },
    advanceCoarse(_city, state, spine) {
      let world = arm(atTime(state.world, spine.time), spine);
      world = sharedDay(world);
      for (const phase of PHASES) {
        world = atTime(world, { day: spine.time.day, phase });
        world = stepPopulace(world);
        world = stepTies(world);
        world = settleDuties(world);
      }
      return { next: { world: release(world), disclosed: state.disclosed }, events: [] };
    },
    reconcile(_city, state, _spine, disclosed) {
      let world = state.world.ambient === undefined ? state.world : stepLife(arm(state.world));
      for (const fact of disclosed) {
        if (!disclosedHolds(world, fact)) {
          world = installDisclosed(world, fact);
        }
      }
      return { world, disclosed: [...disclosed] };
    },
    couplings(_city, state, t) {
      return couplingsOf(state.world.ambient, t);
    },
  };
}

export function ambientContractOf(world: WorldState): AmbientContract<CityAmbient> {
  const city = cityOf(world);
  return {
    simulator: createAmbientSimulator(),
    city,
    initial: () => ({ world: structuredClone(world), disclosed: [] }),
    spine: () => ({ time: world.time, placements: {} }),
    playerConcerning,
    disclosedFacts: (state) => state.disclosed,
    coarseSignature,
    spineSignature,
    expectCouplings: true,
  };
}

const TIE_PREDICATES = new Set(['RELATED_TO', 'INVOLVED_WITH', 'OWES']);

/** A disclosed fact holds when life or tie knowledge still records its id. */
export function disclosedHolds(world: WorldState, fact: Proposition): boolean {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return false;
  }
  for (const life of Object.values(ambient.life)) {
    if (life.facts.some((item) => item.id === fact.id)) {
      return true;
    }
  }
  for (const held of Object.values(ambient.tieKnowledge)) {
    if (held.some((item) => item.id === fact.id)) {
      return true;
    }
  }
  return false;
}

function installDisclosed(world: WorldState, fact: Proposition): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const subject = typeof fact.subject === 'string' ? fact.subject : '';
  if (TIE_PREDICATES.has(fact.predicate)) {
    const object = typeof fact.object === 'string' ? fact.object : subject;
    const tieKnowledge = { ...ambient.tieKnowledge };
    for (const id of [subject, object]) {
      if (!id.startsWith('npc:')) {
        continue;
      }
      const npc = id as NpcId;
      const prior = tieKnowledge[npc] ?? [];
      if (!prior.some((item) => item.id === fact.id)) {
        tieKnowledge[npc] = [...prior, fact];
      }
    }
    return { ...world, ambient: { ...ambient, tieKnowledge } };
  }
  const npc = (subject.startsWith('npc:') ? subject : 'npc:disclosed') as NpcId;
  const prior = ambient.life[npc] ?? emptyLife();
  return {
    ...world,
    ambient: {
      ...ambient,
      life: {
        ...ambient.life,
        [npc]: { ...prior, facts: [...prior.facts, fact] },
      },
    },
  };
}

/** The passed rng is unused: ambient draws stay on keyed streams. */
export function advanceAmbientCity(
  simulator: AmbientSimulator<CityAmbient>,
  state: CityAmbient,
  spine: SpineView,
  rng: Prng,
  tier: 'full' | 'coarse',
): CityAmbient {
  const city = cityOf(state.world);
  const step =
    tier === 'full'
      ? simulator.advanceFull(city, state, spine, rng)
      : simulator.advanceCoarse(city, state, spine, rng);
  return step.next;
}
