/**
 * City generation: the first step of the world generator's core stream (design,
 * "World Generator", step 1; Requirements 21.1, 21.2, 21.6, 21.8).
 *
 * {@link generateCity} stamps a concrete {@link City} from the loaded content
 * pack's Location Types and the city's `city.yaml` ({@link CityData}), using
 * only the core PRNG stream so the result is a pure function of the seed and the
 * content (Requirement 1.2, underpinning Property 1 — seed determinism):
 *
 * 1. **Districts** — one per `city.yaml` district (clamped to 5–7),
 *    minted `district:<id>` and carrying the sector tag.
 * 2. **Locations** — 16–22, stamped from Location Types. Each Location Type
 *    contributes at least one Location; the remainder up to the target count are
 *    drawn from the public, player-visitable types so the city has somewhere to
 *    go. Each Location gets a name rendered from the type's `namePatterns`
 *    (drawing on the `city.yaml` name pools), a District, its public flag, a
 *    description and atmosphere from the type pools, opening hours folded onto
 *    the four-phase clock, and a risk rating from the type's `baseRisk`.
 * 3. **Routes** — the Districts are wired into one connected graph (a spanning
 *    path) with extra links added, each costing 0 or 1 phase, so `travelCost`
 *    can always find a route (Requirement 21.2).
 * 4. **Known set** — the ids of every public Location, which the player knows
 *    from game start (Requirement 21.8).
 *
 * Weather is not generated here: it is derived per day on the daily stream by
 * {@link import('./city.js').weatherForDay}. Dead-drop sites are left empty;
 * task 5.4 populates them for the types that allow drops. Determinism rests on
 * drawing every random choice from the passed {@link Prng} in a fixed order.
 */

import { type Prng } from '../prng/prng.js';
import { type LocId, type Phase, PHASES_PER_DAY } from '../model/core.js';
import { type Alias } from '../model/registry.js';
import {
  parseTemplate,
  render,
  PHASES,
  type LocationType,
  type CityData,
  type Namer,
} from '@tradecraft/content';

import {
  type City,
  type CrowdModel,
  type District,
  type DistrictId,
  type Location,
  type Route,
} from './city.js';
import {
  contentPhasesOf,
  type ContentPhase,
  type Weekday,
} from './time-mapping.js';

/** The District count range (design, task 26.10: 5–7 Districts). */
export const MIN_DISTRICTS = 5;
export const MAX_DISTRICTS = 7;

/** The Location count range (design, task 26.10: 16–22 Locations). */
export const MIN_LOCATIONS = 16;
export const MAX_LOCATIONS = 22;

/** The default start month when the scenario names none (January — slice). */
export const DEFAULT_START_MONTH = 1;

/** Options for {@link generateCity}. */
export interface GenerateCityOptions {
  /** 1-based calendar month the game starts in. Defaults to {@link DEFAULT_START_MONTH}. */
  readonly startMonth?: number;
}

/** The result of generating a city: the {@link City} plus the public-known set. */
export interface GeneratedCity {
  readonly city: City;
  /**
   * The Locations the player knows from game start — exactly the public ones
   * (Requirement 21.8). The world generator folds these into the player's known
   * entity set in the Starting Brief step.
   */
  readonly knownLocations: readonly LocId[];
}

/** A namer that stringifies a bound value plainly; name patterns use only picks. */
const PLAIN_NAMER: Namer = (value) => (value === undefined || value === null ? '' : String(value));

/** Turn a free-form name into a slug suitable for a Location id local part. */
function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // Drop combining marks so "ß"/accents collapse to ascii-ish word chars.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : fallback;
}

/**
 * Fold the Location Type's eight-phase opening hours onto the four engine
 * phases for a representative weekday. An engine phase is open when any content
 * phase it covers falls within an authored open/close window on that weekday.
 *
 * The slice's `Location.hours` is a single `Record<Phase, boolean>` — it does
 * not vary by weekday — so a representative weekday (Monday) is used; the core
 * pack authors the same hours all week for every type, so this loses nothing.
 */
export function foldHours(type: LocationType): Record<Phase, boolean> {
  const weekday: Weekday = 'monday';
  const openContentPhases = new Set<ContentPhase>();
  for (const window of type.openingHours) {
    if (window.weekday !== weekday) {
      continue;
    }
    const open = PHASES.indexOf(window.openPhase);
    const close = PHASES.indexOf(window.closePhase);
    if (open === -1 || close === -1) {
      continue;
    }
    // A window may wrap past midnight (open > close), e.g. a terminus open
    // dead-of-night to dead-of-night across the day; treat open==close or
    // open>close as "open across the whole span" so an all-hours type reads
    // open in every phase.
    if (open <= close) {
      for (let i = open; i <= close; i += 1) {
        openContentPhases.add(PHASES[i]);
      }
    } else {
      for (let i = 0; i < PHASES.length; i += 1) {
        if (i >= open || i <= close) {
          openContentPhases.add(PHASES[i]);
        }
      }
    }
  }

  const hours = {} as Record<Phase, boolean>;
  for (let p = 0 as Phase; p < PHASES_PER_DAY; p = (p + 1) as Phase) {
    hours[p] = contentPhasesOf(p).some((cp) => openContentPhases.has(cp));
  }
  return hours;
}

/**
 * Build the pure crowd model a Location Type carries for `crowdLevel`.
 *
 * Exported so the authored-city fold (`../setting/fold-city.ts`, task 3.8) can
 * build the same crowd models the procedural generator stamps, keeping a City
 * Pack's Locations reading identically to the Core City's at play time.
 */
export function crowdModelOf(type: LocationType): CrowdModel {
  return {
    curve: type.crowdCurve.map((entry) => ({
      weekday: entry.weekday as Weekday,
      phase: entry.phase as ContentPhase,
      level: entry.level,
    })),
    weatherModifiers: type.weatherModifiers.map((mod) => ({
      weather: mod.weather,
      crowdMultiplier: mod.crowdMultiplier,
    })),
  };
}

/**
 * Build the name pools a Location Type's `namePatterns` draw from: the city's
 * `namePools` and `streets` merged into one map. `{pick:cafe-names}` and
 * `{pick:waterfront}` both resolve against this.
 */
function namePoolsOf(cityData: CityData): Record<string, readonly string[]> {
  return { ...cityData.streets, ...cityData.namePools };
}

/** Render a Location name from the type's patterns, falling back to the type id. */
function renderName(
  type: LocationType,
  pools: Record<string, readonly string[]>,
  prng: Prng,
): string {
  if (type.namePatterns.length === 0) {
    return type.id;
  }
  const pattern = prng.pick(type.namePatterns);
  try {
    const rendered = render(parseTemplate(pattern), {}, PLAIN_NAMER, prng, { pools }).trim();
    return rendered.length > 0 ? rendered : type.id;
  } catch {
    // A pattern that references a missing pool falls back to the type id rather
    // than aborting generation; the content smoke tests guard the pools.
    return type.id;
  }
}

/**
 * Build the Districts of the city from `city.yaml`, clamped to 5–7. Districts
 * are taken in authored order (shuffled by the core stream so which subset
 * appears varies by seed) and minted `district:<id>`.
 */
function buildDistricts(
  cityData: CityData,
  prng: Prng,
): District[] {
  const target = prng.int(
    MIN_DISTRICTS,
    Math.min(MAX_DISTRICTS, cityData.districts.length),
  );
  const chosen = prng.shuffle(cityData.districts).slice(0, target);
  return chosen.map((d) => ({
    id: `district:${d.id}` as DistrictId,
    name: d.name,
    sector: d.sector,
  }));
}

/**
 * Decide how many Locations to stamp per Location Type to hit a target total.
 *
 * Every type gets at least one Location so the city shows its full variety. The
 * remaining slots up to the target are handed to randomly chosen *public* types
 * (the places a player can wander into), so the extra density lands on
 * visitable ground rather than on safehouses or the Station.
 */
function planLocationCounts(
  types: readonly LocationType[],
  target: number,
  prng: Prng,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const type of types) {
    counts.set(type.id, 1);
  }
  const publicTypes = types.filter((t) => t.public);
  const extraPool = publicTypes.length > 0 ? publicTypes : types;
  let remaining = target - types.length;
  while (remaining > 0) {
    const type = prng.pick(extraPool);
    counts.set(type.id, (counts.get(type.id) ?? 0) + 1);
    remaining -= 1;
  }
  return counts;
}

/** Stamp one Location from a Location Type into a District. */
function stampLocation(
  type: LocationType,
  index: number,
  district: District,
  pools: Record<string, readonly string[]>,
  prng: Prng,
): Location {
  const name = renderName(type, pools, prng);
  const id = `loc:${slugify(name, `${type.id}-${index}`)}-${index}` as LocId;
  const aliases: Alias[] = [];
  const description = type.descriptionPool.length > 0 ? prng.pick(type.descriptionPool) : '';
  return {
    id,
    name,
    aliases,
    type: type.id,
    district: district.id,
    public: type.public,
    description,
    atmosphere: [...type.atmosphereTags],
    hours: foldHours(type),
    risk: type.baseRisk,
    deadDropSites: [],
  };
}

/**
 * Wire the Districts into one connected Route graph. A spanning path over a
 * shuffled District order guarantees connectivity (so `travelCost` always finds
 * a route, Requirement 21.2); a few extra chords are added so the graph is not
 * a bare line and some trips are cheaper. Every Route costs 0 or 1 phase.
 */
function buildRoutes(districts: readonly District[], prng: Prng): Route[] {
  if (districts.length < 2) {
    return [];
  }
  const order = prng.shuffle(districts);
  const routes: Route[] = [];
  const seen = new Set<string>();
  const key = (a: DistrictId, b: DistrictId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addRoute = (a: DistrictId, b: DistrictId): void => {
    if (a === b) {
      return;
    }
    const k = key(a, b);
    if (seen.has(k)) {
      return;
    }
    seen.add(k);
    routes.push({ a, b, cost: prng.bool(0.5) ? 1 : 0 });
  };

  // Spanning path: consecutive Districts in the shuffled order are linked.
  for (let i = 0; i < order.length - 1; i += 1) {
    addRoute(order[i].id, order[i + 1].id);
  }
  // A handful of extra chords for a richer graph (roughly one per District).
  const extra = prng.int(1, Math.max(1, order.length - 1));
  for (let i = 0; i < extra; i += 1) {
    const a = prng.pick(order).id;
    const b = prng.pick(order).id;
    addRoute(a, b);
  }
  return routes;
}

/**
 * Generate the city (Requirements 21.1, 21.2, 21.6, 21.8).
 *
 * `prng` must be the core stream for the current attempt. `locationTypes` is
 * the loaded content's Location Types in a stable (id-sorted) order so the draw
 * sequence does not depend on map iteration order. The result carries the
 * {@link City} and the public-Location known set.
 */
export function generateCity(
  prng: Prng,
  locationTypes: Iterable<LocationType>,
  cityData: CityData,
  options: GenerateCityOptions = {},
): GeneratedCity {
  const startMonth = options.startMonth ?? DEFAULT_START_MONTH;

  // Stable, id-sorted type order: the draw sequence must not depend on the
  // registry's iteration order.
  const types = [...locationTypes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (types.length === 0) {
    throw new Error('generateCity(): the content set defines no Location Types');
  }

  const districts = buildDistricts(cityData, prng);
  if (districts.length === 0) {
    throw new Error('generateCity(): city.yaml defines no districts');
  }

  // Target total Locations: at least one per type, capped into the slice range.
  const target = Math.max(
    types.length,
    prng.int(MIN_LOCATIONS, MAX_LOCATIONS),
  );
  const counts = planLocationCounts(types, target, prng);
  const pools = namePoolsOf(cityData);

  const locations: Record<LocId, Location> = {};
  const knownLocations: LocId[] = [];
  const crowdModels: Record<string, CrowdModel> = {};
  let stamped = 0;

  for (const type of types) {
    crowdModels[type.id] = crowdModelOf(type);
    const count = counts.get(type.id) ?? 1;
    for (let i = 0; i < count; i += 1) {
      const district = prng.pick(districts);
      const loc = stampLocation(type, stamped, district, pools, prng);
      locations[loc.id] = loc;
      if (loc.public) {
        knownLocations.push(loc.id);
      }
      stamped += 1;
    }
  }

  const routes = buildRoutes(districts, prng);

  const districtMap: Record<DistrictId, District> = {};
  for (const d of districts) {
    districtMap[d.id] = d;
  }

  const city: City = {
    displayName: cityData.displayName,
    districts: districtMap,
    locations,
    routes,
    crowdModels,
    startMonth,
  };

  return { city, knownLocations };
}
