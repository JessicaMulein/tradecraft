/**
 * The liaison exchange (multi-city task 7.2; Requirement 7).
 *
 * Answers come only from the service's knowledge slice and agenda. Shares raise
 * trust and, when the service is penetrated, relay exactly those propositions.
 * Reliability, the agenda and the penetration stay off the player view.
 */

import { addPhases } from '../clock/clock.js';
import { adoptBelief } from '../hostile/beliefs.js';
import { ingestFeed } from '../hostile/ingest-feed.js';
import {
  revealTruth,
  type EntityId,
  type GameTime,
  type NpcId,
  type Proposition,
} from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { ServiceId } from '../fidelity/types.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { TruthAccess } from '../truth/truth.js';
import type { ActionQuote, ActionResult } from '../action/result.js';
import type { LiaisonRequestAction, LiaisonShareAction } from '../action/types.js';
import type { ServiceState } from '../region/services.js';

const DISTORT_FACTOR = 0.5;

function concerns(prop: Proposition, about: EntityId): boolean {
  if (prop.subject === about) {
    return true;
  }
  if (prop.object === about) {
    return true;
  }
  return typeof prop.object === 'object' && prop.object.kind === 'text' && prop.object.value === about;
}

function hidden(prop: Proposition, conceal: readonly string[]): boolean {
  return conceal.includes(prop.id) || conceal.includes(prop.predicate);
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

function liaisonOf(state: WorldState, id: ServiceId): ServiceState | undefined {
  const service = state.services?.[id];
  if (service?.liaison === undefined) {
    return undefined;
  }
  return service;
}

/** Propositions the service will report about an entity. Pure. */
export function liaisonAnswer(service: ServiceState, about: EntityId, rng: Prng): readonly Proposition[] {
  const liaison = service.liaison;
  if (liaison === undefined || liaison.trust <= 0) {
    return [];
  }
  const conceal = liaison.agenda.conceal;
  const pool = [...service.knowledge.known, ...service.knowledge.falseBeliefs]
    .filter((prop) => concerns(prop, about) && !hidden(prop, conceal))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const prop of [...service.knowledge.known, ...service.knowledge.falseBeliefs]) {
    const named = liaison.agenda.promote.includes(prop.id) || liaison.agenda.promote.includes(prop.predicate);
    if (named && concerns(prop, about) && !pool.some((item) => item.id === prop.id)) {
      pool.push(prop);
    }
  }
  const reliability = revealTruth(liaison.reliability);
  const cap = Math.ceil(3 * liaison.trust);
  const reported: Proposition[] = [];
  for (const prop of pool) {
    if (reported.length >= cap) {
      break;
    }
    if (rng.next() >= reliability) {
      continue;
    }
    const distort = rng.next() < (1 - reliability) * DISTORT_FACTOR;
    reported.push(distort ? { ...prop, id: `${prop.id}~distort` } : prop);
  }
  return reported;
}

/** A report proposition is the slice, a promote item, or a distortion of one. */
export function reportIsGrounded(service: ServiceState, reported: readonly Proposition[]): boolean {
  const slice = [...service.knowledge.known, ...service.knowledge.falseBeliefs];
  const promote = service.liaison?.agenda.promote ?? [];
  return reported.every((prop) => {
    if (promote.includes(prop.id) || promote.includes(prop.predicate)) {
      return true;
    }
    const sourceId = prop.id.endsWith('~distort') ? prop.id.slice(0, -'~distort'.length) : prop.id;
    return slice.some((item) => item.id === sourceId && item.predicate === prop.predicate);
  });
}

export interface LiaisonShareResult {
  readonly service: ServiceState;
  readonly relayed: readonly Proposition[];
  readonly penetrating?: ServiceId;
  readonly delay: number;
  readonly agent?: NpcId;
}

/** Adopt the shared propositions and raise trust. A penetration relays the same list. */
export function liaisonShare(service: ServiceState, props: readonly Proposition[]): LiaisonShareResult {
  const liaison = service.liaison;
  if (liaison === undefined) {
    return { service, relayed: [], delay: 0 };
  }
  let beliefs = service.beliefs;
  for (const prop of props) {
    const adopted = adoptBelief(beliefs, prop);
    beliefs = { ...beliefs, ...adopted.beliefs };
  }
  const trust = Math.min(1, liaison.trust + 0.05 * props.length);
  const next: ServiceState = { ...service, beliefs, liaison: { ...liaison, trust } };
  const penetration = service.penetratedBy === undefined ? undefined : revealTruth(service.penetratedBy);
  if (penetration === undefined) {
    return { service: next, relayed: [], delay: 0 };
  }
  return {
    service: next,
    relayed: [...props],
    penetrating: penetration.service,
    delay: penetration.delayPhases,
    agent: penetration.agent,
  };
}

/** Trust falls when the station refuses a request or arrests a liaison agent. */
export function fallTrust(service: ServiceState, reason: 'refused' | 'arrest'): ServiceState {
  const liaison = service.liaison;
  if (liaison === undefined) {
    return service;
  }
  const drop = reason === 'arrest' ? 0.3 : 0.1;
  const trust = Math.max(0, liaison.trust - drop);
  return { ...service, liaison: { ...liaison, trust } };
}

export interface Crossing {
  readonly npc: NpcId;
  readonly city: string;
  readonly at: GameTime;
}

/** Border crossing records, filtered by reliability and the conceal list. */
export function crossingRecords(
  service: ServiceState,
  crossings: readonly Crossing[],
  rng: Prng,
): readonly Proposition[] {
  const liaison = service.liaison;
  if (liaison === undefined) {
    return [];
  }
  const reliability = revealTruth(liaison.reliability);
  const records: Proposition[] = [];
  for (const crossing of crossings) {
    const id = `prop:travels-${crossing.npc}-${crossing.city}`;
    if (liaison.agenda.conceal.includes(id) || liaison.agenda.conceal.includes('TRAVELS_TO')) {
      continue;
    }
    if (rng.next() >= reliability) {
      continue;
    }
    records.push({
      id,
      subject: crossing.npc,
      predicate: 'TRAVELS_TO',
      object: { kind: 'text', value: crossing.city },
      window: { from: crossing.at, to: crossing.at },
    });
  }
  return records;
}

export function quoteLiaisonRequest(state: WorldState, action: LiaisonRequestAction): ActionQuote {
  if (state.region === undefined) {
    return { allowed: false, reason: 'this game has no region', phases: 0, money: 0 };
  }
  const service = liaisonOf(state, action.service);
  if (service?.liaison === undefined) {
    return { allowed: false, reason: 'that service does not answer liaison requests', phases: 0, money: 0 };
  }
  return { allowed: true, phases: service.liaison.delayPhases, money: 0 };
}

export function resolveLiaisonRequest(
  state: WorldState,
  action: LiaisonRequestAction,
  rng: Prng,
  truth?: TruthAccess,
): { readonly next: WorldState; readonly result: ActionResult } {
  const quoted = quoteLiaisonRequest(state, action);
  const service = liaisonOf(state, action.service);
  if (!quoted.allowed || service?.liaison === undefined) {
    return { next: state, result: empty(state) };
  }
  const reported = action.records === true
    ? crossingRecords(service, crossingsOf(state, service), rng)
    : liaisonAnswer(service, action.about, rng);
  const at = addPhases(state.time, quoted.phases);
  const event: SimEvent = {
    id: `liaison-report-${service.id}-${action.about}`,
    at,
    visibility: 'player',
    kind: 'liaison-report',
    service: service.id,
  };
  const speaker = firstOfficer(service);
  if (truth !== undefined) {
    for (const prop of reported) {
      const inKnown = service.knowledge.known.some((item) => item.id === prop.id || prop.id.startsWith(item.id));
      truth.recordClaimTruth({
        claim: prop,
        speaker,
        at,
        held: inKnown,
        believed: true,
        lie: service.liaison.agenda.promote.includes(prop.predicate) && !inKnown,
      });
    }
  }
  const lines = reported.length === 0
    ? [`${service.id} has nothing to report.`]
    : reported.map((prop) => `${service.id} reports ${prop.predicate}.`);
  const observations = reported.length === 0
    ? lines.map((line) => ({ kind: 'message' as const, line }))
    : reported.map((prop) => ({
        kind: 'proposition' as const,
        prop,
        at,
        source: { kind: 'liaison' as const, service: service.id },
      }));
  const next: WorldState = { ...state, time: at, scheduled: [...state.scheduled, event] };
  return {
    next,
    result: {
      observations,
      factLines: lines,
      scene: { loc: next.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
      events: [event],
      claimsAdded: [],
    },
  };
}

export function quoteLiaisonShare(state: WorldState, action: LiaisonShareAction): ActionQuote {
  if (state.region === undefined) {
    return { allowed: false, reason: 'this game has no region', phases: 0, money: 0 };
  }
  if (liaisonOf(state, action.service) === undefined) {
    return { allowed: false, reason: 'that service does not take liaison shares', phases: 0, money: 0 };
  }
  if (action.props.length === 0) {
    return { allowed: false, reason: 'there is nothing to share', phases: 0, money: 0 };
  }
  return { allowed: true, phases: 0, money: 0 };
}

export function resolveLiaisonShare(
  state: WorldState,
  action: LiaisonShareAction,
): { readonly next: WorldState; readonly result: ActionResult } {
  const quoted = quoteLiaisonShare(state, action);
  const service = liaisonOf(state, action.service);
  if (!quoted.allowed || service === undefined || state.services === undefined) {
    return { next: state, result: empty(state) };
  }
  const shared = liaisonShare(service, action.props);
  let services: Record<ServiceId, ServiceState> = { ...state.services, [service.id]: shared.service };
  const events: SimEvent[] = [];
  if (shared.penetrating !== undefined && shared.agent !== undefined) {
    const penetrating = services[shared.penetrating];
    if (penetrating !== undefined) {
      const fed = ingestFeed(
        penetrating.beliefs,
        {
          agent: shared.agent,
          priorTrust: 1,
          items: shared.relayed.map((prop) => ({
            prop,
            holdsInTruth: false,
            confirmed: false,
            refuted: false,
          })),
        },
        penetrating.doctrine,
        state.time,
      );
      services = {
        ...services,
        [penetrating.id]: { ...penetrating, beliefs: { ...penetrating.beliefs, ...fed.beliefs } },
      };
    }
    events.push({
      id: `relay-${service.id}-${state.time.day}`,
      at: addPhases(state.time, shared.delay),
      visibility: 'hidden',
      kind: 'penetration-relay',
      service: shared.penetrating,
    });
  }
  const line = `${service.id} accepts ${action.props.length} proposition(s).`;
  const next: WorldState = { ...state, services, scheduled: [...state.scheduled, ...events] };
  return {
    next,
    result: {
      observations: [{ kind: 'message', line }],
      factLines: [line],
      scene: { loc: state.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
      events,
      claimsAdded: [],
    },
  };
}

function firstOfficer(service: ServiceState): NpcId {
  for (const residency of Object.values(service.residencies)) {
    const officer = residency.officers[0];
    if (officer !== undefined) {
      return officer;
    }
  }
  return `npc:${service.id.slice('service:'.length)}`;
}

function crossingsOf(state: WorldState, service: ServiceState): Crossing[] {
  const crossings: Crossing[] = [];
  const region = state.region;
  if (region === undefined) {
    return crossings;
  }
  for (const transit of Object.values(state.transits ?? {})) {
    const route = region.intercity[transit.route];
    if (route?.toCity === undefined) {
      continue;
    }
    const watches = route.borders.some((postId) => region.borderPosts[postId]?.service === service.id);
    if (!watches) {
      continue;
    }
    for (const who of transit.travellers) {
      if (!who.startsWith('npc:')) {
        continue;
      }
      crossings.push({
        npc: who as NpcId,
        city: route.toCity,
        at: transit.departure ?? state.time,
      });
    }
  }
  return crossings;
}
