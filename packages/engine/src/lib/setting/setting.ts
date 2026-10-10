/**
 * The setting step's pure core (content-expansion task 3.2): the Start Date
 * draw (`drawSetting`) and the Effective-Year-Range filter (`yearFilter`).
 *
 * The setting step runs first in world generation, before any Plot selection,
 * and its output depends only on the seed, the Content Set and the setting
 * selection (content-expansion Req 9.11). This module owns the two pure pieces:
 *
 * - **`drawSetting`** picks the game's Start Date on the setting stream. For a
 *   City Pack it draws uniformly from the City Definition's `startDates` window
 *   intersected with the Era Pack's Period Window (Req 9.2); for the Core City
 *   it draws from the era window (or a fixed default when a core-only load ships
 *   no era). A Start Date fixed in the scenario config is used verbatim after a
 *   bounds check. The returned {@link SettingSelection} carries the city, the
 *   Start Date, the Game Year and the setting attempt index.
 * - **`yearFilter`** returns a copy of the Content Set with every item whose
 *   Effective Year Range excludes the Game Year removed (Req 9.3): City
 *   Locations, Routes, District sectors, newspapers, local orgs, Culture Weight
 *   entries, persona backgrounds, Descriptor Fragments and city Template
 *   Variants. The Effective Year Range of a City-Scoped item is its own `years`
 *   intersected with the city Period Window and the era Period Window; a Library
 *   item's is its own `years` intersected with the era Period Window.
 *
 * Both functions are pure and make no draws of their own beyond the single draw
 * `drawSetting` takes from the passed `rng` (the setting stream), so the setting
 * step is a deterministic function of its inputs.
 */

import type { Prng } from '../prng/prng.js';
import type {
  CityDefinition,
  CultureGroup,
  DescriptorFragment,
  District,
  CityLocation,
  CityRoute,
  LocalOrg,
  Newspaper,
  TemplateVariant,
  YearRange,
} from '@tradecraft/content';
import {
  parseIsoDate,
  daysFromEpoch,
  dateFromEpoch,
  toIsoDate,
} from '@tradecraft/content';

/**
 * An ISO calendar date `YYYY-MM-DD` (design, `IsoDate`). The content package
 * validates the grammar through its `IsoDateSchema` but does not re-export the
 * bare type alias through its barrel, so the setting step names it here; it is
 * a plain string at the type level.
 */
export type IsoDate = string;

import {
  type CityBundle,
  type CityId,
  type CitySelector,
  type ContentSetV2,
  type EraBundle,
} from './content-set-v2.js';

/**
 * The setting selection the setting step produces (design, `SettingSelection`):
 * the chosen city (or the Core City), the Start Date mapped to game day 0, the
 * Game Year that drives year filtering and the setting attempt index the stream
 * was derived at. It is stored on `WorldState.meta.setting` so a save restores
 * the setting exactly (design, "Data Models").
 */
export interface SettingSelection {
  readonly city: CitySelector;
  readonly startDate: IsoDate;
  readonly year: number;
  readonly attempt: number;
}

/**
 * The scenario config's setting block, as `drawSetting` reads it: the city
 * selector and an optional fixed Start Date (slice `ScenarioConfig['setting']`).
 * Declared structurally so this module does not depend on the engine config
 * package.
 */
export interface SettingConfig {
  readonly city: string;
  readonly startDate?: string | undefined;
}

/**
 * The Start Date the Core City Path falls back to when a core-only load ships
 * no Era Pack to bound the window. The Core City carries no year-ranged content,
 * so `yearFilter` is a no-op for it. The date is still the calendar: weekdays,
 * holidays and the weather month are counted from it. 1 December 1952 is a
 * Monday in the last month of occupied Vienna's late season, so day 0 stays a
 * workday and Christmas falls inside a month of play.
 */
export const CORE_CITY_DEFAULT_START_DATE: IsoDate = '1952-12-01';

/**
 * Thrown when `drawSetting` cannot produce a Start Date: a fixed Start Date in
 * the scenario config falls outside the city and era window, or the city and
 * era windows do not overlap at all. The config resolver (task 3.1) already
 * rejects an out-of-window fixed Start Date with a field error, so this is the
 * last-line guard for a content set whose city and era Period Windows are
 * disjoint (a `CE-PERIOD` lint defect), named so the generator can surface the
 * city.
 */
export class SettingError extends Error {
  readonly city: CitySelector;
  constructor(city: CitySelector, message: string) {
    super(message);
    this.name = 'SettingError';
    this.city = city;
  }
}

/**
 * Intersect two inclusive `[lo, hi]` day-count windows, returning `undefined`
 * when they do not overlap.
 */
function intersectDays(
  a: readonly [number, number],
  b: readonly [number, number],
): readonly [number, number] | undefined {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : undefined;
}

/**
 * The era Period Window as an inclusive day-count window, or `undefined` when
 * no Era Pack is loaded (a core-only slice load). The window spans 1 January of
 * `from` to 31 December of `to`.
 */
function eraDayWindow(
  era: EraBundle | undefined,
): readonly [number, number] | undefined {
  if (era === undefined) {
    return undefined;
  }
  return [
    daysFromEpoch({ year: era.period.from, month: 1, day: 1 }),
    daysFromEpoch({ year: era.period.to, month: 12, day: 31 }),
  ];
}

/**
 * The Start Date window for a City Pack as an inclusive day-count window: the
 * city's `startDates` intersected with the Era Pack's Period Window (Req 9.2).
 * Throws a {@link SettingError} when the two do not overlap.
 */
function cityStartWindow(
  def: CityDefinition,
  era: EraBundle | undefined,
  city: CityId,
): readonly [number, number] {
  const from = parseIsoDate(def.startDates.from);
  const to = parseIsoDate(def.startDates.to);
  if (from === undefined || to === undefined) {
    // The schema already validates the ISO form, so this is unreachable for a
    // loaded city; the guard keeps the function total.
    throw new SettingError(
      city,
      `city "${city}" has an invalid startDates window`,
    );
  }
  const cityWindow: readonly [number, number] = [
    daysFromEpoch(from),
    daysFromEpoch(to),
  ];
  const era2 = eraDayWindow(era);
  if (era2 === undefined) {
    return cityWindow;
  }
  const overlap = intersectDays(cityWindow, era2);
  if (overlap === undefined) {
    throw new SettingError(
      city,
      `city "${city}" startDates window does not overlap the era Period Window`,
    );
  }
  return overlap;
}

/**
 * Draw a day count uniformly from an inclusive `[lo, hi]` window on `rng`. The
 * draw is a single `int` call so adding or removing a later setting draw does
 * not shift this one within the stream.
 */
function drawDayInWindow(
  window: readonly [number, number],
  rng: Prng,
): number {
  return rng.int(window[0], window[1]);
}

/**
 * Draw the game's Start Date on the setting stream (design, "Setting selection";
 * Req 9.2).
 *
 * `set` is the merged {@link ContentSetV2}; `cfg` is the scenario config's
 * `setting` block; `rng` is the setting stream for the current attempt
 * (`createPrng(settingStreamSeed(seed, attempt))`). The attempt index is read
 * from `cfg`-independent state by the generator; it is recorded on the result
 * so a save can reopen the exact stream.
 *
 * For a City Pack the Start Date is drawn uniformly from the city's `startDates`
 * window intersected with the era Period Window. For the Core City it is drawn
 * from the era window, or set to {@link CORE_CITY_DEFAULT_START_DATE} when a
 * core-only load ships no era. A fixed `cfg.startDate` is used verbatim after a
 * bounds check against the same window.
 *
 * `attempt` defaults to 0 (the first setting attempt); the generator passes the
 * current attempt index so the recorded selection matches the stream it drew
 * from.
 */
export function drawSetting(
  set: ContentSetV2,
  cfg: SettingConfig,
  rng: Prng,
  attempt = 0,
): SettingSelection {
  const selector: CitySelector = cfg.city;

  if (selector === 'core') {
    return drawCoreSetting(set.era, cfg, attempt, rng);
  }

  const bundle = set.cities[selector];
  if (bundle === undefined) {
    // The config resolver (task 3.1) rejects an unknown city with a field
    // error; this guard keeps `drawSetting` total if called with a stale id.
    throw new SettingError(
      selector,
      `no City Pack "${selector}" is loaded`,
    );
  }
  return drawCitySetting(selector, bundle, set.era, cfg, attempt, rng);
}

/** Draw (or accept the fixed) Start Date for a City Pack. */
function drawCitySetting(
  city: CityId,
  bundle: CityBundle,
  era: EraBundle | undefined,
  cfg: SettingConfig,
  attempt: number,
  rng: Prng,
): SettingSelection {
  const window = cityStartWindow(bundle.def, era, city);
  const day = resolveDay(city, cfg.startDate, window, rng);
  const date = toIsoDate(dateFromEpoch(day));
  return { city, startDate: date, year: dateFromEpoch(day).year, attempt };
}

/** Draw (or accept the fixed) Start Date for the Core City. */
function drawCoreSetting(
  era: EraBundle | undefined,
  cfg: SettingConfig,
  attempt: number,
  rng: Prng,
): SettingSelection {
  const window = eraDayWindow(era);
  if (window === undefined) {
    // No Era Pack: the Core City has no year-ranged content, so the exact date
    // is immaterial to generation. Honour a fixed date if given, else use the
    // fixed default. A fixed date needs no window check because there is no
    // window to check against.
    const date =
      cfg.startDate !== undefined
        ? parseAndRequire('core', cfg.startDate)
        : CORE_CITY_DEFAULT_START_DATE;
    return {
      city: 'core',
      startDate: date,
      year: requireYear(date),
      attempt,
    };
  }
  const day = resolveDay('core', cfg.startDate, window, rng);
  const date = toIsoDate(dateFromEpoch(day));
  return { city: 'core', startDate: date, year: dateFromEpoch(day).year, attempt };
}

/**
 * Resolve the Start Date day for a window: use a fixed `startDate` after a
 * bounds check, else draw uniformly from the window on `rng`.
 */
function resolveDay(
  city: CitySelector,
  startDate: string | undefined,
  window: readonly [number, number],
  rng: Prng,
): number {
  if (startDate !== undefined) {
    const parsed = parseIsoDate(startDate);
    if (parsed === undefined) {
      throw new SettingError(city, `startDate "${startDate}" is not a valid date`);
    }
    const day = daysFromEpoch(parsed);
    if (day < window[0] || day > window[1]) {
      throw new SettingError(
        city,
        `startDate "${startDate}" is outside the city and era window`,
      );
    }
    return day;
  }
  return drawDayInWindow(window, rng);
}

/** Parse a fixed ISO date, throwing a {@link SettingError} on a bad string. */
function parseAndRequire(city: CitySelector, iso: string): IsoDate {
  const parsed = parseIsoDate(iso);
  if (parsed === undefined) {
    throw new SettingError(city, `startDate "${iso}" is not a valid date`);
  }
  return toIsoDate(parsed);
}

/** The calendar year of an ISO date already known to be valid. */
function requireYear(iso: IsoDate): number {
  const parsed = parseIsoDate(iso);
  if (parsed === undefined) {
    throw new SettingError('core', `startDate "${iso}" is not a valid date`);
  }
  return parsed.year;
}

// ---------------------------------------------------------------------------
// Year filtering
// ---------------------------------------------------------------------------

/**
 * Whether the Game Year lies inside an optional Year Range intersected with the
 * bounding Period Windows (the item's Effective Year Range). An item with no own
 * `years` is kept whenever the Game Year is inside the bounding windows; the
 * bounding windows are the city Period Window (for City-Scoped items) and the
 * era Period Window, whichever are supplied.
 */
function yearInEffectiveRange(
  year: number,
  own: YearRange | undefined,
  bounds: readonly (YearRange | undefined)[],
): boolean {
  if (own !== undefined && (year < own.from || year > own.to)) {
    return false;
  }
  for (const bound of bounds) {
    if (bound !== undefined && (year < bound.from || year > bound.to)) {
      return false;
    }
  }
  return true;
}

/**
 * Remove every item whose Effective Year Range excludes the Game Year (Req 9.3,
 * 9.2).
 *
 * `yearFilter` returns a shallow copy of the Content Set with the year-ranged
 * content pruned: within each City Bundle, Locations, Routes and newspapers and
 * local orgs out of range are dropped, a District's sector is cleared when its
 * sector Year Range excludes the year (the District itself stays — it is a graph
 * node), city Template Variants out of range are dropped, and the City
 * Definition's `cultureWeights` are pruned to the entries in range. Across the
 * Library content, persona backgrounds inside each Culture Group and the
 * Descriptor Fragments are pruned.
 *
 * The `city` argument selects which city's Period Window bounds the City-Scoped
 * items; passing `'core'` applies only the era bound (the Core City has no City
 * Pack content). The returned set is a new object; the input is not mutated, so
 * the function is pure (Req 9.11, underpinning Property 8 — year filtering).
 */
export function yearFilter(
  set: ContentSetV2,
  year: number,
  city: CitySelector,
): ContentSetV2 {
  const eraPeriod = set.era?.period;

  // Culture Groups: prune each group's persona backgrounds by Effective Year
  // Range (own years ∩ era). The group itself is kept; only out-of-period
  // backgrounds are removed (design year-filter list; Req 6.4 feeds naming).
  const cultureGroups: Record<string, CultureGroup> = {};
  for (const [id, group] of Object.entries(set.cultureGroups)) {
    cultureGroups[id] = {
      ...group,
      backgrounds: group.backgrounds.filter((bg) =>
        yearInEffectiveRange(year, bg.years, [eraPeriod]),
      ),
    };
  }

  // Descriptor Fragments: a Library kind, bounded only by the era window.
  const descriptorFragments: DescriptorFragment[] = set.descriptorFragments.filter(
    (frag) => yearInEffectiveRange(year, frag.years, [eraPeriod]),
  );

  // City bundles: prune the City-Scoped year-ranged content of each city. The
  // city's own Period Window bounds its items, in addition to the era window.
  const cities: Record<string, CityBundle> = {};
  for (const [id, bundle] of Object.entries(set.cities)) {
    // For the selected city (or every city when nothing is selected), the city
    // Period Window is a bound. The design filters "every content item" by the
    // Game Year; applying each city's own Period Window to its own items keeps
    // a side-by-side load (Req 10.1) filtering each city correctly.
    cities[id] = filterCityBundle(bundle, year, eraPeriod);
  }

  // `city` currently only distinguishes the Core City (no city content to
  // bound) from an authored city; every loaded city's content is filtered by
  // its own windows regardless, so the pruned `cities` map above already
  // reflects the selection. The argument is kept to match the design signature
  // and to let a later refinement scope the result to one city.
  void city;

  return {
    ...set,
    cities,
    cultureGroups,
    descriptorFragments,
  };
}

/** Prune one City Bundle's year-ranged City-Scoped content by Effective Year Range. */
function filterCityBundle(
  bundle: CityBundle,
  year: number,
  eraPeriod: YearRange | undefined,
): CityBundle {
  const cityPeriod = bundle.def.period;
  const bounds: readonly (YearRange | undefined)[] = [cityPeriod, eraPeriod];

  const locations: CityLocation[] = bundle.locations.filter((loc) =>
    yearInEffectiveRange(year, loc.years, bounds),
  );
  const routes: CityRoute[] = bundle.routes.filter((route) =>
    yearInEffectiveRange(year, route.years, bounds),
  );
  const newspapers: Newspaper[] = bundle.newspapers.filter((paper) =>
    yearInEffectiveRange(year, paper.years, bounds),
  );
  const orgs: LocalOrg[] = bundle.orgs.filter((org) =>
    yearInEffectiveRange(year, org.years, bounds),
  );
  // A District stays a graph node; only its sector is cleared when the sector's
  // Year Range excludes the Game Year (the sector regime had not begun or had
  // ended by then).
  const districts: District[] = bundle.districts.map((district) => {
    if (
      district.sector !== undefined &&
      !yearInEffectiveRange(year, district.sector.years, bounds)
    ) {
      const { sector, ...rest } = district;
      void sector;
      return rest;
    }
    return district;
  });
  // Template Variants carry no own Year Range in the slice schema, so they are
  // bounded only by the city and era windows (an out-of-period city is already
  // filtered as a whole upstream). Kept as-is here; the filter is applied for
  // forward compatibility should a variant gain a Year Range.
  const variants: TemplateVariant[] = [...bundle.variants];

  // Prune the City Definition's Culture Weights to the entries in range so the
  // naming draw (task 3.4) weights only period-correct Culture Groups.
  const def: CityDefinition = {
    ...bundle.def,
    cultureWeights: bundle.def.cultureWeights.filter((w) =>
      yearInEffectiveRange(year, w.years, bounds),
    ),
  };

  return {
    ...bundle,
    def,
    districts,
    locations,
    routes,
    newspapers,
    orgs,
    variants,
  };
}
