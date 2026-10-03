/**
 * The city model: Districts, Locations and Routes, the pure {@link crowdLevel}
 * that derives how busy a place is, the {@link travelCost} shortest-path over
 * the Route graph, and the deterministic daily weather draw (design, "Locations
 * and Movement"; Requirements 21.1, 21.2, 21.6).
 *
 * The world generator (`./generate.ts`) stamps a {@link City} from the content
 * pack's Location Types and `city.yaml`. This module owns the *shapes* that
 * generation produces and the *pure* functions that read them at play time:
 *
 * - {@link Location} / {@link Route} / {@link District} / {@link City} — the
 *   data the design's `Location`, `Route` and `City` name. `City` replaces the
 *   skeleton placeholder in `../model/state.ts`; `WorldState.city` is a `City`.
 * - {@link crowdLevel} — pure: it reads only the Location, the time and the
 *   day's weather, so the same inputs always give the same crowd band
 *   (Requirement 21.6, design "crowdLevel … // pure"). The band is derived from
 *   the Location Type's authored crowd curve, bent by its weather modifiers.
 * - {@link travelCost} — Dijkstra over the Route graph, plus one phase for a
 *   countersurveillance route (Requirement 21.2, design "Dijkstra + 1 if CS").
 * - {@link weatherForDay} — draws the day's weather on the daily PRNG stream
 *   (`derive(seed, 0x20000 + day)`), weighted by the season the day falls in
 *   (Requirement 21.6, design "Weather comes from the daily stream").
 *
 * The description and atmosphere tags on a Location are drawn once at generation
 * from the Location Type pools, so they are facts the Narrator may elaborate but
 * not contradict (design). Crowd and weather are derived, not stored, so they
 * stay a pure function of state and never need to be saved or kept in sync.
 */

import {
  createPrng,
  derive,
  type Prng,
} from '../prng/prng.js';
import {
  type DeadDropId,
  type GameTime,
  type LocId,
  type Phase,
} from '../model/core.js';
import { type Alias } from '../model/registry.js';
import {
  contentPhasesOf,
  monthForDay,
  weekdayForDay,
  type ContentPhase,
  type Weekday,
} from './time-mapping.js';
import type { CityData } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A District id. Districts group Locations and are the nodes of the Route
 * graph; travel between Districts costs phases, travel within one is free
 * (Requirement 21.2). The design references `DistrictId` on `Location` and
 * `Route` without a namespace, so it is a plain branded-by-shape string the
 * generator mints as `district:<slug>`.
 */
export type DistrictId = `district:${string}`;

/** The crowd bands a Location can be in, least to most busy (design). */
export const CROWD_LEVELS = ['empty', 'sparse', 'busy', 'packed'] as const;

/** How busy a Location is at a moment (Requirement 21.6). */
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

// ---------------------------------------------------------------------------
// District / Location / Route
// ---------------------------------------------------------------------------

/**
 * A District: a named group of Locations sitting in one occupation sector. The
 * `sector` is period texture carried from `city.yaml`; the generator and the
 * Route graph key off `id`.
 */
export interface District {
  readonly id: DistrictId;
  readonly name: string;
  readonly sector: string;
}

/**
 * A Location in the city (the design's `Location`). Every field is a fact fixed
 * at generation: the name and aliases the Entity Registry and Leak Guard read,
 * the Location Type it was stamped from, the District it sits in, whether it is
 * public (and so known from game start, Requirement 21.8), its description and
 * atmosphere tags (drawn from the Location Type pools), its per-phase opening
 * hours folded onto the four-phase clock, its risk rating, and the dead-drop
 * sites it holds.
 */
export interface Location {
  readonly id: LocId;
  readonly name: string;
  readonly aliases: readonly Alias[];
  readonly type: string;
  readonly district: DistrictId;
  readonly public: boolean;
  readonly description: string;
  readonly atmosphere: readonly string[];
  /** Open (`true`) or closed (`false`) in each of the four engine phases. */
  readonly hours: Readonly<Record<Phase, boolean>>;
  readonly risk: number;
  readonly deadDropSites: readonly DeadDropId[];
}

/**
 * A Route between two Districts (the design's `Route`). `cost` is `0` or `1`
 * phases; travel within a District is free and needs no Route (Requirement
 * 21.2). Routes are undirected: the pair `{a, b}` connects both ways.
 */
export interface Route {
  readonly a: DistrictId;
  readonly b: DistrictId;
  readonly cost: 0 | 1;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

/**
 * The city's weather for one day. `condition` is the stable id a Location
 * Type's `weatherModifiers` match on; `label` is the human phrase for Fact
 * Lines and the Narrator's scene descriptor; `season` names the table it was
 * drawn from. Deterministic from the seed and the day (Requirement 21.6).
 *
 * This is the engine-side weather value. The skeleton `Weather` in
 * `../model/state.ts` (a `{ summary }`) is the shape a `day-start` event
 * carries; the two meet when task 7.x mints that event. Keeping the engine
 * weather richer here lets `crowdLevel` key off `condition` without re-deriving.
 */
export interface Weather {
  readonly condition: string;
  readonly label: string;
  readonly season: string;
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

/**
 * The generated city: its Districts and Locations (keyed by id for O(1) lookup
 * by every system that references a place), the Route graph between Districts,
 * and the calendar month the game starts in (so the daily weather draw knows
 * which season to read). Replaces the skeleton `City` placeholder in
 * `../model/state.ts`; `WorldState.city` is this type.
 *
 * The weather tables themselves are not stored on the city — they live in the
 * loaded `CityData`, which the daily draw reads — so the city stays a snapshot
 * of generated geography, not a copy of content.
 */
export interface City {
  readonly displayName: string;
  readonly districts: Readonly<Record<DistrictId, District>>;
  readonly locations: Readonly<Record<LocId, Location>>;
  readonly routes: readonly Route[];
  /**
   * The crowd model for each Location Type a Location was stamped from, keyed
   * by Location Type id. {@link crowdAt} reads this so a play-time caller needs
   * only the city and a Location, not the loaded content, to compute a crowd
   * band. Stored (rather than re-read from content each call) so the band is a
   * pure function of saved state.
   */
  readonly crowdModels: Readonly<Record<string, CrowdModel>>;
  /** 1-based calendar month the game starts in (1 = January). */
  readonly startMonth: number;
}

// ---------------------------------------------------------------------------
// Crowd level (pure)
// ---------------------------------------------------------------------------

/**
 * The crowd-curve and weather-modifier data `crowdLevel` reads for one Location
 * Type. The generator stamps this onto generation and passes it in, so
 * `crowdLevel` depends only on its arguments and the Location — never on a
 * content lookup — which is what keeps it pure and cheap to call per frame.
 */
export interface CrowdModel {
  /** Base crowd level in `[0, 1]` per weekday and content phase. */
  readonly curve: ReadonlyArray<{
    readonly weekday: Weekday;
    readonly phase: ContentPhase;
    readonly level: number;
  }>;
  /** Crowd multipliers keyed by the weather tag they respond to. */
  readonly weatherModifiers: ReadonlyArray<{
    readonly weather: string;
    readonly crowdMultiplier: number;
  }>;
}

/**
 * The thresholds that turn a `[0, 1]` crowd value into a band. A value `< 0.2`
 * is `empty`, `< 0.5` is `sparse`, `< 0.8` is `busy`, and the rest `packed`.
 * The bands are closed-open from the low end so the mapping is total.
 */
const CROWD_THRESHOLDS: ReadonlyArray<{ readonly max: number; readonly band: CrowdLevel }> = [
  { max: 0.2, band: 'empty' },
  { max: 0.5, band: 'sparse' },
  { max: 0.8, band: 'busy' },
  { max: Infinity, band: 'packed' },
];

/**
 * The weather tags a condition carries, intersected with the city's known tag
 * list. A Location Type's `weatherModifiers` match on a tag, and `city.yaml`
 * notes "a Location raises or lowers its crowd when the day's condition carries
 * the tag" while keying modifiers "off the condition id". A condition id is one
 * or more hyphen-separated tokens (`clear-cold`); a token is a tag the
 * condition carries when it appears in the city's `weather.tags`. So
 * `clear-cold` carries `clear`, `rain` carries `rain`, and an unknown token
 * carries nothing. Deterministic and content-driven, with no hard-coded
 * weather vocabulary.
 */
export function weatherTagsFor(
  condition: string,
  cityData: CityData,
): Set<string> {
  const known = new Set(cityData.weather.tags);
  const out = new Set<string>();
  for (const token of condition.split('-')) {
    if (known.has(token)) {
      out.add(token);
    }
  }
  // The whole id may itself be a declared tag (e.g. `thunderstorm`).
  if (known.has(condition)) {
    out.add(condition);
  }
  return out;
}

/**
 * The crowd band at a Location right now, resolving the day's weather tags for
 * the caller. A convenience over {@link crowdLevel} for play-time code that has
 * the city, the loaded {@link CityData} and the day's {@link Weather} in hand.
 * Pure: it derives the tag set and the base level with no PRNG and no state.
 */
export function crowdAt(
  city: City,
  cityData: CityData,
  loc: Location,
  t: GameTime,
  weather: Weather,
): CrowdLevel {
  const model = city.crowdModels[loc.type];
  if (model === undefined) {
    // A Location whose type has no stored model reads as empty rather than
    // throwing; generation always stores a model per stamped type, so this is
    // a defensive floor, not an expected path.
    return 'empty';
  }
  return crowdLevel(model, t, weatherTagsFor(weather.condition, cityData));
}

/** Map a `[0, ∞)` crowd value to its band. */
function bandOf(value: number): CrowdLevel {
  for (const { max, band } of CROWD_THRESHOLDS) {
    if (value < max) {
      return band;
    }
  }
  return 'packed';
}

/**
 * The base crowd level for a Location at an engine time, read from its curve.
 *
 * The curve is authored at the eight-phase grain; an engine phase covers a run
 * of content phases, so the base level is the *maximum* authored level across
 * that run on the day's weekday. The max (rather than an average) matches "how
 * busy can it get in this part of the day", which is the band the player sees.
 * A phase with no authored entry contributes nothing, and a Location with no
 * entry at all for the time reads as empty.
 */
function baseCrowd(model: CrowdModel, t: GameTime): number {
  const weekday = weekdayForDay(t.day);
  const phases = contentPhasesOf(t.phase);
  let max = 0;
  for (const entry of model.curve) {
    if (entry.weekday === weekday && phases.includes(entry.phase)) {
      if (entry.level > max) {
        max = entry.level;
      }
    }
  }
  return max;
}

/**
 * How busy a Location is at a moment (Requirement 21.6; design `crowdLevel …
 * // pure`).
 *
 * Pure: the band depends only on the Location's crowd model, the time (weekday
 * and phase) and the day's weather. The base level comes from the authored
 * curve; every weather modifier whose tag the day's `condition` carries
 * multiplies it (so a café fills in the rain, a park empties). The product is
 * mapped to a band. Same inputs ⇒ same band, always, with no PRNG and no state.
 *
 * `weatherTags` is the set of tags the day's condition carries (from the
 * `CityData` weather table); a modifier applies when its `weather` tag is in
 * that set. Passing the resolved tag set keeps `crowdLevel` free of any content
 * lookup.
 */
export function crowdLevel(
  model: CrowdModel,
  t: GameTime,
  weatherTags: ReadonlySet<string>,
): CrowdLevel {
  let level = baseCrowd(model, t);
  for (const mod of model.weatherModifiers) {
    if (weatherTags.has(mod.weather)) {
      level *= mod.crowdMultiplier;
    }
  }
  return bandOf(level);
}

// ---------------------------------------------------------------------------
// Travel cost (Dijkstra over the Route graph)
// ---------------------------------------------------------------------------

/**
 * The cheapest travel cost in phases from one Location to another (Requirement
 * 21.3), plus one phase if the player takes a countersurveillance route
 * (Requirement 21.4; design "Dijkstra + 1 if CS").
 *
 * Travel within a District is free (`0`). Between Districts it is the
 * shortest-path cost over the undirected Route graph, where each Route costs
 * `0` or `1` phase. An unreachable destination returns `Infinity`; a caller
 * treats that as "no route" rather than a travel it can quote.
 *
 * Dijkstra is used rather than BFS because Routes may cost `0`, so hop count is
 * not the cost. The graph is tiny (a handful of Districts), so a plain
 * array-scan priority selection is more than fast enough and keeps the function
 * allocation-light and deterministic.
 */
export function travelCost(
  city: City,
  from: LocId,
  to: LocId,
  countersurveillance: boolean,
): number {
  const fromLoc = city.locations[from];
  const toLoc = city.locations[to];
  if (fromLoc === undefined || toLoc === undefined) {
    return Infinity;
  }

  const csSurcharge = countersurveillance ? 1 : 0;

  if (fromLoc.district === toLoc.district) {
    return csSurcharge;
  }

  const base = shortestDistrictCost(city, fromLoc.district, toLoc.district);
  return base === Infinity ? Infinity : base + csSurcharge;
}

/** Shortest-path phase cost between two Districts over the Route graph. */
function shortestDistrictCost(
  city: City,
  from: DistrictId,
  to: DistrictId,
): number {
  if (from === to) {
    return 0;
  }

  // Adjacency: for each District, its neighbours and the Route cost to each.
  const neighbours = new Map<DistrictId, Array<{ to: DistrictId; cost: number }>>();
  const addEdge = (a: DistrictId, b: DistrictId, cost: number): void => {
    const list = neighbours.get(a);
    if (list === undefined) {
      neighbours.set(a, [{ to: b, cost }]);
    } else {
      list.push({ to: b, cost });
    }
  };
  for (const route of city.routes) {
    addEdge(route.a, route.b, route.cost);
    addEdge(route.b, route.a, route.cost);
  }

  const dist = new Map<DistrictId, number>();
  for (const id of Object.keys(city.districts) as DistrictId[]) {
    dist.set(id, Infinity);
  }
  dist.set(from, 0);

  const visited = new Set<DistrictId>();

  for (;;) {
    // Pick the unvisited District with the smallest tentative distance.
    let current: DistrictId | undefined;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === undefined || best === Infinity) {
      break;
    }
    if (current === to) {
      return best;
    }
    visited.add(current);

    for (const edge of neighbours.get(current) ?? []) {
      if (visited.has(edge.to)) {
        continue;
      }
      const candidate = best + edge.cost;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
      }
    }
  }

  return dist.get(to) ?? Infinity;
}

// ---------------------------------------------------------------------------
// Weather (daily PRNG stream)
// ---------------------------------------------------------------------------

/** The base offset of the daily PRNG stream (design PRNG stream registry). */
export const DAILY_STREAM_BASE = 0x20000;

/** The seed string of the daily stream for a given day: `derive(seed, 0x20000 + day)`. */
export function dailyStreamSeed(seed: string, day: number): string {
  if (!Number.isInteger(day) || day < 0) {
    throw new RangeError(
      `dailyStreamSeed(): day must be a non-negative integer, received ${String(day)}`,
    );
  }
  return derive(seed, DAILY_STREAM_BASE + day);
}

/** The season whose table covers a given calendar month, or `undefined`. */
function seasonForMonth(
  cityData: CityData,
  month: number,
): { readonly name: string; readonly conditions: CityData['weather']['seasons'][string]['conditions'] } | undefined {
  for (const [name, season] of Object.entries(cityData.weather.seasons)) {
    if (season.months.includes(month)) {
      return { name, conditions: season.conditions };
    }
  }
  return undefined;
}

/**
 * Draw a value from a weighted list on a {@link Prng}. The draw order and the
 * list order are both fixed, so the result is deterministic for a given PRNG
 * state. Returns the index chosen.
 */
function weightedIndex(prng: Prng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  // `next()` is in [0, 1); scale to [0, total) and walk the cumulative weights.
  let roll = prng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) {
      return i;
    }
  }
  // Floating-point slack: fall back to the last entry.
  return weights.length - 1;
}

/**
 * The city's weather for one day, drawn deterministically on the daily PRNG
 * stream (Requirement 21.6; design "Weather comes from the daily stream through
 * `city.yaml` weather tables").
 *
 * The day's calendar month (from the city's `startMonth`) selects the season
 * table; the condition is a single weighted draw from that table on
 * `derive(seed, 0x20000 + day)`. Same seed and day ⇒ identical weather, and the
 * draw is isolated on its own stream so it cannot perturb world generation.
 *
 * Throws if the day's month falls in no season table — that is a `city.yaml`
 * gap the generator should have caught, not a runtime condition to paper over.
 */
export function weatherForDay(
  seed: string,
  city: City,
  cityData: CityData,
  day: number,
): Weather {
  const month = monthForDay(day, city.startMonth);
  const season = seasonForMonth(cityData, month);
  if (season === undefined) {
    throw new Error(
      `weatherForDay(): no season table covers month ${month} (day ${day}); check city.yaml weather.seasons`,
    );
  }

  const prng = createPrng(dailyStreamSeed(seed, day));
  const weights = season.conditions.map((c) => c.weight);
  const chosen = season.conditions[weightedIndex(prng, weights)];

  return { condition: chosen.id, label: chosen.label, season: season.name };
}
