/**
 * Authored city instantiation (content-expansion task 3.3).
 *
 * {@link instantiateCity} is the pure function the setting step runs when a City
 * Pack is selected: it chooses a subset of the city's authored Districts,
 * Locations and Routes that satisfies the vocabulary's Required Queries and the
 * City Definition's instantiation bounds, drawing every random choice from the
 * setting stream so the result is a pure function of the City Bundle, the Game
 * Year, the vocabulary and the PRNG (content-expansion Req 9.4, 4.6, 9.9).
 *
 * It replaces slice world-generation step 1 (`generateCity`) for an authored
 * city; steps 2–10 then run on the core stream against the chosen geography.
 * The algorithm follows the design's "City instantiation" section:
 *
 * 1. Draw the target counts: Districts in `instantiation.districts`
 *    (default [4, 5]) and Locations in `instantiation.locations`
 *    (default [10, 14]).
 * 2. For each Required Query with `minInstantiated > 0`, in id order: while
 *    fewer than the minimum of its Binders are selected, add a Binder drawn
 *    weighted by `weight` from the city's unselected Binders of that query.
 * 3. Take the selected Locations' Districts. If there are more than the maximum
 *    District count, retry from step 2 (up to 16 attempts → `'infeasible'`).
 * 4. While there are fewer Districts than the minimum, add a District adjacent
 *    by Route to the selected set.
 * 5. If the selected Districts are not connected by Routes, add the Districts on
 *    the shortest connecting path if the maximum allows, otherwise retry.
 * 6. Fill up to the Location target from the selected Districts' remaining
 *    Locations, weighted by `weight`.
 * 7. The Routes are the city's Routes between selected Districts.
 *
 * A Binder of a Required Query is a Location whose Effective Tags (its own Tags
 * together with its Location Type's Tags) contain every Tag the query names
 * (design, "City instantiation"; the slice Tag Conformance uses the same
 * definition). Only year-filtered content reaches this function — the generator
 * passes a {@link CityBundle} already run through `yearFilter` — so every
 * Location, Route and District sector here is in period for the Game Year.
 *
 * The returned {@link InstantiatedCity} carries the selected Districts and
 * Locations as the slice id types (`district:<id>`, `loc:<id>`) that the rest
 * of generation and the `CityView` key off, and the selected Routes as the
 * authored {@link CityRoute}s between them.
 */

import type { Prng } from '../prng/prng.js';
import type { DistrictId } from '../city/city.js';
import type { LocId } from '../model/core.js';
import type {
  CityLocation,
  CityRoute,
  LocationType,
  RequiredQuery,
  TagVocabulary,
} from '@tradecraft/content';

import type { CityBundle, CityId } from './content-set-v2.js';

/**
 * The Instantiated City the setting step produces (design, `InstantiatedCity`):
 * the owning City id, the selected Districts and Locations as slice id types,
 * and the authored Routes between the selected Districts. The `CityView`
 * (task 3.8) and the slice generation steps read these.
 */
export interface InstantiatedCity {
  readonly city: CityId;
  readonly districts: readonly DistrictId[];
  readonly locations: readonly LocId[];
  readonly routes: readonly CityRoute[];
}

/** The default District count bound when the City Definition names none. */
export const DEFAULT_DISTRICT_BOUND: readonly [number, number] = [4, 5];
/** The default Location count bound when the City Definition names none. */
export const DEFAULT_LOCATION_BOUND: readonly [number, number] = [10, 14];
/** The maximum number of instantiation attempts before `'infeasible'` (Req 9.9). */
export const MAX_INSTANTIATION_ATTEMPTS = 16;

/** Mint the slice District id for an authored District (`district:<content-id>`). */
export function districtEntityId(districtId: string): DistrictId {
  return `district:${districtId}` as DistrictId;
}

/** Mint the slice Location id for an authored Location (`loc:<content-id>`). */
export function locationEntityId(locationId: string): LocId {
  return `loc:${locationId}` as LocId;
}

/** True when `tags` contains every Tag the query names (Effective Tags ⊇ query). */
function satisfiesQuery(
  tags: ReadonlySet<string>,
  query: readonly string[],
): boolean {
  return query.every((tag) => tags.has(tag));
}

/**
 * The Effective Tags of a Location: its own Tags together with its Location
 * Type's Tags (design; slice Tag Conformance). An unknown Location Type
 * contributes nothing — the loader's reference check guarantees the type
 * resolves for a conforming pack, so this is a defensive floor, not a path.
 */
function effectiveTagsOf(
  loc: CityLocation,
  locationTypes: ReadonlyMap<string, LocationType>,
): Set<string> {
  const tags = new Set<string>(loc.tags);
  const type = locationTypes.get(loc.type);
  if (type !== undefined) {
    for (const tag of type.tags) {
      tags.add(tag);
    }
  }
  return tags;
}

const FIXED_LANDMARK = 'function:fixed-landmark';

/** A landmark kept whenever its district is drawn, and left out of the random fill. */
function isFixedLandmark(loc: CityLocation): boolean {
  return loc.tags.includes(FIXED_LANDMARK);
}

/** The weighted-fill weight of a Location: its authored `weight`, defaulting to 1. */
function weightOf(loc: CityLocation): number {
  return loc.weight ?? 1;
}

/**
 * Draw one entry from a weighted candidate list on `rng`, returning its index.
 *
 * The draw is a single `next()` scaled over the total weight and walked across
 * the cumulative weights in the list's given order, matching the slice weather
 * draw's style so the sequence is deterministic for a PRNG state. The caller
 * passes candidates in a stable (id-sorted) order.
 */
function weightedIndex(rng: Prng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) {
      return i;
    }
  }
  return weights.length - 1;
}

/** Resolve an inclusive `[lo, hi]` count bound, falling back to a default. */
function boundOr(
  bound: readonly [number, number] | undefined,
  fallback: readonly [number, number],
): readonly [number, number] {
  return bound ?? fallback;
}

/**
 * The undirected District adjacency implied by the city's Routes: for each
 * District id, the set of Districts reachable in one Route hop. Built once per
 * instantiation and reused by the adjacency fill (step 4) and the connectivity
 * check (step 5).
 */
function buildAdjacency(
  routes: readonly CityRoute[],
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = adjacency.get(a);
    if (set === undefined) {
      set = new Set<string>();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const route of routes) {
    link(route.a, route.b);
    link(route.b, route.a);
  }
  return adjacency;
}

/**
 * Whether a set of District ids is connected over the Route graph (every
 * District reachable from any one by Routes among the selected set). A set of
 * zero or one Districts is trivially connected.
 */
function isConnected(
  selected: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, Set<string>>,
): boolean {
  if (selected.size <= 1) {
    return true;
  }
  const start = [...selected].sort()[0];
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (selected.has(next) && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size === selected.size;
}

/**
 * The shortest Route path (as the intermediate District ids to add) connecting
 * `to` to any District already in `selected`, searched over the whole Route
 * graph by breadth-first hops. Returns the ids strictly between the endpoints
 * (the already-selected endpoint and `to` are excluded), or `undefined` when no
 * path exists. Ties are broken by id order so the result is deterministic.
 */
function shortestConnectingPath(
  to: string,
  selected: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, Set<string>>,
): string[] | undefined {
  if (selected.has(to)) {
    return [];
  }
  const prev = new Map<string, string | null>([[to, null]]);
  const queue: string[] = [to];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (selected.has(current)) {
      // Walk back to `to`, collecting the strictly-between Districts.
      const path: string[] = [];
      let node: string | null | undefined = prev.get(current);
      while (node !== null && node !== undefined && node !== to) {
        path.push(node);
        node = prev.get(node);
      }
      return path.reverse();
    }
    const neighbours = [...(adjacency.get(current) ?? [])].sort();
    for (const next of neighbours) {
      if (!prev.has(next)) {
        prev.set(next, current);
        queue.push(next);
      }
    }
  }
  return undefined;
}

/**
 * One attempt of the Required-Query Binder draw and District resolution
 * (design steps 2–5). Returns the selected District id set and the selected
 * Binder Location ids, or `undefined` to signal a retry (steps 3 and 5).
 */
function attemptSelection(
  bundle: CityBundle,
  locationTypes: ReadonlyMap<string, LocationType>,
  requiredQueries: readonly RequiredQuery[],
  districtBound: readonly [number, number],
  targetDistricts: number,
  rng: Prng,
): { districts: Set<string>; locations: Set<string> } | undefined {
  const [minDistricts, maxDistricts] = districtBound;
  // The adjacency fill aims at the drawn target (clamped into the bound), which
  // is at least the minimum, so it both satisfies step 4's "fewer than the
  // minimum" and gives the drawn-count variety, staying within the maximum. It
  // is also capped at the number of Districts the city actually has: a city with
  // fewer Districts than the bound max cannot reach the max, and that is not a
  // failure as long as the minimum is met.
  const fillGoal = Math.min(
    maxDistricts,
    bundle.districts.length,
    Math.max(minDistricts, targetDistricts),
  );
  const locationById = new Map<string, CityLocation>();
  for (const loc of bundle.locations) {
    locationById.set(loc.id, loc);
  }

  // Step 2: draw Binders for each Required Query with minInstantiated > 0, in
  // id order, until each query's minimum is met.
  const selectedLocations = new Set<string>();
  const effective = new Map<string, Set<string>>();
  const tagsOf = (loc: CityLocation): Set<string> => {
    let set = effective.get(loc.id);
    if (set === undefined) {
      set = effectiveTagsOf(loc, locationTypes);
      effective.set(loc.id, set);
    }
    return set;
  };

  const queriesInOrder = [...requiredQueries]
    .filter((rq) => rq.minInstantiated > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const rq of queriesInOrder) {
    const query = rq.query as readonly string[];
    const binders = bundle.locations
      .filter((loc) => !isFixedLandmark(loc) && satisfiesQuery(tagsOf(loc), query))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let have = binders.filter((loc) => selectedLocations.has(loc.id)).length;
    while (have < rq.minInstantiated) {
      const candidates = binders.filter((loc) => !selectedLocations.has(loc.id));
      if (candidates.length === 0) {
        // No more Binders of this query to add — the pack is unbindable for
        // this query. A conforming pack has at least minStatic ≥ minInstantiated
        // Binders, so this only happens for a defective set; treat as a retry
        // (which, being deterministic, exhausts to 'infeasible').
        return undefined;
      }
      const weights = candidates.map(weightOf);
      const chosen = candidates[weightedIndex(rng, weights)];
      selectedLocations.add(chosen.id);
      have += 1;
    }
  }

  // Step 3: the selected Locations' Districts. Over the maximum ⇒ retry.
  const selectedDistricts = new Set<string>();
  for (const id of selectedLocations) {
    const loc = locationById.get(id);
    if (loc !== undefined) {
      selectedDistricts.add(loc.district);
    }
  }
  if (selectedDistricts.size > maxDistricts) {
    return undefined;
  }

  const adjacency = buildAdjacency(bundle.routes);
  const allDistrictIds = bundle.districts
    .map((d) => d.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Step 4: while fewer Districts than the minimum, add a District adjacent by
  // Route to the selected set. When nothing selected yet (no minInstantiated
  // queries), seed from the lowest-id District so the fill is deterministic.
  if (selectedDistricts.size === 0 && fillGoal > 0 && allDistrictIds.length > 0) {
    selectedDistricts.add(allDistrictIds[0]);
  }
  while (selectedDistricts.size < fillGoal) {
    const adjacent = allDistrictIds.filter(
      (id) =>
        !selectedDistricts.has(id) &&
        [...selectedDistricts].some((sel) => adjacency.get(sel)?.has(id)),
    );
    if (adjacent.length === 0) {
      // No Route-adjacent District to add. If the graph has any unselected
      // District at all, add the lowest-id one so a disconnected graph still
      // reaches the goal (step 5 then checks connectivity); if none remain, the
      // city has fewer Districts than the minimum — a defective pack.
      const remaining = allDistrictIds.filter((id) => !selectedDistricts.has(id));
      if (remaining.length === 0) {
        return undefined;
      }
      selectedDistricts.add(remaining[0]);
      continue;
    }
    selectedDistricts.add(adjacent[0]);
  }

  // A city with fewer Districts than the minimum (or whose Binders forced too
  // few) cannot meet the bound — a defective pack. Retry (→ 'infeasible').
  if (selectedDistricts.size < minDistricts) {
    return undefined;
  }

  // Step 5: if the selected Districts are not connected, add the shortest
  // connecting path's Districts when the maximum allows, otherwise retry.
  if (!isConnected(selectedDistricts, adjacency)) {
    const components = [...selectedDistricts].sort();
    for (const district of components) {
      if (isConnected(selectedDistricts, adjacency)) {
        break;
      }
      // Connect this District to the rest, treating the others as the target
      // set. Build the target set without this District's own component.
      const others = new Set(
        [...selectedDistricts].filter((id) => id !== district),
      );
      if (others.size === 0) {
        continue;
      }
      const path = shortestConnectingPath(district, others, adjacency);
      if (path === undefined) {
        // No Routes join this District to the rest — the graph is partitioned,
        // which no added Districts can fix. Retry (deterministically → infeasible).
        return undefined;
      }
      for (const id of path) {
        selectedDistricts.add(id);
      }
    }
    if (selectedDistricts.size > maxDistricts) {
      return undefined;
    }
    if (!isConnected(selectedDistricts, adjacency)) {
      return undefined;
    }
  }

  return { districts: selectedDistricts, locations: selectedLocations };
}

/**
 * Instantiate an authored city (design, "City instantiation"; Req 9.4, 4.6,
 * 9.9).
 *
 * `def` is the City Bundle — already year-filtered by the setting step so only
 * in-period Districts, Locations and Routes reach here. `year` is the Game Year
 * (carried for callers and documentation; the bundle is pre-filtered, so this
 * function makes no further year check). `vocab` is the merged Tag Vocabulary,
 * whose Required Queries drive the Binder draw. `rng` is the setting stream for
 * the current attempt.
 *
 * Returns the {@link InstantiatedCity} on success, or `'infeasible'` after
 * {@link MAX_INSTANTIATION_ATTEMPTS} failed attempts (step 3/5 retries). The
 * generator advances to the next setting attempt on `'infeasible'`, and the
 * linter's CE-FEASIBLE rule fails a pack that returns it over its fixed seeds.
 */
export function instantiateCity(
  def: CityBundle,
  year: number,
  vocab: TagVocabulary,
  rng: Prng,
): InstantiatedCity | 'infeasible' {
  void year; // the bundle is pre-year-filtered; kept for the design signature.

  const districtBound = boundOr(
    def.def.instantiation?.districts,
    DEFAULT_DISTRICT_BOUND,
  );
  const locationBound = boundOr(
    def.def.instantiation?.locations,
    DEFAULT_LOCATION_BOUND,
  );

  const locationTypes = new Map<string, LocationType>();
  for (const type of def.locationTypes) {
    locationTypes.set(type.id, type);
  }

  const locationById = new Map<string, CityLocation>();
  for (const loc of def.locations) {
    locationById.set(loc.id, loc);
  }

  // Step 1: draw the target counts once, before the retry loop, so every
  // attempt aims at the same targets and the draw sequence stays stable. The
  // District target drives the adjacency fill's goal (step 4); steps 3 and 5
  // check against the authored District bound's minimum and maximum, as the
  // design's "fewer than the minimum" / "more than the maximum" wording reads.
  const targetDistricts = rng.int(districtBound[0], districtBound[1]);
  const targetLocations = rng.int(locationBound[0], locationBound[1]);

  // Steps 2–5, retried up to the attempt cap.
  let selection: { districts: Set<string>; locations: Set<string> } | undefined;
  for (let attempt = 0; attempt < MAX_INSTANTIATION_ATTEMPTS; attempt += 1) {
    selection = attemptSelection(
      def,
      locationTypes,
      vocab.requiredQueries,
      districtBound,
      targetDistricts,
      rng,
    );
    if (selection !== undefined) {
      break;
    }
  }
  if (selection === undefined) {
    return 'infeasible';
  }

  const selectedDistricts = selection.districts;
  const selectedLocations = selection.locations;

  // Step 6: fill up to the Location target from the selected Districts'
  // remaining Locations, weighted by `weight`.
  const fillPool = def.locations
    .filter(
      (loc) =>
        selectedDistricts.has(loc.district) &&
        !selectedLocations.has(loc.id) &&
        !isFixedLandmark(loc),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pool = [...fillPool];
  while (selectedLocations.size < targetLocations && pool.length > 0) {
    const weights = pool.map(weightOf);
    const index = weightedIndex(rng, weights);
    const chosen = pool.splice(index, 1)[0];
    selectedLocations.add(chosen.id);
  }

  // Fixed landmarks sit in the city whenever their district was drawn. They
  // are not part of the random fill, so they do not change which other places
  // a seed gets.
  for (const loc of def.locations) {
    if (!isFixedLandmark(loc)) continue;
    if (selectedDistricts.has(loc.district)) {
      selectedLocations.add(loc.id);
    }
  }

  // Step 7: the Routes between selected Districts.
  const routes = def.routes.filter(
    (route) => selectedDistricts.has(route.a) && selectedDistricts.has(route.b),
  );

  const districts = [...selectedDistricts]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(districtEntityId);
  const locations = [...selectedLocations]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(locationEntityId);

  return { city: def.def.id, districts, locations, routes };
}
