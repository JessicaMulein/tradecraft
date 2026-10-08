/**
 * The {@link CityView} projection (content-expansion task 3.8; design,
 * "CityView").
 *
 * `CityView` is the read-only projection that the binders in follow-on specs
 * (plot-library's Binder, ambient-world's selectors) read the city through. It
 * is built once per game after the setting step, from the generated city (the
 * Instantiated City for a City Pack, or the slice's procedural Core City) and
 * the year-filtered Content Set, and exposed to the later generation steps
 * (content-expansion Req 17.6). It holds no truth-side state and draws no
 * randomness, so a binder's draws depend only on its own stream and the view
 * (design, "CityView").
 *
 * The view answers four kinds of question over the Tag Vocabulary:
 *
 * - **`entities(kind)`** — the Effective Tags of every bindable entity of a
 *   kind, id-sorted. The Effective Tags of a Location are its own Tags together
 *   with its Location Type's Tags (a slice Location carries no own Tags, so they
 *   are exactly the Location Type's Tags, as the schedule binder reads them);
 *   an organisation's and a technology item's Tags are its own.
 * - **`binders(kind, q)`** — the ids of the entities of a kind whose Effective
 *   Tags contain every Tag in the query, id-sorted. This is the generation-time
 *   analogue of the loader's static Binder count.
 * - **`archetypesWithTags(q)` / `locationTypesWithTags(q)`** — the content
 *   archetypes and Location Types whose own Tags satisfy the query. Archetypes
 *   are not instantiated per city, so these read the whole (year-filtered)
 *   Content Set, matching the Required-Query rule that archetype queries are
 *   satisfied from the Content Set as a whole.
 * - **`requiredQueries`** and **`services`** — the merged Required Queries (core
 *   plus any extension-pack queries) and the city's referenced Service
 *   Definitions, which the Station/Hostile organisation naming and the
 *   follow-on binders read.
 *
 * The view projects over the generated slice {@link City}, so both the Core
 * City Path and the City-Pack path produce the same shape of view: the setting
 * step builds the city (by `generateCity` on the setting stream, or by
 * `instantiateCity` folded into a slice `City`), then this module projects it.
 */

import type { City } from '../city/city.js';
import type { EntityId } from '../model/core.js';
import type {
  ContentSet,
  LocationType,
  Archetype,
  RequiredQuery,
  ServiceDefinition,
  TagVocabulary,
} from '@tradecraft/content';

import type { CitySelector, ContentSetV2 } from './content-set-v2.js';
import type { IsoDate, SettingSelection } from './setting.js';

/**
 * A kind of entity the view can bind by Tag Query (design, `BindableKind`):
 * the built-in `loc`, `district`, `org` and `item`, plus any registered kind
 * that declares `tags` Field Declarations (named by its kind string). This
 * spec's generator reads `loc`, `org`, `item`, archetypes and Location Types;
 * follow-on specs read their own registered kinds by name.
 */
export type BindableKind = 'loc' | 'district' | 'org' | 'item' | string;

/** An entity's id together with its Effective Tags, as the view exposes it. */
export interface TaggedEntity {
  readonly id: EntityId;
  readonly tags: readonly string[];
}

/**
 * The read-only city projection the setting step hands to the later generation
 * steps and follow-on binders (design, `CityView`). Every list it returns is
 * id-sorted so a binder's draws over it are deterministic.
 */
export interface CityView {
  readonly city: CitySelector;
  readonly year: number;
  readonly startDate: IsoDate;
  /** The Effective Tags of every bindable entity of a kind, id-sorted. */
  entities(kind: BindableKind): TaggedEntity[];
  /** The ids of the entities of a kind whose Effective Tags ⊇ `q`, id-sorted. */
  binders(kind: BindableKind, q: readonly string[]): EntityId[];
  /** The archetypes whose own Tags ⊇ `q`, id-sorted. */
  archetypesWithTags(q: readonly string[]): string[];
  /** The Location Types whose own Tags ⊇ `q`, id-sorted. */
  locationTypesWithTags(q: readonly string[]): string[];
  /** The merged Required Queries (core plus extension-pack queries). */
  readonly requiredQueries: readonly RequiredQuery[];
  /** The city's referenced Service Definitions, id-sorted. */
  readonly services: readonly ServiceDefinition[];
}

/** True when `tags` contains every Tag in `q` (Effective Tags ⊇ q). */
function satisfies(tags: ReadonlySet<string>, q: readonly string[]): boolean {
  for (const tag of q) {
    if (!tags.has(tag)) {
      return false;
    }
  }
  return true;
}

/** Id-sort a list of tagged entities by their id. */
function byId<T extends { readonly id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Build the Location-Type → Tags lookup, keyed by both namespaced and bare id. */
function locationTypeTags(content: ContentSet): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [id, type] of content.locationTypes) {
    const typed = type as LocationType;
    out.set(id, typed.tags);
    const slash = id.indexOf('/');
    if (slash !== -1) {
      out.set(id.slice(slash + 1), typed.tags);
    }
  }
  return out;
}

/**
 * The local organisations' Tags for the selected city, keyed by the engine org
 * id (`org:<local>`). For the Core City (or a Content Set without the
 * content-expansion fields) there are none; a City Pack contributes its
 * `LocalOrg`s' Tags. The engine mints a local org id as `org:<content-local-id>`.
 */
function localOrgTags(
  set: ContentSetV2 | ContentSet,
  city: CitySelector,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  const v2 = set as Partial<ContentSetV2>;
  if (city === 'core' || v2.cities === undefined) {
    return out;
  }
  const bundle = v2.cities[city];
  if (bundle === undefined) {
    return out;
  }
  for (const org of bundle.orgs) {
    const local = org.id.includes('/') ? org.id.slice(org.id.indexOf('/') + 1) : org.id;
    out.set(`org:${local}`, org.tags);
  }
  return out;
}

/**
 * Build the {@link CityView} for a generated world (design, `cityView`).
 *
 * `city` is the generated slice {@link City} (the Core City or the slice `City`
 * folded from an Instantiated City); `set` is the **year-filtered** Content Set
 * (`yearFilter` applied for the Game Year); `setting` is the setting selection
 * the step produced. The view is pure over its inputs and holds no truth-side
 * state.
 *
 * Locations come from the generated city, with Effective Tags read from their
 * Location Type's Tags. Local organisations come from the city bundle (none for
 * the Core City). Items (`item`) are the Content Set's plot items, tagged with
 * the materiel queries plot templates bind. A set that loaded no plot items
 * has an empty item list. Archetypes and Location Types read the whole Content
 * Set, since they are not instantiated per city.
 */
export function cityView(
  city: City,
  set: ContentSetV2 | ContentSet,
  setting: SettingSelection,
): CityView {
  const typeTags = locationTypeTags(set);
  const orgTags = localOrgTags(set, setting.city);

  // Locations: Effective Tags = Location Type Tags (slice Location has no own).
  const locationEntities: TaggedEntity[] = byId(
    Object.values(city.locations).map((loc) => ({
      id: loc.id as EntityId,
      tags: typeTags.get(loc.type) ?? [],
    })),
  );

  // Districts: the slice District carries no Tags at the engine layer, so it
  // projects with an empty Tag set (the authored District's Tags are not folded
  // onto the generated city). Kept as a bindable kind so a follow-on query by
  // id order still works.
  const districtEntities: TaggedEntity[] = byId(
    Object.values(city.districts).map((d) => ({
      id: d.id as EntityId,
      tags: [] as readonly string[],
    })),
  );

  // Local organisations from the city bundle, keyed by their engine org id.
  const orgEntities: TaggedEntity[] = byId(
    [...orgTags.entries()].map(([id, tags]) => ({ id: id as EntityId, tags })),
  );

  const plotItems: TaggedEntity[] = byId(
    [...(set.plotItems?.entries() ?? [])].map(([id, item]) => ({
      id: id as EntityId,
      tags: item.tags,
    })),
  );

  const entitiesByKind = (kind: BindableKind): TaggedEntity[] => {
    switch (kind) {
      case 'loc':
        return locationEntities;
      case 'district':
        return districtEntities;
      case 'org':
        return orgEntities;
      case 'item':
        return plotItems;
      default:
        return [];
    }
  };

  const vocab: TagVocabulary | undefined = (set as Partial<ContentSetV2>)
    .tagVocabulary;
  const requiredQueries: readonly RequiredQuery[] = vocab?.requiredQueries ?? [];

  const services: readonly ServiceDefinition[] = resolveCityServices(set, setting.city);

  return {
    city: setting.city,
    year: setting.year,
    startDate: setting.startDate,
    entities: entitiesByKind,
    binders(kind, q) {
      const tagged = entitiesByKind(kind);
      return tagged
        .filter((e) => satisfies(new Set(e.tags), q))
        .map((e) => e.id);
    },
    archetypesWithTags(q) {
      const out: string[] = [];
      for (const [id, archetype] of set.archetypes) {
        if (satisfies(new Set((archetype as Archetype).tags), q)) {
          out.push(id);
        }
      }
      return out.sort();
    },
    locationTypesWithTags(q) {
      const out: string[] = [];
      for (const [id, type] of set.locationTypes) {
        if (satisfies(new Set((type as LocationType).tags), q)) {
          out.push(id);
        }
      }
      return out.sort();
    },
    requiredQueries,
    services,
  };
}

/**
 * The Service Definitions the selected city references, id-sorted. For the Core
 * City (or a slice Content Set with no City Pack) there are none — the slice
 * mints the Station, Hostile Service and Cell from fixed name pools, so the
 * view carries an empty service list. For a City Pack, the city's `services`
 * ids are resolved against the Content Set's service registry.
 */
function resolveCityServices(
  set: ContentSetV2 | ContentSet,
  city: CitySelector,
): ServiceDefinition[] {
  const v2 = set as Partial<ContentSetV2> & Pick<ContentSet, 'services'>;
  if (city === 'core' || v2.cities === undefined) {
    return [];
  }
  const bundle = v2.cities[city];
  if (bundle === undefined) {
    return [];
  }
  const out: ServiceDefinition[] = [];
  for (const id of bundle.def.services) {
    const service = set.services.get(id);
    if (service !== undefined) {
      out.push(service);
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
