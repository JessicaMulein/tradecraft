/**
 * The content-expansion {@link ContentSetV2} shape and its city/era bundles
 * (content-expansion design, "Data Models").
 *
 * The slice {@link ContentSet} carries the slice content kinds; this spec adds
 * City Packs, an Era Pack and Library Packs, which the loader (content-expansion
 * tasks 2.1–2.4) folds into the merged set as the extra fields below. Task 2.4
 * adds those fields to `@tradecraft/content`'s `ContentSet` directly; until it
 * lands, the engine's setting step reads them through this interface, which is
 * the design's `ContentSetV2` verbatim. Keeping the shape here lets the setting
 * step (`drawSetting`, `yearFilter`, and the later `instantiateCity`,
 * `cityView`) be written and tested against the design's contract without
 * waiting on the loader wiring, and the field names match the design so the two
 * line up when task 2.4 merges them onto `ContentSet`.
 *
 * The bundles reuse the authored content kind types from `@tradecraft/content`
 * (`CityDefinition`, `District`, `CityLocation`, …) rather than re-declaring
 * them, so a change to a content schema flows straight through to the setting
 * step.
 */

import type {
  ContentSet,
  CityDefinition,
  District,
  CityLocation,
  CityRoute,
  LocationType,
  Newspaper,
  LocalOrg,
  WeatherTables,
  CoverIdentity,
  Locale,
  TemplateVariant,
  Source,
  CultureGroup,
  DescriptorFragment,
} from '@tradecraft/content';

/**
 * A City id, namespaced `<pack>/<name>` like every content id (design,
 * `CityId = \`${string}/${string}\``). It is a plain string at the type level;
 * the loader guarantees the namespacing. A Culture Group id and a Service id
 * are the same shape.
 */
export type CityId = string;
export type CultureGroupId = string;
export type ServiceId = string;

/**
 * The selector a game places itself with: the Core City (`'core'`) or a loaded
 * City Pack by id. The slice's procedural Core City is the default; a City Pack
 * replaces slice world-generation step 1 with city instantiation (Req 9.1,
 * 9.4, 9.10).
 */
export type CitySelector = CityId | 'core';

/**
 * All of one City Pack's City-Scoped Content, grouped for the setting step
 * (design, `CityBundle`). The `def` is the `city.yaml` record; the rest are the
 * Districts, Locations, Routes, city Location Types, newspapers, local orgs, the
 * monthly weather, local Cover Identities, the street-name pool, the city Locale,
 * the city Template Variants and the Sources List.
 */
export interface CityBundle {
  readonly def: CityDefinition;
  readonly districts: readonly District[];
  readonly locations: readonly CityLocation[];
  readonly routes: readonly CityRoute[];
  readonly locationTypes: readonly LocationType[];
  readonly newspapers: readonly Newspaper[];
  readonly orgs: readonly LocalOrg[];
  readonly weather: WeatherTables;
  readonly covers: readonly CoverIdentity[];
  readonly streets: readonly string[];
  readonly locale: Locale;
  readonly variants: readonly TemplateVariant[];
  readonly sources: readonly Source[];
}

/**
 * The Era Pack's content the setting step reads: its Period Window and era
 * Locale. The design's full `EraBundle` carries more (technology, ciphers,
 * styles); the setting step only needs the Period Window — to intersect with a
 * city's Start Date window and to bound every item's Effective Year Range — and
 * the era Locale, which city formatting falls back to. The remaining era
 * content is read by the Cipher Engine and the Pack Linter, not by `drawSetting`
 * or `yearFilter`, so it is left off this minimal shape; task 2.4's merged
 * `EraBundle` is a superset of it.
 */
export interface EraBundle {
  readonly id: string;
  /** The era Period Window, inclusive years (design, `Era.period`). */
  readonly period: { readonly from: number; readonly to: number };
  /** The era-wide Locale, the fallback for a city's formatting. */
  readonly locale?: Locale;
}

/**
 * The slice {@link ContentSet} plus the content-expansion additions (design,
 * `ContentSetV2`). The setting step reads the city bundles, the era, the
 * Culture Groups and Descriptor Fragments from here; the slice registries stay
 * exactly as the slice left them.
 *
 * `era` is optional: a core-only load (the Core City) ships no Era Pack, so the
 * setting step treats a missing era as an unbounded Period Window.
 */
export interface ContentSetV2 extends ContentSet {
  readonly cities: Readonly<Record<CityId, CityBundle>>;
  readonly era?: EraBundle;
  readonly cultureGroups: Readonly<Record<CultureGroupId, CultureGroup>>;
  readonly descriptorFragments: readonly DescriptorFragment[];
  /** Service Definitions keyed by id (also on the slice `ContentSet.services`). */
  readonly cityScopeOwner: Readonly<Record<string, CityId>>;
}

/**
 * Narrow a {@link ContentSet} to a {@link ContentSetV2} by checking the
 * content-expansion fields are present. The loader (task 2.4) will produce a
 * `ContentSet` that already carries them, at which point this guard always
 * holds; until then it lets a caller that only has the slice shape fail clearly
 * rather than read `undefined`.
 */
export function isContentSetV2(set: ContentSet): set is ContentSetV2 {
  const candidate = set as Partial<ContentSetV2>;
  return (
    typeof candidate.cities === 'object' &&
    candidate.cities !== null &&
    typeof candidate.cultureGroups === 'object' &&
    candidate.cultureGroups !== null &&
    Array.isArray(candidate.descriptorFragments) &&
    typeof candidate.cityScopeOwner === 'object' &&
    candidate.cityScopeOwner !== null
  );
}
