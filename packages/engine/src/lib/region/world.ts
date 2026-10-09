/**
 * Region-mode world shapes (multi-city design, World State).
 *
 * These types are the regional half of {@link import('../model/state.js').WorldState}.
 * A slice world leaves every regional field unset, so the single-city `city`,
 * `hostile`, `station` and `rng` path stays the one `generate` writes.
 */

import type { AmbientState } from '../ambient/state.js';
import type { District, DistrictId, Location, Route, Weather } from '../city/city.js';
import type { KnowledgeSlice } from '../city/knowledge.js';
import type { CityId, IRouteId, ServiceId } from '../fidelity/types.js';
import type {
  GameTime,
  ItemId,
  LocId,
  NpcId,
  OrgId,
  Truth,
} from '../model/core.js';

/** The city's ambient simulator state. Absent until that city is simulated. */
export type AmbientCityState = AmbientState;

export const CITY_TIERS = ['full', 'coarse'] as const;
export type CityTier = (typeof CITY_TIERS)[number];

export type TravelMode = 'rail' | 'air' | 'road' | 'sea';

export type CountryId = string;
export type BorderPostId = `post:${string}`;
export type TransitId = `transit:${string}`;
export type HandoffId = `handoff:${string}`;
export type TravelDocId = `paper:${string}`;

/** A sector boundary inside one city, closed by a border post. */
export interface SectorLine {
  readonly a: DistrictId;
  readonly b: DistrictId;
  readonly post: BorderPostId;
}

/**
 * One city inside a region. `id` is the runtime city id (`city:…`), distinct
 * from the content-pack city id the generator binds it from.
 */
export interface CityState {
  readonly id: CityId;
  readonly tier: CityTier;
  /** Player-facing name. Absent on worlds built before the field existed. */
  readonly name?: string;
  /** Narrator style sheet from the city definition. */
  readonly styleSheet?: string;
  readonly country?: string;
  readonly districts: Readonly<Record<DistrictId, District>>;
  readonly locations: Readonly<Record<LocId, Location>>;
  readonly routes: readonly Route[];
  readonly weather: Weather;
  readonly sectorLines: readonly SectorLine[];
  readonly ambient?: AmbientCityState;
}

export type RouteDuration = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface IntercityRoute {
  readonly id: IRouteId;
  readonly mode: TravelMode;
  readonly from: LocId;
  readonly to: LocId;
  readonly fromCity?: CityId;
  readonly toCity?: CityId;
  readonly duration: RouteDuration;
  readonly fare: number;
  readonly borders: readonly BorderPostId[];
  /** Phase name from the route template (`morning`, `daily`, …). */
  readonly timetable?: string;
  /** Departures by weekday (0 Monday … 6 Sunday) and engine phase. */
  readonly departures?: readonly { readonly weekday: number; readonly phase: 0 | 1 | 2 | 3 }[];
  readonly cancellingWeather?: readonly string[];
}

export interface BorderPost {
  readonly id: BorderPostId;
  readonly service: ServiceId;
  readonly strictness: number;
  readonly documents: readonly string[];
}

export type TransitStatus = 'running' | 'held' | 'arrived' | 'cancelled';

export interface Transit {
  readonly id: TransitId;
  readonly route: IRouteId;
  readonly travellers: readonly (NpcId | 'player')[];
  readonly status: TransitStatus;
  readonly departure?: GameTime;
  readonly arrivesAt?: GameTime;
  readonly carriage?: LocId;
  readonly duration?: RouteDuration;
}

export type HandoffStatus = 'preparing' | 'in-transit' | 'delivered' | 'intercepted';

export interface Handoff {
  readonly id: HandoffId;
  readonly plot: string;
  readonly stage: string;
  readonly courier: NpcId;
  readonly item: ItemId;
  readonly from: CityId;
  readonly to: CityId;
  readonly route: IRouteId;
  readonly status: HandoffStatus;
}

export type DocumentIssuer =
  | { readonly kind: 'station'; readonly id: string }
  | { readonly kind: 'consulate'; readonly id: string }
  | { readonly kind: 'service'; readonly id: ServiceId };

/**
 * A travel paper. `quality` is ground truth: a border check may reveal an
 * outcome, never the number itself.
 */
export interface TravelDocument {
  readonly id: TravelDocId;
  readonly kind: string;
  readonly holder: NpcId | 'player';
  readonly quality: Truth<number>;
  readonly issuedBy: DocumentIssuer;
  readonly valid?: { readonly from: GameTime; readonly to: GameTime };
  /** Border post ids this paper is published as satisfying. */
  readonly satisfies?: readonly string[];
}

/**
 * Where every person and item is. This is the only placement record in region
 * mode (Requirement 12.1): a city and a location, or a transit.
 */
export type Placement =
  | { readonly city: CityId; readonly loc: LocId }
  | { readonly transit: TransitId };

export type LocationOf = Readonly<Record<NpcId | ItemId | 'player', Placement>>;

export interface StationHub {
  readonly org: OrgId;
  readonly chief: NpcId;
  readonly staff: readonly NpcId[];
  readonly knowledge: KnowledgeSlice;
  readonly standing: number;
}

export interface Outstation {
  readonly city: CityId;
  readonly staff: readonly NpcId[];
}

export interface Stations {
  readonly hub: StationHub;
  readonly outstations: Readonly<Record<CityId, Outstation>>;
}

/**
 * The region block on a regional world. Absent on a slice world.
 */
export interface RegionWorld {
  readonly template: string;
  readonly cities: Readonly<Record<CityId, CityState>>;
  readonly order: readonly CityId[];
  readonly intercity: Readonly<Record<IRouteId, IntercityRoute>>;
  readonly borderPosts: Readonly<Record<BorderPostId, BorderPost>>;
  readonly jurisdiction: Readonly<Record<string, ServiceId>>;
  readonly latency: Readonly<Record<string, number>>;
  readonly closedRoutes?: readonly IRouteId[];
  readonly rules?: {
    readonly detentionPhases: number;
    readonly contrabandCashThreshold: number;
    readonly papersDelay: number;
    readonly papersCost: number;
    readonly watchListSensitivity: number;
    /** Liaison trust required before that service's city allows an arrest. */
    readonly liaisonTrustThreshold?: number;
  };
}
