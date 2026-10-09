/**
 * Regional services (multi-city design, Service State; Requirements 6.1, 6.2, 6.6).
 *
 * Slice play keeps {@link HostileServiceState} on `WorldState.hostile` and does
 * not write `services`. {@link sliceServices} is the read-only view of that one
 * hostile service, so region code can speak in services without a second
 * hostile tick.
 */

import type { KnowledgeSlice } from '../city/knowledge.js';
import type { CityId, ServiceId } from '../fidelity/types.js';
import type { HostileBeliefs } from '../hostile/beliefs.js';
import type { Doctrine } from '../hostile/doctrine.js';
import type { HostileServiceState } from '../hostile/service-state.js';
import type { ChannelId, DeadDropId, NpcId, Truth } from '../model/core.js';
import { asTruth } from '../model/core.js';

export const SERVICE_KINDS = ['own', 'hostile', 'local-security', 'liaison'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** The runtime id of the single hostile service a slice world maps to. */
export const SLICE_HOSTILE_SERVICE = 'service:hostile' as ServiceId;

/** Persons and descriptors a service is watching. Ground truth. */
export interface WatchList {
  readonly persons: readonly NpcId[];
  readonly descriptors: readonly string[];
}

/** A service's agent inside another service. Ground truth. */
export interface Penetration {
  readonly service: ServiceId;
  readonly agent: NpcId;
  readonly delayPhases: number;
}

export interface LiaisonAgenda {
  readonly conceal: readonly string[];
  readonly promote: readonly string[];
  readonly obtain: readonly string[];
}

/** Officers, channels and drops one service keeps in one city. */
export interface Residency {
  readonly officers: readonly NpcId[];
  readonly channels: readonly ChannelId[];
  readonly drops: readonly DeadDropId[];
  readonly capacity: number;
}

/**
 * Slice beliefs plus the per-service fields region mode adds. Cover suspicion
 * is per service (Requirement 6.6). The watch list is ground truth.
 */
export interface ServiceBeliefs extends HostileBeliefs {
  readonly coverSuspicion: number;
  readonly watch: Truth<WatchList>;
}

export interface ServiceState {
  readonly id: ServiceId;
  readonly kind: ServiceKind;
  readonly country?: string;
  readonly doctrine: Doctrine;
  readonly residencies: Readonly<Record<CityId, Residency>>;
  readonly beliefs: ServiceBeliefs;
  readonly knowledge: KnowledgeSlice;
  readonly liaison?: {
    readonly reliability: Truth<number>;
    readonly agenda: LiaisonAgenda;
    readonly trust: number;
    readonly delayPhases: number;
  };
  readonly penetratedBy?: Truth<Penetration>;
}

export interface RivalryEdge {
  readonly from: ServiceId;
  readonly to: ServiceId;
  readonly share: boolean;
  readonly delayPhases: number;
  readonly compete: boolean;
  readonly expose: number;
}

const EMPTY_KNOWLEDGE: KnowledgeSlice = {
  known: [],
  falseBeliefs: [],
  knownEntities: [],
};

/**
 * The slice hostile service as one {@link ServiceState}. `coverSuspicion` is
 * the player's slice cover suspicion, copied onto this service and not removed
 * from the player. Residencies stay empty: a slice city is not a residency map.
 */
export function sliceService(hostile: HostileServiceState, coverSuspicion: number): ServiceState {
  return {
    id: SLICE_HOSTILE_SERVICE,
    kind: 'hostile',
    doctrine: hostile.doctrine,
    residencies: {},
    beliefs: {
      ...hostile.beliefs,
      coverSuspicion,
      watch: asTruth<WatchList>({ persons: [], descriptors: [] }),
    },
    knowledge: EMPTY_KNOWLEDGE,
  };
}

/** Slice mode as a one-entry services record (Requirement 6.1). */
export function sliceServices(
  hostile: HostileServiceState,
  coverSuspicion: number,
): Readonly<Record<ServiceId, ServiceState>> {
  const service = sliceService(hostile, coverSuspicion);
  return { [service.id]: service };
}
