/**
 * The {@link ContentSet}: the merged, compiled result of loading one or more
 * Content Packs.
 *
 * The loader (task 2.4) turns a set of pack directories into this one value.
 * Every content kind from the design's content-kinds table lands in a registry
 * keyed by its namespaced id (`<pack>/<name>`), the predicate definitions are
 * compiled into a {@link PredicateRegistry}, and the whole thing is accompanied
 * by the {@link ContentManifest} that pins each pack's id, version and content
 * hash. The world generator and every system downstream read content only
 * through this shape, so it is the single boundary between authored YAML and
 * the running Sim (design, "Content Packs").
 *
 * Each registry is a plain, readonly map from namespaced id to the already
 * validated kind value. Template-bearing fields keep their original strings;
 * the compiled template ASTs they parse into are an engine concern, so the
 * `ContentSet` carries the data shapes and the one cross-cutting compiled
 * artefact the design names here — the predicate registry — and nothing more.
 */

import type { ContentError, ContentManifest } from './pack.js';
import type { PredicateRegistry } from './predicate-registry.js';
import type {
  Archetype,
  CoverIdentity,
  DocumentTemplate,
  LocationType,
  PersonaLibrary,
  PlotTemplate,
  RumourTemplate,
  SideThreadTemplate,
} from './kinds.js';
import type { PlotItem, PlotTemplateV2 } from './plot-v2.js';
import type { Hint } from './hint.js';
import type { GlossaryTerm } from './glossary.js';
import type { DifficultyPreset } from './difficulty.js';
import type { ServiceDefinition } from '../kinds/service.js';
import type { TemplateVariant } from '../kinds/locale.js';
import type { TemplateVariantIndex } from './template-variant.js';
import type { ContentKindRegistration } from './registry.js';
import type { CultureGroup, DescriptorFragment } from '../kinds/library.js';
import type { TagVocabulary } from '../kinds/tag-vocabulary.js';
import type {
  CityBundle,
  CityId,
  CultureGroupId,
  EraBundle,
} from './content-set-build.js';

/**
 * A registry of one content kind, keyed by the namespaced id the loader
 * assigns (`<pack>/<name>`). Readonly so nothing downstream mutates loaded
 * content.
 */
export type ContentRegistry<T> = ReadonlyMap<string, T>;

/**
 * The merged content of a loaded pack set. One registry per content kind, the
 * compiled predicate registry, and the manifest that pins the packs that
 * produced it. Every id is namespaced `<pack>/<name>`.
 */
export interface ContentSet {
  /** Compiled predicate registry (renderers, field codes, evaluators). */
  readonly predicates: PredicateRegistry;
  readonly archetypes: ContentRegistry<Archetype>;
  readonly locationTypes: ContentRegistry<LocationType>;
  readonly plotTemplates: ContentRegistry<PlotTemplate>;
  readonly sideThreadTemplates: ContentRegistry<SideThreadTemplate>;
  /**
   * Template Schema v2 plots and side threads (plot-library). Empty when the
   * loaded packs ship only slice templates. Optional on the type so fixtures
   * built before this field existed still typecheck; the loader always sets it.
   */
  readonly plotTemplatesV2?: ContentRegistry<PlotTemplateV2>;
  readonly sideThreadTemplatesV2?: ContentRegistry<PlotTemplateV2>;
  readonly plotItems?: ContentRegistry<PlotItem>;
  readonly documentTemplates: ContentRegistry<DocumentTemplate>;
  readonly personaLibraries: ContentRegistry<PersonaLibrary>;
  readonly coverIdentities: ContentRegistry<CoverIdentity>;
  readonly rumourTemplates: ContentRegistry<RumourTemplate>;
  readonly hints: ContentRegistry<Hint>;
  /** Glossary terms, keyed by `term`, for the Help view (Requirement 26.5). */
  readonly glossary: ContentRegistry<GlossaryTerm>;
  readonly difficultyPresets: ContentRegistry<DifficultyPreset>;
  /**
   * Service Definitions, keyed by namespaced id (content-expansion task 1.8).
   * Shared services come from the Era Pack; a City Pack's local-security
   * service is City-Scoped. A `CityDefinition.services` entry references an id
   * in this registry (Req 19.2); multi-city and campaign-career key their own
   * records off `ServiceId` (Req 19.4).
   */
  readonly services: ContentRegistry<ServiceDefinition>;
  /**
   * Every Template Variant the pack set defines, keyed by namespaced id
   * (content-expansion task 2.2). Variants are kept as their authored data for
   * inspection and the full `CityBundle` wiring task 2.4 adds; the compiled,
   * slot-checked form the Sim renders through is {@link templateVariants}.
   */
  readonly templateVariantDefs: ContentRegistry<TemplateVariant>;
  /**
   * The compiled Template Variant index (content-expansion task 2.2). Holds the
   * base templates and the variants that passed the slot-set check, so
   * `resolveTemplate(set, base, city)` returns the city variant, else the era
   * variant, else the base, resolved once per `(base, city)` (Req 8.2, 8.3).
   */
  readonly templateVariants: TemplateVariantIndex;
  /**
   * Every loaded City Pack's City-Scoped Content, keyed by namespaced City id
   * (content-expansion task 2.4; design, "Loader pipeline"). The setting step
   * (task 3.8) reads a city's Districts, Locations, Routes, newspapers, orgs,
   * weather, Cover Identities, streets, Locale, Template Variants and Sources
   * through its {@link CityBundle}.
   */
  readonly cities: Readonly<Record<CityId, CityBundle>>;
  /**
   * The loaded Era Pack's Period Window and era Locale (content-expansion task
   * 2.4). Optional: a core-only load (the Core City) ships no Era Pack, so the
   * setting step treats a missing era as an unbounded Period Window.
   */
  readonly era?: EraBundle;
  /**
   * Every Culture Group the Library Packs define, keyed by namespaced id
   * (content-expansion task 2.4). The NPC namer draws a culturally consistent
   * name, voice and background from these (tasks 3.4, 3.5).
   */
  readonly cultureGroups: Readonly<Record<CultureGroupId, CultureGroup>>;
  /**
   * Every Descriptor Fragment the Library Packs define (content-expansion task
   * 2.4). The descriptor generator (task 3.5) filters these by gender, climate
   * and year and assembles unique one-line descriptions.
   */
  readonly descriptorFragments: readonly DescriptorFragment[];
  /**
   * The merged Tag Vocabulary — the union of every pack's `tags.yaml` facets,
   * Tags and Required Queries (content-expansion task 2.4). The generator and
   * the Tag Conformance checks read it; it is empty when no pack ships a
   * vocabulary (a slice-era pack set).
   */
  readonly tagVocabulary: TagVocabulary;
  /**
   * For every City-Scoped id, the City id that owns it (content-expansion task
   * 2.4). The city-scope cross-reference check (task 2.1) and the setting step
   * read this to tell a City Pack's content apart from shared content.
   */
  readonly cityScopeOwner: Readonly<Record<string, CityId>>;
  /**
   * The effective Content Kind Registry used for this load — the slice kinds,
   * this spec's kinds and any caller-supplied kinds (content-expansion task
   * 2.4). Follow-on specs (task 3.8 onward) read it so they can walk any
   * registered kind's Field Declarations without re-deriving the registry.
   */
  readonly registry: readonly ContentKindRegistration[];
  /** The Content Manifest: schema generation plus each pack's id/version/hash. */
  readonly manifest: ContentManifest;
}

/**
 * The outcome of a load: either the merged {@link ContentSet} or every
 * {@link import('./pack.js').ContentError} the loader collected. Mirrors the
 * design's `Result<ContentSet, ContentError[]>`.
 */
export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ContentError[] };
