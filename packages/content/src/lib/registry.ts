/**
 * The Content Kind Registry (content-expansion task 1.2).
 *
 * The loader's table of content kinds: for each kind, the directory or file
 * stem a pack writes it under, the Zod schema it validates against, the Pack
 * Roles that may contain it, whether it is City-Scoped, and its Field
 * Declarations — the metadata the loader and Pack Linter read to find the
 * kind's text, Tag, Tag Query, Year Range, template, cross-reference and
 * person-name fields (Requirements 17.1, 17.2; design, "Content Kind
 * Registry").
 *
 * `content` registers the slice kinds (here) and this spec's new kinds (the
 * stub modules under `../kinds`). Follow-on packages (ambient-world,
 * plot-library, campaign-career, multi-city) pass their own registrations
 * through {@link LoadOptions.kinds}, so `content` never imports them
 * (Requirement 17.7). A file whose kind is not registered is a load error
 * (Requirement 17.2).
 *
 * This module only declares the registry shape and the slice registrations.
 * The new-kind registrations (`city`, `district`, `location`, `route`, …) are
 * stub modules filled in by tasks 1.3–1.7, each editing only its own file, and
 * are gathered in `../kinds/index.ts`.
 */

import type { z } from 'zod';

import { PACK_ROLES, type PackRole } from './pack.js';
import { DOCUMENT_KINDS } from './kinds.js';
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
import { DifficultyPresetSchema } from './difficulty.js';

/**
 * The Pack Role type and the ordered list of roles are defined with the pack
 * manifest (`./pack.js`), where the manifest schema and `effectivePackRole`
 * live. The registry re-uses them so a kind's `roles` and the manifest's
 * declared `role` draw from one source (design, role rules).
 */
export type { PackRole } from './pack.js';
export { PACK_ROLES } from './pack.js';

/**
 * A dotted/bracketed path into a kind's data, naming the field a Field
 * Declaration points at. `[]` denotes "every element of this list", so
 * `items[].description` names the `description` of every item in a file loaded
 * as `{ items }` and `description` names a top-level field of a single record.
 */
export type JsonPath = string;

/** The document kinds a localisable template may render to. */
export type DocKind = (typeof DOCUMENT_KINDS)[number];

/** The style of a localisable template field, for the Template Variant checks. */
export type TemplateStyle = 'fact-line' | `document:${DocKind}` | 'other';

/** A localisable template field on a kind, with the style it renders in. */
export interface TemplateFieldDeclaration {
  readonly path: JsonPath;
  readonly style: TemplateStyle;
}

/** A cross-reference field on a kind, naming the kind its values point at. */
export interface RefFieldDeclaration {
  readonly path: JsonPath;
  readonly kind: string;
}

/**
 * The declared fields of a content kind (design, "Content Kind Registry"). The
 * loader and Pack Linter walk these paths rather than hard-coding field names,
 * so a new kind becomes lintable the moment it is registered (Requirement
 * 17.1, 13.8).
 *
 * - `text`: prose fields scanned by the anachronism, sensitivity, blocklist and
 *   duplicate Lint Rules.
 * - `tags`: Tag fields; every value must be a vocabulary Tag applicable to this
 *   kind.
 * - `tagQueries`: Tag Query fields; each value is a `TagId[1..3]`.
 * - `years`: Year Range fields.
 * - `templates`: localisable template fields, with the style each renders in.
 * - `refs`: cross-reference fields the loader resolves against another kind.
 * - `names`: person-name fields checked against the Real-Person Blocklist.
 */
export interface FieldDeclarations {
  readonly text?: readonly JsonPath[];
  readonly tags?: readonly JsonPath[];
  readonly tagQueries?: readonly JsonPath[];
  readonly years?: readonly JsonPath[];
  readonly templates?: readonly TemplateFieldDeclaration[];
  readonly refs?: readonly RefFieldDeclaration[];
  readonly names?: readonly JsonPath[];
}

/**
 * One content kind's registration: the loader's row for the kind. `kind` is the
 * registry key and the name used in role rules and error messages; `dir` is the
 * directory or file stem a pack writes the kind under (so `location-type`
 * matches `location-types.yaml` or any file under `location-types/`); `schema`
 * validates each item; `roles` lists the Pack Roles that may contain it;
 * `cityScoped` marks City-Scoped Content; `fields` is its Field Declarations;
 * and `owner` names the registering package for error messages (Requirement
 * 17.1).
 */
export interface ContentKindRegistration<T = unknown> {
  readonly kind: string;
  readonly dir: string;
  readonly schema: z.ZodType<T>;
  readonly roles: readonly PackRole[];
  readonly cityScoped: boolean;
  readonly fields: FieldDeclarations;
  readonly owner: string;
}

/**
 * Extra kinds a caller supplies at load time. Follow-on specs register their
 * content kinds here instead of adding schemas inside `content` (Requirement
 * 17.7). The loader merges them with the kinds `content` registers itself.
 */
export interface LoadOptions {
  readonly kinds?: readonly ContentKindRegistration[];
}

/** The package that owns the slice kinds, for error attribution. */
const SLICE_OWNER = '@tradecraft/content';

/** Every Pack Role may contain the slice kinds the core pack ships. */
const ALL_ROLES: readonly PackRole[] = PACK_ROLES;

/**
 * The slice content kinds, registered with the directory/file stem the loader
 * already matches, their Zod schema, the roles that may contain them and their
 * Field Declarations. These mirror the slice's `KIND_RULES` and the content
 * kinds from the slice content-kinds table; the loader reads this registry to
 * decide whether a file's kind is known (Requirement 17.2).
 *
 * The slice kinds are not City-Scoped — City-Scoped Content arrives with this
 * spec's `city` kinds (task 1.4). Field Declarations capture the text, Tag,
 * Tag Query, template and cross-reference fields each slice kind carries; the
 * `tags` field and its declaration on `archetype`, `location-type` and
 * `cover-identity` are added by task 1.3 (Req 4.3).
 */
export const SLICE_KIND_REGISTRATIONS: readonly ContentKindRegistration[] = [
  {
    kind: 'archetype',
    dir: 'archetypes',
    schema: ArchetypeSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      tags: ['items[].tags[]'],
      // The schedule binds through the Tag Vocabulary (content-expansion task
      // 1.6): each slot's `at` and the archetype's `fallback` are Tag Queries,
      // no longer a Location Type cross-reference.
      tagQueries: ['items[].schedule[].at', 'items[].fallback'],
      refs: [
        { path: 'items[].personaPools[]', kind: 'persona-library' },
        { path: 'items[].descriptorPools[]', kind: 'descriptor-fragment' },
      ],
    },
  },
  {
    kind: 'location-type',
    dir: 'location-types',
    schema: LocationTypeSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      tags: ['items[].tags[]'],
      templates: [
        { path: 'items[].namePatterns[]', style: 'other' },
        { path: 'items[].descriptionPool[]', style: 'other' },
      ],
    },
  },
  {
    kind: 'plot-template',
    dir: 'plots',
    schema: PlotTemplateSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      text: ['items[].stages[].traces[].text'],
      // A trace place may name a Tag Query instead of a Location Type; the Tag
      // check validates each query Tag against the vocabulary (Req 4.8).
      tagQueries: ['items[].stages[].traces[].place.query'],
      templates: [{ path: 'items[].publicTraceArticles[]', style: 'other' }],
      refs: [
        { path: 'items[].roleSlots[].archetypes[]', kind: 'archetype' },
        {
          path: 'items[].stages[].traces[].place.locationType',
          kind: 'location-type',
        },
      ],
    },
  },
  {
    kind: 'side-thread-template',
    dir: 'side-threads',
    schema: SideThreadTemplateSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      text: ['items[].stages[].traces[].text'],
      // A trace place may name a Tag Query instead of a Location Type; the Tag
      // check validates each query Tag against the vocabulary (Req 4.8).
      tagQueries: ['items[].stages[].traces[].place.query'],
      templates: [{ path: 'items[].publicTraceArticles[]', style: 'other' }],
      refs: [
        { path: 'items[].roleSlots[].archetypes[]', kind: 'archetype' },
        {
          path: 'items[].stages[].traces[].place.locationType',
          kind: 'location-type',
        },
      ],
    },
  },
  {
    kind: 'document-template',
    dir: 'documents',
    schema: DocumentTemplateSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      templates: [
        { path: 'items[].titlePattern', style: 'other' },
        { path: 'items[].sections[].body', style: 'other' },
      ],
    },
  },
  {
    kind: 'persona-library',
    dir: 'personas',
    schema: PersonaLibrarySchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      text: ['items[].voiceTraits[]', 'items[].mannerisms[]'],
      templates: [{ path: 'items[].backgrounds[]', style: 'other' }],
    },
  },
  {
    kind: 'cover-identity',
    dir: 'cover-identities',
    schema: CoverIdentitySchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {
      tags: ['items[].tags[]'],
      text: ['items[].title', 'items[].employerOrg'],
      refs: [{ path: 'items[].fitLocationTypes[]', kind: 'location-type' }],
    },
  },
  {
    kind: 'rumour-template',
    dir: 'rumours',
    schema: RumourTemplateSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {},
  },
  {
    kind: 'hint',
    dir: 'hints',
    schema: HintSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {},
  },
  {
    kind: 'difficulty-preset',
    dir: 'difficulty',
    schema: DifficultyPresetSchema,
    roles: ALL_ROLES,
    cityScoped: false,
    owner: SLICE_OWNER,
    fields: {},
  },
];
