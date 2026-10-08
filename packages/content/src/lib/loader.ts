/**
 * The Content Pack loader (task 2.4).
 *
 * A pack is a directory with a `pack.yaml` manifest and typed YAML files. The
 * loader turns a set of such directories into one merged {@link ContentSet},
 * running the seven steps the design fixes (design, "Content Packs"):
 *
 * 1. Parse each `pack.yaml`, check `contentSchema`, resolve `requires`.
 * 2. Order packs topologically, ties broken by pack id. A missing dependency,
 *    an incompatible version or a cycle is an error.
 * 3. Parse every file with its Zod schema. Ids are namespaced `<pack>/<name>`.
 * 4. Merge into registries per kind. A duplicate id is an error unless the
 *    later pack lists it in `overrides`.
 * 5. Check cross-references (archetype → persona pools, Plot template →
 *    predicates and archetypes, Location Type → action ids, template slots →
 *    declared slots).
 * 6. Compile templates and the predicate registry.
 * 7. Hash each pack as SHA-256 over its files' canonical JSON (keys sorted), in
 *    path order, and build the Content Manifest.
 *
 * Every problem becomes a located {@link ContentError} (pack, file, path,
 * message) and the loader collects them all rather than stopping at the first,
 * so an author sees the whole picture (Requirement 31.2). The loader is the
 * only part of `content` that touches disk; it reads with `node:fs` and hashes
 * with `node:crypto`, which the dependency rules allow, and parses YAML with
 * the `yaml` dependency.
 *
 * Determinism: the merged set and its manifest depend only on the pack
 * contents and the resolved load order, never on filesystem enumeration order.
 * Directory listings are sorted, packs are ordered topologically with ties by
 * id, and the per-pack hash walks files in path order. Loading the same packs
 * in a different `dirs`/`selected` order yields the same `ContentSet`
 * (Requirements 31.3, 31.5).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { z } from 'zod';

import {
  CONTENT_SCHEMA_GENERATION,
  CONTENT_SCHEMA_MAX,
  PackManifestSchema,
  type ContentError,
  type ContentManifest,
  type ManifestEntry,
  type PackManifest,
} from './pack.js';
import { isContentFileEnvelope, normalizeContentFile } from './content-file.js';
import { PredicateFileSchema, type PredicateDefinition } from './predicate.js';
import {
  ArchetypeSchema,
  CoverIdentitySchema,
  DocumentTemplateSchema,
  LocationTypeSchema,
  PersonaLibrarySchema,
  PlotTemplateSchema,
  RumourTemplateSchema,
  SideThreadTemplateSchema,
} from './kinds.js';
import { HintSchema } from './hint.js';
import {
  PlotItemSchema,
  PlotTemplateV2Schema,
  ProperNounFileSchema,
  checkPlotTemplateV2,
  isTemplateSchemaV2,
  type PlotItem,
  type PlotTemplateV2,
} from './plot-v2.js';
import { GlossaryFileSchema, type GlossaryTerm } from './glossary.js';
import { DifficultyPresetSchema } from './difficulty.js';
import {
  SLICE_KIND_REGISTRATIONS,
  type ContentKindRegistration,
  type LoadOptions,
} from './registry.js';
import { CONTENT_EXPANSION_KIND_REGISTRATIONS } from '../kinds/index.js';
import {
  ServiceDefinitionSchema,
  type ServiceDefinition,
} from '../kinds/service.js';
import { CityDefinitionSchema } from '../kinds/city.js';
import {
  TemplateVariantSchema,
  type TemplateVariant,
} from '../kinds/locale.js';
import {
  compileTemplateVariants,
  documentBaseTemplate,
  type BaseTemplate,
  type CompiledVariantScope,
  type RawVariant,
  type TemplateVariantIndex,
} from './template-variant.js';
import {
  DescriptorDataSchema,
  DESCRIPTOR_FILE,
  descriptorPoolIds,
} from './descriptor-data.js';
import { compilePredicateRegistry } from './predicate-registry.js';
import { parseVersion, parseRange, satisfies } from './semver.js';
import { hashPack } from './hash.js';
import type { ContentSet, LoadResult } from './content-set.js';
import {
  buildTagVocabulary,
  checkTagConformance,
  checkTags,
  type MergedForConformance,
  type PackForTagCheck,
} from './tag-check.js';
import { checkProvenance, type PackForProvenance } from './provenance-gate.js';
import {
  buildContentSetAdditions,
  type PackForBuild,
} from './content-set-build.js';

// --- error helpers ---------------------------------------------------------

/** A mutable sink the whole load threads its errors through. */
type ErrorSink = ContentError[];

/** Format a Zod issue path as the dotted/bracketed string used in errors. */
function formatZodPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
}

/** Turn a Zod error into located content errors for one pack/file. */
function pushZodErrors(
  errors: ErrorSink,
  pack: string,
  file: string,
  basePath: string,
  error: z.ZodError,
): void {
  for (const issue of error.issues) {
    const sub = formatZodPath(issue.path);
    const path =
      basePath === '' ? sub : sub === '' ? basePath : `${basePath}${sub.startsWith('[') ? '' : '.'}${sub}`;
    errors.push({ pack, file, path, message: issue.message });
  }
}

// --- kind registration -----------------------------------------------------

/** The registries a pack's files merge into, by kind. */
interface Registries {
  predicates: PredicateDefinition[];
  archetypes: Map<string, Namespaced<z.infer<typeof ArchetypeSchema>>>;
  locationTypes: Map<string, Namespaced<z.infer<typeof LocationTypeSchema>>>;
  plotTemplates: Map<string, Namespaced<z.infer<typeof PlotTemplateSchema>>>;
  sideThreadTemplates: Map<
    string,
    Namespaced<z.infer<typeof SideThreadTemplateSchema>>
  >;
  documentTemplates: Map<
    string,
    Namespaced<z.infer<typeof DocumentTemplateSchema>>
  >;
  personaLibraries: Map<string, Namespaced<z.infer<typeof PersonaLibrarySchema>>>;
  coverIdentities: Map<string, Namespaced<z.infer<typeof CoverIdentitySchema>>>;
  rumourTemplates: Map<string, Namespaced<z.infer<typeof RumourTemplateSchema>>>;
  hints: Map<string, Namespaced<z.infer<typeof HintSchema>>>;
  /**
   * Glossary terms keyed by the term itself (Requirement 26.5). A glossary
   * entry has no authored `id`, so it is not a keyed-kind collection; it is
   * merged by `term`, with a later pack's definition overriding an earlier
   * one, so the Help view reads one definition per term.
   */
  glossary: Map<string, GlossaryTerm>;
  difficultyPresets: Map<string, Namespaced<z.infer<typeof DifficultyPresetSchema>>>;
  /** Template Schema v2 plots (plot-library). Slice plots stay in `plotTemplates`. */
  plotTemplatesV2: Map<string, Namespaced<PlotTemplateV2>>;
  sideThreadTemplatesV2: Map<string, Namespaced<PlotTemplateV2>>;
  plotItems: Map<string, Namespaced<PlotItem>>;
  /** Pack-level proper nouns, keyed by pack id. */
  properNouns: Map<string, readonly string[]>;
  /**
   * Service Definitions, keyed by namespaced id (content-expansion task 1.8).
   * Shared services from an Era Pack and a City Pack's City-Scoped
   * local-security service merge here; a `CityDefinition.services` reference
   * resolves against this registry (Req 19.2).
   */
  services: Map<string, Namespaced<ServiceDefinition>>;
  /**
   * Template Variants, keyed by namespaced id (content-expansion task 2.2). An
   * era-scoped variant from an Era Pack and a City Pack's City-Scoped variant
   * merge here; compilation and the slot-set check against the base template
   * (CE-VARIANT, Req 8.3) run in step 8 against this registry.
   */
  templateVariants: Map<string, Namespaced<TemplateVariant>>;
  /**
   * Every descriptor pool id a pack's `descriptors.yaml` defines, namespaced
   * `<pack>/<poolId>`, so an archetype's `descriptorPools` reference resolves
   * the same way every other cross-reference does. The descriptor library is a
   * singleton file per pack rather than a keyed collection kind, so it only
   * contributes the set of pool ids the cross-reference check reads; the engine
   * reads the pools' contents through `loadDescriptorData`.
   */
  descriptorPools: Map<string, true>;
}

/** A merged value plus the pack that currently owns the id (for overrides). */
interface Namespaced<T> {
  readonly value: T;
  readonly ownerPack: string;
}

/** Each kind-bearing file maps to one of these registry targets. */
type RegistryKey = Exclude<keyof Registries, 'predicates'>;

/**
 * A file-path pattern and the kind it carries. `match` decides whether a
 * pack-relative path (always `/`-separated) belongs to the kind. Single-file
 * kinds match an exact name; collection kinds match any `.yaml` under a
 * directory, so `archetypes/cell.yaml` and a flat `archetypes.yaml` both work.
 */
interface KindRule {
  readonly key: RegistryKey;
  readonly schema: z.ZodType;
  readonly match: (relPath: string) => boolean;
}

/** True for `name.yaml`/`name.yml` or any `.yaml`/`.yml` under `name/`. */
function fileOrDir(name: string): (relPath: string) => boolean {
  return (relPath) =>
    relPath === `${name}.yaml` ||
    relPath === `${name}.yml` ||
    relPath.startsWith(`${name}/`);
}

const KIND_RULES: readonly KindRule[] = [
  { key: 'archetypes', schema: ArchetypeSchema, match: fileOrDir('archetypes') },
  {
    key: 'locationTypes',
    schema: LocationTypeSchema,
    match: fileOrDir('location-types'),
  },
  { key: 'plotTemplates', schema: PlotTemplateSchema, match: fileOrDir('plots') },
  {
    key: 'sideThreadTemplates',
    schema: SideThreadTemplateSchema,
    match: fileOrDir('side-threads'),
  },
  {
    key: 'documentTemplates',
    schema: DocumentTemplateSchema,
    match: fileOrDir('documents'),
  },
  {
    key: 'personaLibraries',
    schema: PersonaLibrarySchema,
    match: fileOrDir('personas'),
  },
  {
    key: 'coverIdentities',
    schema: CoverIdentitySchema,
    match: fileOrDir('cover-identities'),
  },
  {
    key: 'rumourTemplates',
    schema: RumourTemplateSchema,
    match: fileOrDir('rumours'),
  },
  { key: 'hints', schema: HintSchema, match: fileOrDir('hints') },
  {
    key: 'difficultyPresets',
    schema: DifficultyPresetSchema,
    match: fileOrDir('difficulty'),
  },
  { key: 'plotItems', schema: PlotItemSchema, match: fileOrDir('plot-items') },
  // The content-expansion `service` kind (task 1.8). Shared services from an
  // Era Pack and a City Pack's City-Scoped local-security service parse and
  // merge here so a `CityDefinition.services` reference can resolve (Req 19.2).
  { key: 'services', schema: ServiceDefinitionSchema, match: fileOrDir('services') },
  // The content-expansion `template-variant` kind (task 2.2). Era- and
  // city-scoped variants parse and merge here; their templates compile and are
  // slot-checked against their base in step 8 (CE-VARIANT, Req 8.3).
  {
    key: 'templateVariants',
    schema: TemplateVariantSchema,
    match: fileOrDir('template-variants'),
  },
];

/** Files that are not content kinds and never raise an "unknown file" error. */
function isIgnoredFile(relPath: string): boolean {
  // `city.yaml` and the public texts are authored content whose kinds the
  // engine reads through dedicated loaders rather than the merged Content Set;
  // accept their presence without parsing here, and ignore editor/OS cruft.
  // (`glossary.yaml` is parsed into the Content Set by `mergeGlossary`.)
  // `lint.yaml` is a City Pack's Pack-Linter Suppressions file (design,
  // content-kinds table: the `lint` city-pack file); it is read by the
  // content-tools Pack Linter, not by the loader, so the loader accepts its
  // presence without treating it as a content kind.
  return (
    relPath === 'city.yaml' ||
    relPath === 'lint.yaml' ||
    relPath === 'lint.yml' ||
    relPath.startsWith('public-texts/') ||
    relPath === 'public-texts.yaml' ||
    relPath.endsWith('.gitkeep')
  );
}

/**
 * Build the effective Content Kind Registry for a load: the slice kinds, this
 * spec's new kinds and any caller-supplied kinds, de-duplicated by kind name
 * with earlier registrations winning. The slice registrations come first so a
 * slice kind (for example `location-type`) keeps its real schema even though a
 * later task may register a City-Scoped treatment of the same kind name, and
 * so a caller cannot shadow a slice kind by re-registering its name (design,
 * "Content Kind Registry"; Requirement 17.1).
 */
function effectiveRegistry(
  opts: LoadOptions | undefined,
): ContentKindRegistration[] {
  const byKind = new Map<string, ContentKindRegistration>();
  for (const reg of [
    ...SLICE_KIND_REGISTRATIONS,
    ...CONTENT_EXPANSION_KIND_REGISTRATIONS,
    ...(opts?.kinds ?? []),
  ]) {
    if (!byKind.has(reg.kind)) {
      byKind.set(reg.kind, reg);
    }
  }
  return [...byKind.values()];
}

// --- disk + yaml -----------------------------------------------------------

/** One YAML file found in a pack: its pack-relative path and parsed content. */
interface PackFile {
  readonly relPath: string;
  readonly content: unknown;
}

/** List every `.yaml`/`.yml` file under `dir`, recursively, sorted by path. */
function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current).sort();
    for (const name of entries) {
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Normalise an OS path to the `/`-separated form used in rules and errors. */
function toRelPath(packDir: string, fullPath: string): string {
  return relative(packDir, fullPath).split(sep).join('/');
}

// --- step 1: discover + parse manifests ------------------------------------

/** A discovered pack: its directory, manifest and the YAML files beneath it. */
interface DiscoveredPack {
  readonly dir: string;
  readonly manifest: PackManifest;
  readonly files: readonly PackFile[];
}

/**
 * Read, parse and validate `pack.yaml` for every candidate directory, and parse
 * the rest of the pack's YAML files. Returns the discovered packs that parsed;
 * errors for the ones that did not are pushed to the sink.
 */
function discoverPacks(dirs: readonly string[], errors: ErrorSink): DiscoveredPack[] {
  const discovered: DiscoveredPack[] = [];

  for (const dir of dirs) {
    const manifestPath = join(dir, 'pack.yaml');
    let text: string;
    try {
      text = readFileSync(manifestPath, 'utf8');
    } catch (err) {
      errors.push({
        pack: dir,
        file: 'pack.yaml',
        path: '',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const parsed = parseYamlFile(text);
    if (!parsed.ok) {
      errors.push({ pack: dir, file: 'pack.yaml', path: '', message: parsed.message });
      continue;
    }

    const result = PackManifestSchema.safeParse(parsed.value);
    if (!result.success) {
      pushZodErrors(errors, dir, 'pack.yaml', '', result.error);
      continue;
    }
    const manifest = result.data;

    // Check the schema generation before trusting anything else in the pack.
    // Generations 1..CONTENT_SCHEMA_MAX load; a higher generation is refused so
    // a pack authored against a newer vocabulary cannot load half-interpreted
    // (Requirement 1.3, slice Requirement 31.2–31.3).
    if (manifest.contentSchema < 1 || manifest.contentSchema > CONTENT_SCHEMA_MAX) {
      errors.push({
        pack: manifest.id,
        file: 'pack.yaml',
        path: 'contentSchema',
        message: `pack targets content schema ${manifest.contentSchema}, but this build understands schema 1 to ${CONTENT_SCHEMA_MAX}`,
      });
      continue;
    }

    const files = readPackFiles(dir, manifest.id, errors);
    discovered.push({ dir, manifest, files });
  }

  return discovered;
}

/** Parse every non-manifest YAML file under a pack dir. */
function readPackFiles(
  dir: string,
  packId: string,
  errors: ErrorSink,
): PackFile[] {
  const files: PackFile[] = [];
  for (const full of listYamlFiles(dir)) {
    const relPath = toRelPath(dir, full);
    if (relPath === 'pack.yaml') {
      continue;
    }
    const parsed = parseYamlFile(readFileSync(full, 'utf8'));
    if (!parsed.ok) {
      errors.push({ pack: packId, file: relPath, path: '', message: parsed.message });
      continue;
    }
    files.push({ relPath, content: parsed.value });
  }
  return files;
}

type YamlResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

function parseYamlFile(text: string): YamlResult {
  try {
    return { ok: true, value: parseYaml(text) };
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    return { ok: false, message };
  }
}

// --- step 2: resolve requires + topological order --------------------------

/**
 * Order the selected packs so every dependency precedes its dependants, ties
 * broken by pack id. Reports a missing dependency, an incompatible version or a
 * cycle. Returns the ordered packs; on any ordering error it returns the packs
 * it could order (possibly empty) so later steps still surface their own
 * problems where sensible.
 */
function orderPacks(
  packs: readonly DiscoveredPack[],
  selected: readonly string[],
  errors: ErrorSink,
): DiscoveredPack[] {
  const byId = new Map<string, DiscoveredPack>();
  for (const pack of packs) {
    if (byId.has(pack.manifest.id)) {
      errors.push({
        pack: pack.manifest.id,
        file: 'pack.yaml',
        path: 'id',
        message: `two loaded directories both declare pack id "${pack.manifest.id}"`,
      });
      continue;
    }
    byId.set(pack.manifest.id, pack);
  }

  // The transitive closure of the selected packs, so a dependency only present
  // on disk (not selected) still participates in ordering and merging.
  const needed = new Map<string, DiscoveredPack>();
  const visitClosure = (id: string, requestedBy: string | null): void => {
    const pack = byId.get(id);
    if (pack === undefined) {
      errors.push({
        pack: requestedBy ?? id,
        file: 'pack.yaml',
        path: 'requires',
        message:
          requestedBy === null
            ? `selected pack "${id}" was not found in the given directories`
            : `pack "${requestedBy}" requires missing pack "${id}"`,
      });
      return;
    }
    if (needed.has(id)) {
      return;
    }
    needed.set(id, pack);
    for (const req of pack.manifest.requires) {
      visitClosure(req.id, pack.manifest.id);
    }
  };
  for (const id of [...selected].sort()) {
    visitClosure(id, null);
  }

  // Version satisfaction, checked against the resolved pack set.
  for (const pack of needed.values()) {
    for (const req of pack.manifest.requires) {
      const dep = needed.get(req.id) ?? byId.get(req.id);
      if (dep === undefined) {
        continue; // already reported as missing above
      }
      const version = parseVersion(dep.manifest.version);
      const range = parseRange(req.range);
      if (range === null) {
        errors.push({
          pack: pack.manifest.id,
          file: 'pack.yaml',
          path: 'requires',
          message: `cannot parse version range "${req.range}" for dependency "${req.id}"`,
        });
        continue;
      }
      if (version === null || !satisfies(version, range)) {
        errors.push({
          pack: pack.manifest.id,
          file: 'pack.yaml',
          path: 'requires',
          message: `dependency "${req.id}" version ${dep.manifest.version} does not satisfy "${req.range}"`,
        });
      }
    }
  }

  return topoSort([...needed.values()], errors);
}

/** Kahn-style topological sort with ties broken by pack id. */
function topoSort(
  packs: readonly DiscoveredPack[],
  errors: ErrorSink,
): DiscoveredPack[] {
  const present = new Set(packs.map((p) => p.manifest.id));
  // Edges: dependency -> dependant. In-degree counts a pack's own requires that
  // are present in this set.
  const inDegree = new Map<string, number>();
  const dependants = new Map<string, string[]>();
  const byId = new Map(packs.map((p) => [p.manifest.id, p]));

  for (const pack of packs) {
    inDegree.set(pack.manifest.id, 0);
  }
  for (const pack of packs) {
    for (const req of pack.manifest.requires) {
      if (!present.has(req.id)) {
        continue;
      }
      inDegree.set(pack.manifest.id, (inDegree.get(pack.manifest.id) ?? 0) + 1);
      const list = dependants.get(req.id) ?? [];
      list.push(pack.manifest.id);
      dependants.set(req.id, list);
    }
  }

  // Ready set kept sorted so ties resolve by pack id deterministically.
  const ready = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const ordered: DiscoveredPack[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as string;
    const pack = byId.get(id);
    if (pack !== undefined) {
      ordered.push(pack);
    }
    for (const dep of (dependants.get(id) ?? []).sort()) {
      const next = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, next);
      if (next === 0) {
        // Insert keeping `ready` sorted.
        const at = lowerBound(ready, dep);
        ready.splice(at, 0, dep);
      }
    }
  }

  if (ordered.length !== packs.length) {
    const cyclic = packs
      .map((p) => p.manifest.id)
      .filter((id) => !ordered.some((p) => p.manifest.id === id))
      .sort();
    for (const id of cyclic) {
      errors.push({
        pack: id,
        file: 'pack.yaml',
        path: 'requires',
        message: `dependency cycle involving pack "${id}"`,
      });
    }
  }

  return ordered;
}

/** First index in sorted `arr` whose value is >= `value`. */
function lowerBound(arr: readonly string[], value: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// --- step 3 + 4: parse files + merge ---------------------------------------

function emptyRegistries(): Registries {
  return {
    predicates: [],
    archetypes: new Map(),
    locationTypes: new Map(),
    plotTemplates: new Map(),
    sideThreadTemplates: new Map(),
    documentTemplates: new Map(),
    personaLibraries: new Map(),
    coverIdentities: new Map(),
    rumourTemplates: new Map(),
    hints: new Map(),
    glossary: new Map(),
    difficultyPresets: new Map(),
    plotTemplatesV2: new Map(),
    sideThreadTemplatesV2: new Map(),
    plotItems: new Map(),
    properNouns: new Map(),
    services: new Map(),
    templateVariants: new Map(),
    descriptorPools: new Map(),
  };
}

/**
 * A content file's items plus how an item's index is written into an error
 * path. A bare list reports `[i]`, the `{ provenance?, items }` envelope reports
 * `items[i]`, and a single mapping reports no prefix — so a located error points
 * at the real field whichever form the author used (Requirement 16.2).
 */
interface ItemList {
  readonly items: readonly unknown[];
  /** The error-path prefix for the item at `index`, e.g. `items[0]` or ``. */
  readonly pathAt: (index: number) => string;
}

/**
 * Normalise a file into its {@link ItemList}, unwrapping the content-file
 * envelope so a `{ provenance?, items }` file merges exactly as a bare list of
 * `items` would. A malformed envelope (an `items` that is not a list, or an
 * unknown extra key) is reported as a located {@link ContentError} and the
 * file contributes no items.
 */
function toItemList(
  content: unknown,
  pack: string,
  file: string,
  errors: ErrorSink,
): ItemList {
  const normalized = normalizeContentFile(content);
  if (!normalized.ok) {
    pushZodErrors(errors, pack, file, '', normalized.error);
    return { items: [], pathAt: () => '' };
  }
  const envelope = isContentFileEnvelope(content);
  const pathAt = (index: number): string =>
    envelope ? `items[${index}]` : Array.isArray(content) ? `[${index}]` : '';
  return { items: normalized.value.items, pathAt };
}

/**
 * Parse and merge every file of every pack, in load order. Predicates are
 * accumulated as a flat list (their id and field-code uniqueness is enforced
 * by the registry compiler in step 6); the keyed kinds merge into their maps,
 * namespacing ids and honouring `overrides` on a duplicate.
 */
function parseAndMerge(
  ordered: readonly DiscoveredPack[],
  registry: readonly ContentKindRegistration[],
  errors: ErrorSink,
  callerKinds: readonly ContentKindRegistration[] = [],
): Registries {
  const reg = emptyRegistries();

  for (const pack of ordered) {
    const overrides = new Set(pack.manifest.overrides);
    for (const file of pack.files) {
      if (file.relPath === 'predicates.yaml' || file.relPath.startsWith('predicates/')) {
        mergePredicates(reg, pack, file, errors);
        continue;
      }

      if (file.relPath === DESCRIPTOR_FILE) {
        mergeDescriptors(reg, pack, file, errors);
        continue;
      }

      if (file.relPath === 'glossary.yaml' || file.relPath === 'glossary.yml') {
        mergeGlossary(reg, pack, file, errors);
        continue;
      }

      if (file.relPath === 'proper-nouns.yaml' || file.relPath === 'proper-nouns.yml') {
        mergeProperNouns(reg, pack, file, errors);
        continue;
      }

      const rule = KIND_RULES.find((r) => r.match(file.relPath));
      if (rule === undefined) {
        // Ignored files (city.yaml, public texts, lint) are accepted as-is.
        // A caller-registered kind is schema-checked here (ambient-world Req
        // 22.3); the registering package stores the items. Anything else is
        // an unregistered file and is refused (Requirement 17.2).
        if (isIgnoredFile(file.relPath)) {
          continue;
        }
        const caller = callerKinds.find((reg) => fileOrDir(reg.dir)(file.relPath));
        if (caller !== undefined) {
          const list = toItemList(file.content, pack.manifest.id, file.relPath, errors);
          list.items.forEach((item, index) => {
            const parsed = caller.schema.safeParse(item);
            if (!parsed.success) {
              pushZodErrors(errors, pack.manifest.id, file.relPath, list.pathAt(index), parsed.error);
            }
          });
          continue;
        }
        // The core pack ships `campaign/` for the campaign package. Those files
        // are schema-checked when that package registers its kinds. A slice
        // load does not know the kinds, so it leaves the directory unread.
        if (
          file.relPath.startsWith('campaign/') &&
          !callerKinds.some((reg) => reg.dir.startsWith('campaign/'))
        ) {
          continue;
        }
        if (registry.some((reg) => fileOrDir(reg.dir)(file.relPath))) {
          continue;
        }
        errors.push({
          pack: pack.manifest.id,
          file: file.relPath,
          path: '',
          message: `file does not correspond to any registered content kind`,
        });
        continue;
      }

      mergeKeyedKind(reg, pack, file, rule, overrides, errors);
    }
  }

  return reg;
}

function mergePredicates(
  reg: Registries,
  pack: DiscoveredPack,
  file: PackFile,
  errors: ErrorSink,
): void {
  const list = toItemList(file.content, pack.manifest.id, file.relPath, errors);
  const result = PredicateFileSchema.safeParse([...list.items]);
  if (!result.success) {
    pushZodErrors(errors, pack.manifest.id, file.relPath, '', result.error);
    return;
  }
  const overrides = new Set(pack.manifest.overrides);
  for (const definition of result.data) {
    const index = reg.predicates.findIndex((existing) => existing.id === definition.id);
    if (index === -1) {
      reg.predicates.push(definition);
      continue;
    }
    if (overrides.has(definition.id)) {
      reg.predicates[index] = definition;
      continue;
    }
    reg.predicates.push(definition);
  }
}

/**
 * Parse a pack's `descriptors.yaml` (the Descriptor library) and record every
 * pool id it defines, namespaced `<pack>/<poolId>`. A schema violation is a
 * located error; the pool ids feed the archetype → descriptor-pool
 * cross-reference check (Requirement 31.2).
 */
function mergeDescriptors(
  reg: Registries,
  pack: DiscoveredPack,
  file: PackFile,
  errors: ErrorSink,
): void {
  const result = DescriptorDataSchema.safeParse(file.content);
  if (!result.success) {
    pushZodErrors(errors, pack.manifest.id, file.relPath, '', result.error);
    return;
  }
  for (const poolId of descriptorPoolIds(result.data)) {
    reg.descriptorPools.set(`${pack.manifest.id}/${poolId}`, true);
  }
}

/**
 * Parse a pack's `glossary.yaml` (Requirement 26.5) and merge each term into
 * the glossary registry, keyed by its `term`. A glossary entry has no authored
 * `id`, so unlike the keyed kinds it is not namespaced and does not consult
 * `overrides`: a later pack's definition of the same term simply replaces an
 * earlier one, matching load order, so the Help view reads one definition per
 * term. A schema violation is a located {@link ContentError}.
 */
function mergeGlossary(
  reg: Registries,
  pack: DiscoveredPack,
  file: PackFile,
  errors: ErrorSink,
): void {
  const list = toItemList(file.content, pack.manifest.id, file.relPath, errors);
  const result = GlossaryFileSchema.safeParse([...list.items]);
  if (!result.success) {
    pushZodErrors(errors, pack.manifest.id, file.relPath, '', result.error);
    return;
  }
  for (const entry of result.data) {
    reg.glossary.set(entry.term, entry);
  }
}

function mergeProperNouns(
  reg: Registries,
  pack: DiscoveredPack,
  file: PackFile,
  errors: ErrorSink,
): void {
  const result = ProperNounFileSchema.safeParse(file.content);
  if (!result.success) {
    pushZodErrors(errors, pack.manifest.id, file.relPath, '', result.error);
    return;
  }
  reg.properNouns.set(pack.manifest.id, result.data.nouns);
}

function mergeV2Template(
  reg: Registries,
  pack: DiscoveredPack,
  file: PackFile,
  key: 'plotTemplates' | 'sideThreadTemplates',
  basePath: string,
  item: unknown,
  overrides: ReadonlySet<string>,
  errors: ErrorSink,
): void {
  const result = PlotTemplateV2Schema.safeParse(item);
  if (!result.success) {
    pushZodErrors(errors, pack.manifest.id, file.relPath, basePath, result.error);
    return;
  }
  const value = result.data;
  if (key === 'sideThreadTemplates' && value.kind !== 'side-thread') {
    errors.push({
      pack: pack.manifest.id,
      file: file.relPath,
      path: basePath === '' ? 'kind' : `${basePath}.kind`,
      message: 'a side-threads file must declare kind side-thread',
    });
    return;
  }
  if (key === 'plotTemplates' && value.kind !== 'plot') {
    errors.push({
      pack: pack.manifest.id,
      file: file.relPath,
      path: basePath === '' ? 'kind' : `${basePath}.kind`,
      message: 'a plots file must declare kind plot',
    });
    return;
  }
  const namespacedId = `${pack.manifest.id}/${value.id}`;
  const target = key === 'plotTemplates' ? reg.plotTemplatesV2 : reg.sideThreadTemplatesV2;
  const existing = target.get(namespacedId);
  if (existing !== undefined) {
    const allowed = overrides.has(value.id) || overrides.has(namespacedId);
    if (!allowed) {
      errors.push({
        pack: pack.manifest.id,
        file: file.relPath,
        path: basePath === '' ? 'id' : `${basePath}.id`,
        message: `duplicate id "${namespacedId}" (declare it in this pack's "overrides" to redefine it)`,
      });
      return;
    }
  }
  target.set(namespacedId, { value, ownerPack: pack.manifest.id });
}

function mergeKeyedKind(
  reg: Registries,
  pack: DiscoveredPack,
  file: PackFile,
  rule: KindRule,
  overrides: ReadonlySet<string>,
  errors: ErrorSink,
): void {
  const list = toItemList(file.content, pack.manifest.id, file.relPath, errors);
  const target = reg[rule.key] as Map<string, Namespaced<{ id: string }>>;

  list.items.forEach((item, index) => {
    if (
      (rule.key === 'plotTemplates' || rule.key === 'sideThreadTemplates') &&
      isTemplateSchemaV2(item)
    ) {
      if (pack.manifest.contentSchema < 2) {
        const base = list.pathAt(index);
        errors.push({
          pack: pack.manifest.id,
          file: file.relPath,
          path: base === '' ? 'templateSchema' : `${base}.templateSchema`,
          message: 'template schema 2 is only valid when pack.yaml declares contentSchema: 2',
        });
        return;
      }
      mergeV2Template(reg, pack, file, rule.key, list.pathAt(index), item, overrides, errors);
      return;
    }
    const result = rule.schema.safeParse(item);
    if (!result.success) {
      pushZodErrors(errors, pack.manifest.id, file.relPath, list.pathAt(index), result.error);
      return;
    }
    const value = result.data as { id: string };
    const namespacedId = `${pack.manifest.id}/${value.id}`;

    const existing = target.get(namespacedId);
    if (existing !== undefined) {
      // The id is already defined. A redefinition is only legitimate when this
      // pack lists the id — bare `<name>` or fully namespaced `<pack>/<name>` —
      // in its `overrides`; otherwise it is a duplicate-id error (design, load
      // step 4). The later definition wins, matching load order.
      const allowed = overrides.has(value.id) || overrides.has(namespacedId);
      if (!allowed) {
        const base = list.pathAt(index);
        errors.push({
          pack: pack.manifest.id,
          file: file.relPath,
          path: base === '' ? 'id' : `${base}.id`,
          message: `duplicate id "${namespacedId}" (declare it in this pack's "overrides" to redefine it)`,
        });
        return;
      }
    }
    target.set(namespacedId, { value, ownerPack: pack.manifest.id });
  });
}

// --- step 5: cross-references ----------------------------------------------

/**
 * Resolve a content reference the way the loader namespaces ids: a bare `name`
 * is read as `<ownerPack>/<name>`; a `<pack>/<name>` ref is taken as-is. True
 * when the resolved id exists in `registry`.
 */
function refResolves(
  ref: string,
  ownerPack: string,
  registry: ReadonlyMap<string, unknown>,
): boolean {
  const id = ref.includes('/') ? ref : `${ownerPack}/${ref}`;
  return registry.has(id);
}

/** Report a dangling reference. */
function danglingRef(
  errors: ErrorSink,
  pack: string,
  path: string,
  what: string,
  ref: string,
): void {
  errors.push({
    pack,
    file: 'cross-reference',
    path,
    message: `${what} "${ref}" does not resolve to any loaded content`,
  });
}

/**
 * Check the cross-references the design names (load step 5): archetype →
 * persona and descriptor pools, Plot/Side-Thread template → predicates and
 * archetypes, and Rumour template → predicate. Template-slot → declared-slot
 * checking is done by the template engine in step 6 as templates compile.
 *
 * Both an archetype's `personaPools` and its `descriptorPools` must resolve
 * (Requirement 31.2): a persona pool to a loaded Persona library, a descriptor
 * pool to a pool declared in a `descriptors.yaml`. An archetype that names a
 * pool no library defines is now a load error rather than a silent generation
 * fall-back.
 */
function checkCrossReferences(reg: Registries, errors: ErrorSink): void {
  for (const [id, entry] of reg.archetypes) {
    const owner = entry.ownerPack;
    entry.value.personaPools.forEach((pool, i) => {
      if (!refResolves(pool, owner, reg.personaLibraries)) {
        danglingRef(errors, owner, `${id}.personaPools[${i}]`, 'persona pool', pool);
      }
    });
    entry.value.descriptorPools.forEach((pool, i) => {
      if (!refResolves(pool, owner, reg.descriptorPools)) {
        danglingRef(
          errors,
          owner,
          `${id}.descriptorPools[${i}]`,
          'descriptor pool',
          pool,
        );
      }
    });
  }

  const predicateIdSet = new Set(reg.predicates.map((p) => p.id));

  const checkTemplatePredicatesAndArchetypes = (
    kind: 'plotTemplates' | 'sideThreadTemplates',
  ): void => {
    for (const [id, entry] of reg[kind]) {
      const owner = entry.ownerPack;
      const template = entry.value;
      template.roleSlots.forEach((slot, si) => {
        slot.archetypes.forEach((arch, ai) => {
          if (!refResolves(arch, owner, reg.archetypes)) {
            danglingRef(
              errors,
              owner,
              `${id}.roleSlots[${si}].archetypes[${ai}]`,
              'archetype',
              arch,
            );
          }
        });
      });

      // Trace references (task 26.1, Requirement 31.2). Each stage's traces
      // name role, target and materiel *slots* declared on the same template,
      // a Location Type (a cross-pack content ref) and predicate ids. Every one
      // must resolve, or the pack is refused with its pack/file/path.
      const roleIds = new Set(template.roleSlots.map((s) => s.id));
      const targetIds = new Set(template.targetSlots.map((s) => s.id));
      const materielIds = new Set(template.materielSlots.map((s) => s.id));

      template.stages.forEach((stage, sgi) => {
        stage.traces.forEach((trace, ti) => {
          const base = `${id}.stages[${sgi}].traces[${ti}]`;

          trace.roles.forEach((role, ri) => {
            if (!roleIds.has(role)) {
              danglingRef(errors, owner, `${base}.roles[${ri}]`, 'role slot', role);
            }
          });

          if (trace.place !== undefined) {
            if ('target' in trace.place) {
              if (!targetIds.has(trace.place.target)) {
                danglingRef(
                  errors,
                  owner,
                  `${base}.place.target`,
                  'target slot',
                  trace.place.target,
                );
              }
            } else if ('query' in trace.place) {
              // A Tag Query place binds a Location by Effective Tags at
              // generation; the Tag check (step 7) validates each query Tag
              // against the vocabulary, so there is no cross-ref to resolve here.
            } else if (!refResolves(trace.place.locationType, owner, reg.locationTypes)) {
              danglingRef(
                errors,
                owner,
                `${base}.place.locationType`,
                'Location Type',
                trace.place.locationType,
              );
            }
          }

          if (trace.materiel !== undefined && !materielIds.has(trace.materiel)) {
            danglingRef(
              errors,
              owner,
              `${base}.materiel`,
              'materiel slot',
              trace.materiel,
            );
          }

          trace.evidences.forEach((predicate, ei) => {
            if (!predicateIdSet.has(predicate)) {
              danglingRef(
                errors,
                owner,
                `${base}.evidences[${ei}]`,
                'predicate',
                predicate,
              );
            }
          });
        });
      });
    }
  };
  checkTemplatePredicatesAndArchetypes('plotTemplates');
  checkTemplatePredicatesAndArchetypes('sideThreadTemplates');

  const predicateIds = new Set(reg.predicates.map((p) => p.id));
  for (const [id, entry] of reg.rumourTemplates) {
    if (!predicateIds.has(entry.value.predicate)) {
      danglingRef(
        errors,
        entry.ownerPack,
        `${id}.predicate`,
        'predicate',
        entry.value.predicate,
      );
    }
  }

  // Cover Identity → Location Type references.
  for (const [id, entry] of reg.coverIdentities) {
    const owner = entry.ownerPack;
    entry.value.fitLocationTypes.forEach((lt, i) => {
      if (!refResolves(lt, owner, reg.locationTypes)) {
        danglingRef(
          errors,
          owner,
          `${id}.fitLocationTypes[${i}]`,
          'Location Type',
          lt,
        );
      }
    });
  }

  // An archetype schedule no longer carries a Location Type cross-reference:
  // each slot's `at` and the archetype's `fallback` are Tag Queries, checked
  // against the Tag Vocabulary by the Tag check (content-expansion task 1.6,
  // 2.3) rather than resolved as refs here.
}

/**
 * Resolve every `CityDefinition.services` reference against the merged Service
 * Definition registry (content-expansion task 1.8, Req 19.2). A City Pack's
 * `city.yaml` is otherwise read by a dedicated engine loader rather than merged
 * into the Content Set, so this check parses the `city.yaml` of each ordered
 * pack just far enough to validate its `services` list and resolve each id the
 * same way other cross-references resolve (bare `name` as `<pack>/<name>`, a
 * `<pack>/<name>` ref as-is). An unresolved id is a located {@link
 * ContentError} naming the city and the id.
 *
 * A `city.yaml` that fails {@link CityDefinitionSchema} is left to the engine's
 * city loader to report; this check only reads a well-formed city's services so
 * it never double-reports a malformed city here.
 */
function checkCityServiceReferences(
  ordered: readonly DiscoveredPack[],
  reg: Registries,
  errors: ErrorSink,
): void {
  for (const pack of ordered) {
    for (const file of pack.files) {
      if (file.relPath !== 'city.yaml') {
        continue;
      }
      const parsed = CityDefinitionSchema.safeParse(file.content);
      if (!parsed.success) {
        continue; // the engine's city loader reports a malformed city.yaml
      }
      parsed.data.services.forEach((ref, i) => {
        if (!refResolves(ref, pack.manifest.id, reg.services)) {
          danglingRef(
            errors,
            pack.manifest.id,
            `${parsed.data.id}.services[${i}]`,
            'service',
            ref,
          );
        }
      });
    }
  }
}

// --- step 8: compile Template Variants -------------------------------------

/**
 * Namespace a content reference the way the loader does elsewhere: a bare
 * `name` becomes `<ownerPack>/<name>`; a `<pack>/<name>` ref is kept as-is. Used
 * for a variant's `base` and its scope id so they key the same namespaced way
 * the base template and city ids do.
 */
function namespaceRef(ref: string, ownerPack: string): string {
  return ref.includes('/') ? ref : `${ownerPack}/${ref}`;
}

/**
 * Compile every Template Variant and build the Content Set's variant index
 * (content-expansion task 2.2, Req 8.2–8.3).
 *
 * The base templates are the Document templates: a Document's slot set and
 * compiled form are the union of its title pattern and section bodies
 * ({@link documentBaseTemplate}). Each merged variant is turned into a
 * namespaced {@link RawVariant} — its `base` and scope id namespaced against
 * the pack that defined it — and {@link compileTemplateVariants} parses it,
 * resolves its base and compares slot sets. A mismatch (or an unknown base, or
 * an unparsable template) is turned into a located {@link ContentError} under
 * the owning pack, matching how the other cross-reference checks report
 * (`file: 'cross-reference'`, `path: '<variantId>.<field>'`).
 *
 * The returned index always carries every base template, so `resolveTemplate`
 * can fall back to a base even for a variant that was refused.
 */
function compileVariants(
  reg: Registries,
  errors: ErrorSink,
): TemplateVariantIndex {
  const bases = new Map<string, BaseTemplate>();
  for (const [id, entry] of reg.documentTemplates) {
    try {
      bases.set(id, documentBaseTemplate(id, entry.value));
    } catch (err) {
      // A Document template that cannot be parsed is a template error on the
      // document itself; surface it so it is not silently dropped from the
      // base set. (A well-formed slice document never reaches here.)
      errors.push({
        pack: entry.ownerPack,
        file: 'cross-reference',
        path: `${id}.titlePattern`,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const raws: RawVariant[] = [];
  const ownerOf = new Map<string, string>();
  for (const [variantId, entry] of reg.templateVariants) {
    const owner = entry.ownerPack;
    ownerOf.set(variantId, owner);
    const scope: CompiledVariantScope =
      'city' in entry.value.scope
        ? { kind: 'city', id: namespaceRef(entry.value.scope.city, owner) }
        : { kind: 'era', id: namespaceRef(entry.value.scope.era, owner) };
    raws.push({
      variantId,
      base: namespaceRef(entry.value.base, owner),
      scope,
      template: entry.value.template,
    });
  }

  const { index, errors: variantErrors } = compileTemplateVariants(raws, bases);
  for (const err of variantErrors) {
    errors.push({
      pack: ownerOf.get(err.variantId) ?? '',
      file: 'cross-reference',
      path: err.path === '' ? err.variantId : `${err.variantId}.${err.path}`,
      message: err.message,
    });
  }
  return index;
}

// --- step 6 + 7: compile + hash + assemble ---------------------------------

/** Build the manifest entries by hashing each pack's files in path order. */
function buildManifest(ordered: readonly DiscoveredPack[]): ContentManifest {
  const entries: ManifestEntry[] = ordered.map((pack) => ({
    id: pack.manifest.id,
    version: pack.manifest.version,
    hash: hashPack(
      [...pack.files]
        .sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
        .map((f) => ({ path: f.relPath, content: f.content })),
    ),
  }));
  return { schema: CONTENT_SCHEMA_GENERATION, packs: entries };
}

/** Strip the owner-pack bookkeeping, exposing a plain `id -> value` registry. */
function toContentRegistry<T>(
  map: ReadonlyMap<string, Namespaced<T>>,
): ReadonlyMap<string, T> {
  const out = new Map<string, T>();
  for (const [id, entry] of map) {
    out.set(id, entry.value);
  }
  return out;
}

// --- entry point -----------------------------------------------------------

/**
 * Load the selected packs from the given directories into one
 * {@link ContentSet}, or every {@link ContentError} found. Mirrors the design's
 * `ContentLoader.load(dirs, selected)`.
 *
 * @param dirs pack directories to consider. Each should contain a `pack.yaml`.
 * @param selected the ids of the packs to load; their transitive `requires` are
 *   pulled in automatically from `dirs`.
 * @param opts optional load options. `opts.kinds` registers extra content kinds
 *   through the Content Kind Registry, so a follow-on package's kinds load
 *   without `content` importing them (Requirement 17.7).
 */
function checkPlotLibrary(
  reg: Registries,
  vocabulary: ReturnType<typeof buildTagVocabulary>,
  errors: ErrorSink,
): void {
  const templates = new Map<string, PlotTemplateV2>();
  for (const [id, entry] of reg.plotTemplatesV2) {
    templates.set(id, entry.value);
    templates.set(entry.value.id, entry.value);
  }
  for (const [id, entry] of reg.sideThreadTemplatesV2) {
    templates.set(id, entry.value);
    templates.set(entry.value.id, entry.value);
  }
  const itemTagSets = [...reg.plotItems.values()].map((entry) => entry.value.tags);
  const visit = (
    map: Map<string, Namespaced<PlotTemplateV2>>,
    file: string,
  ): void => {
    for (const [id, entry] of map) {
      const found = checkPlotTemplateV2({
        template: entry.value,
        file,
        pack: entry.ownerPack,
        vocabulary: {
          tagAppliesTo: vocabulary.appliesTo,
          requiredQueries: vocabulary.requiredQueries,
        },
        templates,
        itemTagSets,
        packNouns: reg.properNouns.get(entry.ownerPack) ?? [],
      });
      for (const issue of found) {
        errors.push({ ...issue, path: `${id}.${issue.path}` });
      }
    }
  };
  visit(reg.plotTemplatesV2, 'plots');
  visit(reg.sideThreadTemplatesV2, 'side-threads');
}

export function loadContent(
  dirs: readonly string[],
  selected: readonly string[],
  opts?: LoadOptions,
): LoadResult<ContentSet> {
  const errors: ErrorSink = [];

  // The effective Content Kind Registry: slice kinds, this spec's kinds and any
  // caller-supplied kinds. The loader reads it to decide whether a file's kind
  // is registered (Requirement 17.2).
  const registry = effectiveRegistry(opts);

  // Steps 1–2: discover, parse manifests, resolve requires, order.
  const discovered = discoverPacks(dirs, errors);
  const ordered = orderPacks(discovered, selected, errors);

  // Step 4: the Provenance gate (content-expansion task 2.4, Req 16.3–16.4).
  // Refuse any pack directory under the Draft Area and any file whose
  // Provenance Record is generated-but-unreviewed, before the files merge.
  const packsForProvenance: PackForProvenance[] = ordered.map((pack) => ({
    id: pack.manifest.id,
    dir: pack.dir,
    files: pack.files,
  }));
  checkProvenance(packsForProvenance, errors);

  // Step 5: merge the parsed files into the registries (parsing itself ran in
  // discovery). The Provenance gate above (step 4) has already refused any
  // draft-area pack or generated-but-unreviewed file.
  const reg = parseAndMerge(ordered, registry, errors, opts?.kinds ?? []);

  // Step 5: cross-references, plus the city → Service Definition references
  // (task 1.8, Req 19.2).
  checkCrossReferences(reg, errors);
  checkCityServiceReferences(ordered, reg, errors);

  // Step 7: the Tag check (content-expansion task 2.3, Req 4.3–4.4, 4.8). Build
  // the Tag Vocabulary from the ordered packs' `tags.yaml` files, then check
  // every registered kind's `tags`/`tagQueries` fields against it and require a
  // Tag on the kinds of Req 4.3. (Step 6 — the predicate registry — follows;
  // the Tag check reads only the parsed files, so its order among the
  // cross-reference checks is immaterial.)
  const packsForTagCheck: PackForTagCheck[] = ordered.map((pack) => ({
    id: pack.manifest.id,
    files: pack.files,
  }));
  const vocabulary = buildTagVocabulary(packsForTagCheck);
  checkTags(packsForTagCheck, registry, vocabulary, errors);
  checkPlotLibrary(reg, vocabulary, errors);

  // Step 6: compile the predicate registry (templates for other kinds compile
  // in later tasks; predicate renderers compile here and surface template-slot
  // errors against declared slots).
  const compiled = compilePredicateRegistry(reg.predicates);
  if (!compiled.ok) {
    for (const err of compiled.errors) {
      errors.push({
        pack: ownerOfPredicateError(ordered),
        file: err.file,
        path: err.path,
        message: err.message,
      });
    }
  }

  // Step 8: compile Template Variants and slot-check them against their bases
  // (content-expansion task 2.2, Req 8.3). Collected alongside the other errors
  // so an author sees variant mismatches together with the rest.
  const templateVariants = compileVariants(reg, errors);

  // Step 9: Tag Conformance per City Pack (content-expansion task 2.3, Req 4.5,
  // 4.7). Every Required Query the vocabulary guarantees — including any an
  // extension pack added — must have at least `minStatic` static Binders in
  // each loaded City Pack.
  const mergedForConformance: MergedForConformance = {
    locationTypes: reg.locationTypes,
    archetypes: reg.archetypes,
  };
  checkTagConformance(packsForTagCheck, mergedForConformance, vocabulary, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (!compiled.ok) {
    // Unreachable: errors would be non-empty, but keeps the types honest.
    return { ok: false, errors };
  }

  // Step 7: hash each pack and build the manifest.
  const manifest = buildManifest(ordered);

  // Content-expansion additions (task 2.4): fold the City Packs, Era Pack and
  // Library Packs into the merged set and expose the Tag Vocabulary, city-scope
  // ownership and the effective registry. Built from the ordered packs' parsed
  // files, which are all well-formed by now since no errors were collected.
  const packsForBuild: PackForBuild[] = ordered.map((pack) => ({
    manifest: pack.manifest,
    files: pack.files,
  }));
  const additions = buildContentSetAdditions(packsForBuild, registry);

  const value: ContentSet = {
    predicates: compiled.registry,
    archetypes: toContentRegistry(reg.archetypes),
    locationTypes: toContentRegistry(reg.locationTypes),
    plotTemplates: toContentRegistry(reg.plotTemplates),
    sideThreadTemplates: toContentRegistry(reg.sideThreadTemplates),
    plotTemplatesV2: toContentRegistry(reg.plotTemplatesV2),
    sideThreadTemplatesV2: toContentRegistry(reg.sideThreadTemplatesV2),
    plotItems: toContentRegistry(reg.plotItems),
    documentTemplates: toContentRegistry(reg.documentTemplates),
    personaLibraries: toContentRegistry(reg.personaLibraries),
    coverIdentities: toContentRegistry(reg.coverIdentities),
    rumourTemplates: toContentRegistry(reg.rumourTemplates),
    hints: toContentRegistry(reg.hints),
    glossary: reg.glossary,
    difficultyPresets: toContentRegistry(reg.difficultyPresets),
    services: toContentRegistry(reg.services),
    templateVariantDefs: toContentRegistry(reg.templateVariants),
    templateVariants,
    cities: additions.cities,
    ...(additions.era === undefined ? {} : { era: additions.era }),
    cultureGroups: additions.cultureGroups,
    descriptorFragments: additions.descriptorFragments,
    tagVocabulary: additions.tagVocabulary,
    cityScopeOwner: additions.cityScopeOwner,
    registry,
    manifest,
  };

  return { ok: true, value };
}

/**
 * Best-effort attribution of a predicate compile error to a pack. The registry
 * compiler works over a flat, merged definition list and only knows the file
 * name (`predicates.yaml`), so attribute it to the first ordered pack that has
 * a predicates file. The error's file and path still locate it precisely.
 */
function ownerOfPredicateError(ordered: readonly DiscoveredPack[]): string {
  for (const pack of ordered) {
    if (
      pack.files.some(
        (f) => f.relPath === 'predicates.yaml' || f.relPath.startsWith('predicates/'),
      )
    ) {
      return pack.manifest.id;
    }
  }
  return ordered[0]?.manifest.id ?? '';
}
