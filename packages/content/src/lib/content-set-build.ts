/**
 * Assemble the content-expansion additions to the {@link ContentSet}
 * (content-expansion task 2.4).
 *
 * The slice loader merges the slice content kinds into keyed registries. This
 * spec folds the City Packs, the Era Pack and the Library Packs into the merged
 * set as the extra fields the design's `ContentSetV2` names (design, "Loader
 * pipeline"; the engine's `ContentSetV2` interface in
 * `packages/engine/src/lib/setting/content-set-v2.ts`): `cities`, `era`,
 * `cultureGroups`, `descriptorFragments`, `tagVocabulary`, `cityScopeOwner` and
 * the effective `registry`. (`services` and the Template Variant index are
 * built by the slice loader and tasks 1.8 / 2.2.)
 *
 * The City-Scoped city kinds (`city.yaml`, `locations/*`, `districts/*`, …),
 * the Era kinds and the Library kinds are not merged into the slice keyed
 * registries, so — exactly as `tag-check.ts` does for the Tag check — this
 * module parses them from each ordered pack's already-parsed, well-formed files
 * with their own schemas. A file that fails its schema is skipped here and
 * reported by the loader's merge/validation steps, so a malformed file is never
 * double-reported. The loader runs this builder only after a clean load, so
 * every file parses.
 *
 * Grouping by city: a City Pack ships exactly one `city.yaml`, so every
 * City-Scoped item a `city`-role pack defines belongs to that pack's city. The
 * bundle gathers the pack's districts, locations, routes, city Location Types,
 * newspapers, local orgs, weather, local Cover Identities, street-name pools,
 * the city Locale and the city Template Variants, and the Sources List;
 * `cityScopeOwner` records each City-Scoped id's owning city.
 */

import { effectivePackRole, type PackManifest } from './pack.js';
import { normalizeContentFile } from './content-file.js';
import type { ContentKindRegistration } from './registry.js';
import {
  CoverIdentitySchema,
  LocationTypeSchema,
  type CoverIdentity,
  type LocationType,
} from './kinds.js';
import { buildTagVocabulary, type PackForTagCheck } from './tag-check.js';
import {
  CityDefinitionSchema,
  CityLocationSchema,
  CityRouteSchema,
  DistrictSchema,
  LocalOrgSchema,
  NewspaperSchema,
  SourceSchema,
  StreetsPoolSchema,
  WeatherTablesSchema,
  type CityDefinition,
  type CityLocation,
  type CityRoute,
  type District,
  type LocalOrg,
  type Newspaper,
  type Source,
  type WeatherTables,
} from '../kinds/city.js';
import {
  CultureGroupSchema,
  DescriptorFragmentSchema,
  type CultureGroup,
  type DescriptorFragment,
} from '../kinds/library.js';
import {
  LocaleSchema,
  TemplateVariantSchema,
  type Locale,
  type LocaleScope,
  type TemplateVariant,
} from '../kinds/locale.js';
import { EraSchema } from '../kinds/era.js';
import {
  TagVocabularySchema,
  type TagVocabulary,
} from '../kinds/tag-vocabulary.js';

// --- the shape this module reads from the loader ---------------------------

/** One ordered pack: its manifest and parsed, pack-relative YAML files. */
export interface PackForBuild {
  readonly manifest: PackManifest;
  readonly files: readonly { readonly relPath: string; readonly content: unknown }[];
}

/**
 * A City id, namespaced `<pack>/<name>` like every content id. A City-Scoped
 * item is owned by the city of the pack that defines it.
 */
export type CityId = string;
export type CultureGroupId = string;

/**
 * All of one City Pack's City-Scoped Content, grouped for the setting step.
 * Mirrors the design's `CityBundle` and the engine's `ContentSetV2` interface,
 * so task 3.8 reads a city through this shape.
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
 * The Era Pack content the setting step reads: its Period Window and the era
 * Locale (the fallback for a city's formatting). The remaining era content
 * (technology, ciphers, styles) is read by the Cipher Engine and the Pack
 * Linter, not by the setting step, so it is left off this minimal bundle;
 * mirrors the engine's `EraBundle`.
 */
export interface EraBundle {
  readonly id: string;
  readonly period: { readonly from: number; readonly to: number };
  readonly locale?: Locale;
}

/** Everything this module assembles onto the {@link ContentSet}. */
export interface ContentSetAdditions {
  readonly cities: Readonly<Record<CityId, CityBundle>>;
  readonly era?: EraBundle;
  readonly cultureGroups: Readonly<Record<CultureGroupId, CultureGroup>>;
  readonly descriptorFragments: readonly DescriptorFragment[];
  readonly tagVocabulary: TagVocabulary;
  readonly cityScopeOwner: Readonly<Record<string, CityId>>;
}

// --- file matching + parsing -----------------------------------------------

/**
 * Whether a pack-relative path belongs to a kind written under `dir`: the
 * `<dir>.yaml`/`<dir>.yml` file or any `.yaml`/`.yml` beneath `<dir>/`. Mirrors
 * the loader's `fileOrDir`.
 */
function fileMatchesKind(relPath: string, dir: string): boolean {
  return (
    relPath === `${dir}.yaml` ||
    relPath === `${dir}.yml` ||
    relPath.startsWith(`${dir}/`)
  );
}

/** The items of a parsed file, or [] if it is not a well-formed content file. */
function itemsOf(content: unknown): readonly unknown[] {
  const normalized = normalizeContentFile(content);
  return normalized.ok ? normalized.value.items : [];
}

/** A minimal shape for the schemas this module parses with. */
interface ParsesTo<T> {
  safeParse: (v: unknown) => { success: true; data: T } | { success: false };
}

/**
 * Parse every item of every file of a pack that lives under `dir`, keeping only
 * the ones that pass `schema`. A malformed item is skipped (reported by the
 * loader's merge step).
 */
function parseKind<T>(pack: PackForBuild, dir: string, schema: ParsesTo<T>): T[] {
  const out: T[] = [];
  for (const file of pack.files) {
    if (!fileMatchesKind(file.relPath, dir)) {
      continue;
    }
    for (const item of itemsOf(file.content)) {
      const parsed = schema.safeParse(item);
      if (parsed.success) {
        out.push(parsed.data);
      }
    }
  }
  return out;
}

/** The single `city.yaml` of a City Pack, parsed, or undefined. */
function parseCityDefinition(pack: PackForBuild): CityDefinition | undefined {
  for (const file of pack.files) {
    if (file.relPath !== 'city.yaml' && file.relPath !== 'city.yml') {
      continue;
    }
    const parsed = CityDefinitionSchema.safeParse(file.content);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return undefined;
}

/**
 * Namespace a content reference the way the loader does: a bare `name` becomes
 * `<ownerPack>/<name>`; a `<pack>/<name>` ref is kept as-is.
 */
function namespacedRef(ref: string, ownerPack: string): string {
  return ref.includes('/') ? ref : `${ownerPack}/${ref}`;
}

/**
 * The one Locale a pack defines whose scope matches `pick`. A City Pack defines
 * a city-scoped Locale; an Era Pack an era-scoped one. The last matching Locale
 * wins, matching load order within a pack.
 */
function pickLocale(
  pack: PackForBuild,
  pick: (scope: LocaleScope) => boolean,
): Locale | undefined {
  let found: Locale | undefined;
  for (const item of parseKind<Locale>(pack, 'locale', LocaleSchema)) {
    if (pick(item.scope)) {
      found = item;
    }
  }
  return found;
}

// --- City bundles ----------------------------------------------------------

/** Flatten a City Pack's `streets` name pools into one ordered list of names. */
function collectStreets(pack: PackForBuild): string[] {
  const names: string[] = [];
  for (const pool of parseKind(pack, 'streets', StreetsPoolSchema)) {
    names.push(...pool.names);
  }
  return names;
}

/** The city-scoped Template Variants a City Pack defines for `cityId`. */
function collectCityVariants(pack: PackForBuild, cityId: string): TemplateVariant[] {
  return parseKind<TemplateVariant>(pack, 'template-variants', TemplateVariantSchema).filter(
    (variant) =>
      'city' in variant.scope &&
      namespacedRef(variant.scope.city, pack.manifest.id) === cityId,
  );
}

/**
 * Build one City Pack's {@link CityBundle} from its parsed files. `eraLocale`
 * is the fallback Locale a city with no Locale of its own uses (design,
 * city-then-era fallback).
 */
function buildCityBundle(
  pack: PackForBuild,
  def: CityDefinition,
  eraLocale: Locale | undefined,
): CityBundle {
  const cityId = `${pack.manifest.id}/${def.id}`;
  const ownLocale = pickLocale(
    pack,
    (scope) => 'city' in scope && namespacedRef(scope.city, pack.manifest.id) === cityId,
  );
  const weatherTables = parseKind<WeatherTables>(pack, 'weather', WeatherTablesSchema);

  return {
    def,
    districts: parseKind<District>(pack, 'districts', DistrictSchema),
    locations: parseKind<CityLocation>(pack, 'locations', CityLocationSchema),
    routes: parseKind<CityRoute>(pack, 'routes', CityRouteSchema),
    locationTypes: parseKind<LocationType>(pack, 'location-types', LocationTypeSchema),
    newspapers: parseKind<Newspaper>(pack, 'newspapers', NewspaperSchema),
    orgs: parseKind<LocalOrg>(pack, 'local-orgs', LocalOrgSchema),
    weather: weatherTables[0] ?? emptyWeather(cityId),
    covers: parseKind<CoverIdentity>(pack, 'cover-identities', CoverIdentitySchema),
    streets: collectStreets(pack),
    locale: ownLocale ?? eraLocale ?? fallbackLocale(cityId),
    variants: collectCityVariants(pack, cityId),
    sources: parseKind<Source>(pack, 'sources', SourceSchema),
  };
}

/**
 * A placeholder weather table for a City Pack that ships none, so a bundle
 * always carries the field. A conforming City Pack ships weather (task 9.1),
 * so this is only reached by a partial fixture.
 */
function emptyWeather(cityId: string): WeatherTables {
  const month = [{ id: 'clear', label: 'clear', weight: 1 }];
  return {
    city: cityId,
    months: {
      '1': month,
      '2': month,
      '3': month,
      '4': month,
      '5': month,
      '6': month,
      '7': month,
      '8': month,
      '9': month,
      '10': month,
      '11': month,
      '12': month,
    },
  };
}

/**
 * The Locale a City Bundle must carry when neither a city Locale nor an era
 * Locale is present (a partial fixture). A conforming load always supplies one
 * of those; this minimal English Locale keeps the bundle well-formed rather
 * than leaving the field undefined.
 */
function fallbackLocale(cityId: string): Locale {
  return {
    scope: { city: cityId },
    date: {
      long: '{day} {month} {year}',
      short: '{day}/{month}/{year}',
      months: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
      weekdays: [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ],
    },
    currency: { pattern: '{amount} {symbol}' },
    honorifics: { f: ['Ms'], m: ['Mr'] },
    address: '{street} {number}, {district}',
    terms: [],
    allowNames: [],
  };
}

// --- Era bundle ------------------------------------------------------------

/** Build the Era Bundle from the one Era Pack, or undefined for a core-only load. */
function buildEraBundle(packs: readonly PackForBuild[]): EraBundle | undefined {
  for (const pack of packs) {
    if (effectivePackRole(pack.manifest) !== 'era') {
      continue;
    }
    const era = parseKind(pack, 'era', EraSchema)[0];
    if (era === undefined) {
      continue;
    }
    const locale = pickLocale(pack, (scope) => 'era' in scope);
    return {
      id: `${pack.manifest.id}/${era.id}`,
      period: { from: era.period.from, to: era.period.to },
      ...(locale === undefined ? {} : { locale }),
    };
  }
  return undefined;
}

// --- Tag Vocabulary --------------------------------------------------------

/** True when a pack-relative path is the Tag Vocabulary file (`tags.yaml`). */
function isTagVocabularyFile(relPath: string): boolean {
  return (
    relPath === 'tags.yaml' || relPath === 'tags.yml' || relPath.startsWith('tags/')
  );
}

/**
 * Merge every pack's `tags.yaml` into one serialisable {@link TagVocabulary}:
 * the union of facets, Tags and Required Queries, in pack order. The loader's
 * {@link buildTagVocabulary} index decides whether a vocabulary is present; the
 * raw merge below carries the authored records onto the Content Set in the
 * design's `TagVocabulary` shape.
 */
function mergeTagVocabulary(packs: readonly PackForTagCheck[]): TagVocabulary {
  const facets: TagVocabulary['facets'] = [];
  const tags: TagVocabulary['tags'] = [];
  const requiredQueries: TagVocabulary['requiredQueries'] = [];

  if (!buildTagVocabulary(packs).present) {
    return { facets, tags, requiredQueries };
  }

  for (const pack of packs) {
    for (const file of pack.files) {
      if (!isTagVocabularyFile(file.relPath)) {
        continue;
      }
      const parsed = TagVocabularySchema.safeParse(file.content);
      if (!parsed.success) {
        continue;
      }
      facets.push(...parsed.data.facets);
      tags.push(...parsed.data.tags);
      requiredQueries.push(...parsed.data.requiredQueries);
    }
  }

  return { facets, tags, requiredQueries };
}

// --- city-scope ownership --------------------------------------------------

/** The `id` of a parsed item, if it has a string one. */
function itemId(item: unknown): string | undefined {
  if (
    typeof item === 'object' &&
    item !== null &&
    'id' in (item as Record<string, unknown>) &&
    typeof (item as Record<string, unknown>).id === 'string'
  ) {
    return (item as Record<string, unknown>).id as string;
  }
  return undefined;
}

/**
 * Record, for every City-Scoped item a City Pack defines, that the item's
 * namespaced id is owned by `cityId`. A kind is City-Scoped when its
 * registration says so (`cityScoped: true`); the loader namespaces every item
 * `<pack>/<id>`. Services and Template Variants are City-Scoped too and keyed
 * in their own registries; recording their ids here lets the city-scope
 * cross-reference check (task 2.1) attribute them to their city.
 */
function recordCityScope(
  owner: Record<string, CityId>,
  pack: PackForBuild,
  registry: readonly ContentKindRegistration[],
  cityId: CityId,
): void {
  for (const reg of registry) {
    if (!reg.cityScoped) {
      continue;
    }
    for (const file of pack.files) {
      if (!fileMatchesKind(file.relPath, reg.dir)) {
        continue;
      }
      for (const item of itemsOf(file.content)) {
        const id = itemId(item);
        if (id !== undefined) {
          owner[`${pack.manifest.id}/${id}`] = cityId;
        }
      }
    }
  }
}

// --- the entry point -------------------------------------------------------

/**
 * Assemble the {@link ContentSetAdditions} from the ordered packs and the
 * already built effective registry.
 */
export function buildContentSetAdditions(
  packs: readonly PackForBuild[],
  registry: readonly ContentKindRegistration[],
): ContentSetAdditions {
  const era = buildEraBundle(packs);
  const eraLocale = era?.locale;

  const cities: Record<CityId, CityBundle> = {};
  const cityScopeOwner: Record<string, CityId> = {};
  const cultureGroups: Record<CultureGroupId, CultureGroup> = {};
  const descriptorFragments: DescriptorFragment[] = [];

  for (const pack of packs) {
    const role = effectivePackRole(pack.manifest);

    if (role === 'city') {
      const def = parseCityDefinition(pack);
      if (def === undefined) {
        continue; // not a well-formed City Pack
      }
      const cityId = `${pack.manifest.id}/${def.id}`;
      cities[cityId] = buildCityBundle(pack, def, eraLocale);
      recordCityScope(cityScopeOwner, pack, registry, cityId);
    }

    if (role === 'library') {
      for (const group of parseKind<CultureGroup>(
        pack,
        'culture-groups',
        CultureGroupSchema,
      )) {
        cultureGroups[`${pack.manifest.id}/${group.id}`] = group;
      }
      descriptorFragments.push(
        ...parseKind<DescriptorFragment>(
          pack,
          'descriptor-fragments',
          DescriptorFragmentSchema,
        ),
      );
    }
  }

  const packsForTagCheck: PackForTagCheck[] = packs.map((pack) => ({
    id: pack.manifest.id,
    files: pack.files,
  }));

  return {
    cities,
    ...(era === undefined ? {} : { era }),
    cultureGroups,
    descriptorFragments,
    tagVocabulary: mergeTagVocabulary(packsForTagCheck),
    cityScopeOwner,
  };
}
