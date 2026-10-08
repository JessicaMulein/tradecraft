/**
 * Fidelity-tier contract owned by multi-city (design: engine/fidelity).
 * Ambient-world implements AmbientSimulator against these types. Single-city
 * mode never calls them.
 */

import type { ChannelId, GameTime, LocId, NpcId, Proposition } from '../model/core.js';
import type { Prng } from '../prng/prng.js';

export type CityId = `city:${string}`;
export type IRouteId = `route:${string}`;
export type StageId = string;
export type ServiceId = `service:${string}`;
export type GossipRef = string;

export interface Window {
  readonly untilDay: number;
}

export type AmbientCoupling =
  | { readonly kind: 'location-closed'; readonly loc: LocId; readonly phases: number }
  | { readonly kind: 'crowd-modifier'; readonly loc: LocId; readonly factor: number }
  | { readonly kind: 'route-delay'; readonly route: IRouteId; readonly phases: number }
  | { readonly kind: 'delay-stage'; readonly stage: StageId; readonly days: 1 | 2 }
  | { readonly kind: 'reroute-location'; readonly stage: StageId; readonly from: LocId }
  | { readonly kind: 'channel-outage'; readonly channel: ChannelId; readonly window: Window }
  | { readonly kind: 'cover-suspicion-delta'; readonly amount: number; readonly cause: string }
  | {
      readonly kind: 'informant-report';
      readonly informant: NpcId;
      readonly item: GossipRef;
      readonly handler: 'police' | ServiceId;
    }
  | { readonly kind: 'detection-bonus'; readonly npc: NpcId; readonly bonus: number };

export const AMBIENT_COUPLING_KINDS = [
  'location-closed',
  'crowd-modifier',
  'route-delay',
  'delay-stage',
  'reroute-location',
  'channel-outage',
  'cover-suspicion-delta',
  'informant-report',
  'detection-bonus',
] as const;

export type AmbientCouplingKind = (typeof AMBIENT_COUPLING_KINDS)[number];

/** One coupling of each kind, for the reference simulator and the contract suite. */
export function exampleCouplings(): readonly AmbientCoupling[] {
  return [
    { kind: 'location-closed', loc: 'loc:cafe', phases: 2 },
    { kind: 'crowd-modifier', loc: 'loc:cafe', factor: 0.5 },
    { kind: 'route-delay', route: 'route:harbor', phases: 1 },
    { kind: 'delay-stage', stage: 'stage:meet', days: 1 },
    { kind: 'reroute-location', stage: 'stage:meet', from: 'loc:cafe' },
    { kind: 'channel-outage', channel: 'chan:drop', window: { untilDay: 4 } },
    { kind: 'cover-suspicion-delta', amount: 0.01, cause: 'ambient' },
    { kind: 'informant-report', informant: 'npc:clerk', item: 'gossip:seen', handler: 'police' },
    { kind: 'detection-bonus', npc: 'npc:clerk', bonus: 0.02 },
  ];
}

/**
 * Read-only slice of the regional spine a city simulator may consult.
 * Simulators return couplings instead of writing this object.
 */
export interface SpineView {
  readonly time: GameTime;
  readonly placements: Readonly<Record<string, { readonly city: CityId; readonly loc: LocId }>>;
}

export interface AmbientOriginEvent {
  readonly kind: string;
  readonly origin: 'ambient';
  readonly visibility: 'hidden' | 'player';
}

export interface AmbientStep<S> {
  readonly next: S;
  readonly events: readonly AmbientOriginEvent[];
}

export interface AmbientSimulator<S> {
  advanceFull(city: CityId, ambient: S, spine: SpineView, rng: Prng): AmbientStep<S>;
  advanceCoarse(city: CityId, ambient: S, spine: SpineView, rng: Prng): AmbientStep<S>;
  reconcile(
    city: CityId,
    ambient: S,
    spine: SpineView,
    disclosed: readonly Proposition[],
    rng: Prng,
  ): S;
  /** Tier-independent. Full and coarse advances of the same city return the same list. */
  couplings(city: CityId, ambient: S, t: GameTime): readonly AmbientCoupling[];
}
