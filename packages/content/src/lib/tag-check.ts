/**
 * The Tag check and Tag Conformance loader stages (content-expansion task 2.3).
 *
 * Two stages of the loader pipeline (design, "Loader pipeline" steps 7 and 9)
 * live here so the entry point stays readable:
 *
 * - **Tag check (step 7).** Every `tags` and `tagQueries` Field Declaration of
 *   every registered content kind is walked, item by item, against the loaded
 *   Tag Vocabulary. A `tags` field carries the item's own Tags, so each is
 *   checked for membership *and* that its facet applies to the owning kind
 *   (Req 4.4). A `tagQueries` field names Tags of the kinds the query binds (a
 *   Location, an archetype), not of the owning item, so a query Tag is checked
 *   only for membership (Req 4.8): a Newspaper's `soldAt` names Location Tags
 *   and a Required Query names Location/archetype Tags, so applying the owner's
 *   kind to a query Tag would never match. Every Location, Location Type,
 *   District, archetype, local organisation and Cover Identity must carry at
 *   least one Tag (Req 4.3).
 *
 * - **Tag Conformance (step 9).** For each City Pack, every Required Query the
 *   vocabulary guarantees is checked to have at least `minStatic` static
 *   Binders: Locations in that city whose Effective Tags (own Tags together
 *   with their Location Type's Tags) satisfy the query within the city's Period
 *   Window, plus archetypes reachable from the City Pack and its dependencies
 *   whose own Tags satisfy the query and whose every non-`fallback` schedule
 *   query binds in the city. A shortfall is a located {@link ContentError} with
 *   path `requiredQueries[<id>]` and message `city <id>: <n> binders, minimum
 *   <m>` (Req 4.5). Required Queries added by an extension pack are checked the
 *   same way against every loaded City Pack (Req 4.7).
 *
 * The Tag Vocabulary file and the City-Scoped city kinds (`city.yaml`,
 * `locations/*`, …) are not merged into the keyed registries, so this module
 * parses them from the ordered packs' raw files with their own schemas. A file
 * that fails its schema is left for the merge/validation steps to report (the
 * Tag check only reads well-formed items), so a malformed file is never
 * double-reported here.
 */

import type { ContentError } from './pack.js';
import type { ContentKindRegistration } from './registry.js';
import { normalizeContentFile } from './content-file.js';
import type { Archetype, LocationType } from './kinds.js';
import {
  CityDefinitionSchema,
  CityLocationSchema,
  type CityLocation,
} from '../kinds/city.js';
import {
  TagVocabularySchema,
  type Facet,
  type RequiredQuery,
  type Tag,
} from '../kinds/tag-vocabulary.js';
import type { YearRange } from './common.js';

// --- the shape the stages need from the loader -----------------------------

/** One discovered pack's id and its parsed, pack-relative YAML files. */
export interface PackForTagCheck {
  readonly id: string;
  readonly files: readonly { readonly relPath: string; readonly content: unknown }[];
}

/** A merged value plus the pack that owns the id (mirrors the loader). */
export interface OwnedValue<T> {
  readonly value: T;
  readonly ownerPack: string;
}

/** The merged registries the Tag Conformance stage reads. */
export interface MergedForConformance {
  readonly locationTypes: ReadonlyMap<string, OwnedValue<LocationType>>;
  readonly archetypes: ReadonlyMap<string, OwnedValue<Archetype>>;
}

// --- JSON-path field extraction --------------------------------------------

/**
 * Resolve a per-item Field Declaration path (the declaration path with its
 * leading `items[]` segment stripped) against one item, yielding every leaf
 * value the path reaches. A `.name` segment descends into a field; a trailing
 * or interior `[]` iterates a list. A path that cannot be followed (a missing
 * field, or a `[]` on a non-list) yields nothing, so an optional or absent
 * field simply contributes no values.
 *
 * The leaves are returned as-is: a Tag field's leaves are tag strings; a Tag
 * Query field's leaves are the query arrays themselves (the final segment names
 * the query field, not its elements).
 */
export function resolveFieldPath(item: unknown, path: string): unknown[] {
  // Tokenise `a.b[].c` into ['a', 'b', '[]', 'c'] — a `[]` is its own token.
  const tokens: string[] = [];
  for (const seg of path.split('.')) {
    if (seg === '') {
      continue;
    }
    let name = seg;
    let brackets = 0;
    while (name.endsWith('[]')) {
      name = name.slice(0, -2);
      brackets += 1;
    }
    if (name !== '') {
      tokens.push(name);
    }
    for (let i = 0; i < brackets; i += 1) {
      tokens.push('[]');
    }
  }

  let frontier: unknown[] = [item];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const node of frontier) {
      if (token === '[]') {
        if (Array.isArray(node)) {
          next.push(...node);
        }
      } else if (
        typeof node === 'object' &&
        node !== null &&
        !Array.isArray(node) &&
        token in (node as Record<string, unknown>)
      ) {
        next.push((node as Record<string, unknown>)[token]);
      }
    }
    frontier = next;
  }
  return frontier.filter((v) => v !== undefined && v !== null);
}

/** Strip the leading `items[]`/`items` segment of a declaration path. */
function perItemPath(path: string): string {
  if (path === 'items' || path === 'items[]') {
    return '';
  }
  if (path.startsWith('items[].')) {
    return path.slice('items[].'.length);
  }
  if (path.startsWith('items.')) {
    return path.slice('items.'.length);
  }
  return path;
}

/** The items of a parsed file, or [] if it is not a well-formed content file. */
function itemsOf(content: unknown): readonly unknown[] {
  const normalized = normalizeContentFile(content);
  return normalized.ok ? normalized.value.items : [];
}

// --- the Tag Vocabulary index ----------------------------------------------

/**
 * The loaded Tag Vocabulary, indexed for the Tag check: every known Tag id, the
 * kinds each Tag applies to, and the Required Queries. Built by merging every
 * pack's `tags.yaml` (the core pack's vocabulary plus any an extension pack
 * adds, Req 4.7); a later pack's facet/Tag/Required Query simply extends the
 * set.
 */
export interface TagVocabularyIndex {
  /** Tag id -> the registry kind names it may appear on. */
  readonly appliesTo: ReadonlyMap<string, ReadonlySet<string>>;
  /** Every Required Query, in the order the packs declared them. */
  readonly requiredQueries: readonly RequiredQuery[];
  /** True once at least one `tags.yaml` parsed into the index. */
  readonly present: boolean;
}

/** True when a pack-relative path is the Tag Vocabulary file (`tags.yaml`). */
function isTagVocabularyFile(relPath: string): boolean {
  return (
    relPath === 'tags.yaml' ||
    relPath === 'tags.yml' ||
    relPath.startsWith('tags/')
  );
}

/**
 * Build the {@link TagVocabularyIndex} from the ordered packs' `tags.yaml`
 * files. A Tag's applicable kinds are its own `appliesTo` if set, otherwise its
 * facet's `appliesTo` (design, "Tag Vocabulary"); an unknown facet prefix
 * leaves the Tag with no applicable kinds, so it is reported wherever it is
 * used. A `tags.yaml` that fails {@link TagVocabularySchema} is skipped here
 * and reported by the merge step.
 */
export function buildTagVocabulary(
  packs: readonly PackForTagCheck[],
): TagVocabularyIndex {
  const facetKinds = new Map<string, ReadonlySet<string>>();
  const tags: Tag[] = [];
  const requiredQueries: RequiredQuery[] = [];
  let present = false;

  for (const pack of packs) {
    for (const file of pack.files) {
      if (!isTagVocabularyFile(file.relPath)) {
        continue;
      }
      const parsed = TagVocabularySchema.safeParse(file.content);
      if (!parsed.success) {
        continue; // reported by the merge step
      }
      present = true;
      for (const facet of parsed.data.facets as Facet[]) {
        facetKinds.set(facet.id, new Set(facet.appliesTo));
      }
      tags.push(...(parsed.data.tags as Tag[]));
      requiredQueries.push(...(parsed.data.requiredQueries as RequiredQuery[]));
    }
  }

  const appliesTo = new Map<string, ReadonlySet<string>>();
  for (const tag of tags) {
    const facetId = tag.id.slice(0, tag.id.indexOf(':'));
    const kinds =
      tag.appliesTo !== undefined
        ? new Set(tag.appliesTo)
        : (facetKinds.get(facetId) ?? new Set<string>());
    appliesTo.set(tag.id, kinds);
  }

  return { appliesTo, requiredQueries, present };
}

// --- step 7: the Tag check -------------------------------------------------

/** The kinds that must carry at least one Tag (Req 4.3). */
const KINDS_REQUIRING_A_TAG: ReadonlySet<string> = new Set([
  'location',
  'location-type',
  'district',
  'archetype',
  'local-org',
  'cover-identity',
]);

/**
 * Walk every `tags` and `tagQueries` Field Declaration of every registered
 * kind, item by item, and check each Tag against the vocabulary and facet
 * applicability (Req 4.4, 4.8); and require a Tag on the kinds of Req 4.3.
 * Collects located errors into `errors`.
 */
export function checkTags(
  packs: readonly PackForTagCheck[],
  registry: readonly ContentKindRegistration[],
  vocabulary: TagVocabularyIndex,
  errors: ContentError[],
): void {
  // The Tag check validates Tags and Tag Queries against a loaded Tag
  // Vocabulary. With no vocabulary present there is nothing to validate against
  // — a slice-era pack set (schema 1, no `tags.yaml`) loads unchanged until the
  // core pack ships its vocabulary (task 7.1, Req 1.2, slice Req 31.7). Once a
  // vocabulary is loaded, both the membership/applicability check and the
  // every-item-carries-a-Tag rule (Req 4.3) engage.
  if (!vocabulary.present) {
    return;
  }

  // A Tag used anywhere is only valid when the vocabulary knows it and lists
  // this kind among the kinds the Tag applies to. With no vocabulary loaded at
  // all, there is nothing to check against; the role rules decide whether a
  // vocabulary is required.
  // A `tags` field carries the item's own Tags: each must be in the vocabulary
  // and its facet must apply to the owning kind (Req 4.4). A `tagQueries` field
  // names Tags of the kinds the query *binds* (another kind — a Location, an
  // archetype), not of the owning item, so a query Tag is checked only for
  // membership (Req 4.8); facet applicability of query Tags is a Conformance
  // concern, not an own-Tag concern.
  const checkOwnTag = (
    tag: string,
    kind: string,
    pack: string,
    file: string,
    path: string,
  ): void => {
    const kinds = vocabulary.appliesTo.get(tag);
    if (kinds === undefined) {
      errors.push({
        pack,
        file,
        path,
        message: `tag "${tag}" is not in the Tag Vocabulary`,
      });
      return;
    }
    if (!kinds.has(kind)) {
      errors.push({
        pack,
        file,
        path,
        message: `tag "${tag}" does not apply to kind "${kind}"`,
      });
    }
  };

  const checkQueryTag = (
    tag: string,
    pack: string,
    file: string,
    path: string,
  ): void => {
    if (!vocabulary.appliesTo.has(tag)) {
      errors.push({
        pack,
        file,
        path,
        message: `tag "${tag}" is not in the Tag Vocabulary`,
      });
    }
  };

  for (const pack of packs) {
    for (const file of pack.files) {
      const reg = registry.find((r) => fileMatchesKind(file.relPath, r.dir));
      if (reg === undefined) {
        continue;
      }
      const items = itemsOf(file.content);

      items.forEach((item, index) => {
        const base = `items[${index}]`;

        // tags: every leaf is a single Tag string.
        for (const decl of reg.fields.tags ?? []) {
          const rel = perItemPath(decl);
          const leaves = resolveFieldPath(item, rel);
          leaves.forEach((leaf, i) => {
            if (typeof leaf !== 'string') {
              return; // a non-string here is a schema problem, reported elsewhere
            }
            checkOwnTag(leaf, reg.kind, pack.id, file.relPath, tagLeafPath(base, rel, i));
          });
        }

        // tagQueries: every leaf is a query (a Tag array).
        for (const decl of reg.fields.tagQueries ?? []) {
          const rel = perItemPath(decl);
          const leaves = resolveFieldPath(item, rel);
          leaves.forEach((query, qi) => {
            if (!Array.isArray(query)) {
              return;
            }
            query.forEach((tag, ti) => {
              if (typeof tag !== 'string') {
                return;
              }
              checkQueryTag(
                tag,
                pack.id,
                file.relPath,
                `${queryLeafPath(base, rel, qi)}[${ti}]`,
              );
            });
          });
        }

        // Req 4.3: the kind must carry at least one Tag.
        if (KINDS_REQUIRING_A_TAG.has(reg.kind) && countOwnTags(item, reg) === 0) {
          errors.push({
            pack: pack.id,
            file: file.relPath,
            path: base,
            message: `a ${reg.kind} must carry at least one tag`,
          });
        }
      });
    }
  }
}

/**
 * The number of own Tags an item carries, summed over the kind's `tags` Field
 * Declarations. Tag Query fields are not counted — a schedule or `members`
 * query is not an item's own Tag.
 */
function countOwnTags(item: unknown, reg: ContentKindRegistration): number {
  let count = 0;
  for (const decl of reg.fields.tags ?? []) {
    count += resolveFieldPath(item, perItemPath(decl)).filter(
      (v) => typeof v === 'string',
    ).length;
  }
  return count;
}

/**
 * The error path for the `i`-th leaf of a per-item tag path. A list-valued tag
 * field (`tags[]`) reports `items[k].tags[i]`; a scalar tag field (`climate`)
 * reports `items[k].climate`.
 */
function tagLeafPath(base: string, rel: string, i: number): string {
  if (rel === '') {
    return base;
  }
  const field = rel.replace(/\[\]$/, '');
  return rel.endsWith('[]') ? `${base}.${field}[${i}]` : `${base}.${field}`;
}

/** The error path for the `i`-th query of a per-item Tag Query path. */
function queryLeafPath(base: string, rel: string, i: number): string {
  if (rel === '') {
    return base;
  }
  // A list-of-queries field (e.g. `members[]`, `schedule[].at`) indexes the
  // query; a single-query field (`soldAt`) does not.
  if (rel.endsWith('[]')) {
    return `${base}.${rel.replace(/\[\]$/, '')}[${i}]`;
  }
  if (rel.includes('[]')) {
    // e.g. `schedule[].at` -> `schedule[i].at`
    return `${base}.${rel.replace('[]', `[${i}]`)}`;
  }
  return `${base}.${rel}`;
}

// --- step 9: Tag Conformance -----------------------------------------------

/** A Location with its Effective Tags resolved and its in-window flag. */
interface CityBinderLocation {
  readonly effectiveTags: ReadonlySet<string>;
  readonly inWindow: boolean;
}

/**
 * Check Tag Conformance for every City Pack against every Required Query the
 * vocabulary guarantees (Req 4.5, 4.7). Collects a located {@link ContentError}
 * per shortfall into `errors`.
 */
export function checkTagConformance(
  packs: readonly PackForTagCheck[],
  merged: MergedForConformance,
  vocabulary: TagVocabularyIndex,
  errors: ContentError[],
): void {
  if (vocabulary.requiredQueries.length === 0) {
    return;
  }

  // Index merged Location Types by both their namespaced id and (per owning
  // pack) their bare id, so a City Location's `type` reference resolves the
  // same way the loader namespaces references (bare `name` -> `<pack>/<name>`).
  const locationTypeTags = (ref: string, ownerPack: string): ReadonlySet<string> => {
    const id = ref.includes('/') ? ref : `${ownerPack}/${ref}`;
    const lt = merged.locationTypes.get(id);
    return lt === undefined ? new Set() : new Set(lt.value.tags);
  };

  for (const pack of packs) {
    const city = parseCity(pack);
    if (city === undefined) {
      continue; // not a City Pack (no well-formed city.yaml)
    }

    const locations = collectCityLocations(pack, city.period, locationTypeTags);
    const archetypeBinds = (query: readonly string[]): number =>
      countArchetypeBinders(query, merged.archetypes, locations);

    for (const rq of vocabulary.requiredQueries) {
      const query = rq.query as readonly string[];
      const locationBinders = locations.filter(
        (loc) => loc.inWindow && satisfiesQuery(loc.effectiveTags, query),
      ).length;
      const binders = locationBinders + archetypeBinds(query);

      if (binders < rq.minStatic) {
        errors.push({
          pack: pack.id,
          file: 'tag-conformance',
          path: `requiredQueries[${rq.id}]`,
          message: `city ${city.id}: ${binders} binders, minimum ${rq.minStatic}`,
        });
      }
    }
  }
}

/** The city identity and period a Conformance pass reads from `city.yaml`. */
interface CityHeader {
  readonly id: string;
  readonly period: YearRange;
}

/** Parse a pack's `city.yaml` into its id and Period Window, or undefined. */
function parseCity(pack: PackForTagCheck): CityHeader | undefined {
  for (const file of pack.files) {
    if (file.relPath !== 'city.yaml' && file.relPath !== 'city.yml') {
      continue;
    }
    const parsed = CityDefinitionSchema.safeParse(file.content);
    if (!parsed.success) {
      return undefined; // malformed city.yaml is reported by its own loader
    }
    return { id: parsed.data.id, period: parsed.data.period };
  }
  return undefined;
}

/**
 * Resolve every City Location in the pack to its Effective Tags (own Tags ∪ its
 * Location Type's Tags) and whether its Year Range lies within the city's
 * Period Window. A Location with no `years` is always in window; one with a
 * `years` counts when that range overlaps the city period.
 */
function collectCityLocations(
  pack: PackForTagCheck,
  period: YearRange,
  locationTypeTags: (ref: string, ownerPack: string) => ReadonlySet<string>,
): CityBinderLocation[] {
  const out: CityBinderLocation[] = [];
  for (const file of pack.files) {
    if (!fileMatchesKind(file.relPath, 'locations')) {
      continue;
    }
    for (const item of itemsOf(file.content)) {
      const parsed = CityLocationSchema.safeParse(item);
      if (!parsed.success) {
        continue; // malformed location reported by the merge/validation steps
      }
      const loc: CityLocation = parsed.data;
      const effective = new Set<string>(loc.tags);
      for (const tag of locationTypeTags(loc.type, pack.id)) {
        effective.add(tag);
      }
      out.push({
        effectiveTags: effective,
        inWindow: loc.years === undefined || rangesOverlap(loc.years, period),
      });
    }
  }
  return out;
}

/**
 * Count the archetypes that bind the query: an archetype whose own Tags satisfy
 * the query and whose every non-`fallback` schedule query has a static Location
 * Binder in the city (design, "Library content"; a city counts an archetype
 * only when every schedule `at` binds there). Archetypes with no schedule bind
 * trivially. The archetype set is the whole merged registry, since archetypes
 * are not City-Scoped and are reachable from any City Pack's dependencies.
 */
function countArchetypeBinders(
  query: readonly string[],
  archetypes: ReadonlyMap<string, OwnedValue<Archetype>>,
  locations: readonly CityBinderLocation[],
): number {
  let count = 0;
  for (const entry of archetypes.values()) {
    const arch = entry.value;
    if (!satisfiesQuery(new Set(arch.tags), query)) {
      continue;
    }
    const bindsInCity = arch.schedule.every((slot) =>
      locations.some(
        (loc) => loc.inWindow && satisfiesQuery(loc.effectiveTags, slot.at),
      ),
    );
    if (bindsInCity) {
      count += 1;
    }
  }
  return count;
}

/** True when `tags` contains every Tag the query names. */
function satisfiesQuery(tags: ReadonlySet<string>, query: readonly string[]): boolean {
  return query.every((tag) => tags.has(tag));
}

/** True when two inclusive year ranges share at least one year. */
function rangesOverlap(a: YearRange, b: YearRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

// --- shared file matching --------------------------------------------------

/**
 * Whether a pack-relative path belongs to a kind written under `dir`: the
 * `<dir>.yaml`/`<dir>.yml` file or any `.yaml`/`.yml` beneath `<dir>/`. Mirrors
 * the loader's `fileOrDir`, kept local so this module does not depend on the
 * loader.
 */
function fileMatchesKind(relPath: string, dir: string): boolean {
  return (
    relPath === `${dir}.yaml` ||
    relPath === `${dir}.yml` ||
    relPath.startsWith(`${dir}/`)
  );
}
