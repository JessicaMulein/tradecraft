/**
 * The Tag Vocabulary kind (content-expansion task 1.3).
 *
 * A core-pack `tags.yaml` naming the facets, Tags and Required Queries the
 * generator and Tag Conformance read (design, "Tag Vocabulary"; Req 4.1, 4.2).
 * The file is a single record `{ facets, tags, requiredQueries }`:
 *
 * - **Facets** partition the Tag space. Each facet names the content kinds its
 *   Tags may apply to (`appliesTo`), so the loader's Tag check can reject a Tag
 *   used on a kind outside its facet's reach (Req 4.4).
 * - **Tags** are the vocabulary terms. Every Tag id has the form
 *   `<facet>:<value>`, carries a human-readable description and names the kinds
 *   it applies to; absent an explicit `appliesTo`, a Tag inherits its facet's
 *   kinds (Req 4.1).
 * - **Required Queries** are the Tag Queries the vocabulary guarantees. Each
 *   has 1–3 Tags, a minimum static Binder count and a minimum instantiated
 *   Binder count the generator must place in every city (Req 4.2, 4.6).
 *
 * This module only defines the schema and the kind's Field Declarations. The
 * loader stages that read them — checking Tag/Tag Query fields against this
 * vocabulary (task 2.3) and parsing/merging the file into the Content Set
 * (task 2.4) — arrive in task 2.
 */

import { z } from 'zod';

import { ContentIdSchema, TagIdSchema, TagQuerySchema } from '../lib/common.js';
import type { ContentKindRegistration } from '../lib/registry.js';
import { CONTENT_EXPANSION_OWNER } from './stub.js';

/** The lower-case hyphenated name of a Tag facet (the part before the `:`). */
export const FacetIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'a facet id must be lower-case words separated by single hyphens',
  );

/**
 * A facet: a group of Tags and the content kinds those Tags may apply to.
 * `appliesTo` is a non-empty list of registry kind names (for example
 * `location`, `archetype`, `route`); a Tag whose facet does not list a kind may
 * not appear on that kind (Req 4.4).
 */
export const FacetSchema = z
  .object({
    id: FacetIdSchema,
    appliesTo: z
      .array(z.string().min(1))
      .min(1, 'a facet must apply to at least one content kind'),
  })
  .strict();
export type Facet = z.infer<typeof FacetSchema>;

/**
 * A Tag: one vocabulary term of the form `<facet>:<value>` with a description.
 * `appliesTo` optionally narrows the kinds the Tag applies to within its
 * facet's reach; when omitted the Tag inherits its facet's `appliesTo`
 * (Req 4.1). The loader checks that the id's facet prefix names a declared
 * facet and that `appliesTo` is within that facet's kinds (task 2.3).
 */
export const TagSchema = z
  .object({
    id: TagIdSchema,
    description: z.string().min(1, 'a Tag needs a description'),
    appliesTo: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export type Tag = z.infer<typeof TagSchema>;

/**
 * The Tag Query shape used by a Required Query's `query`: 1–3 Tags an item's
 * Effective Tags must all contain to bind (Req 4.2). This is the shared
 * `TagQuerySchema` from `common.js`, re-exported here as the type the Required
 * Query references.
 */
export type TagQuery = z.infer<typeof TagQuerySchema>;

/**
 * A Required Query: a Tag Query the vocabulary guarantees, with a minimum
 * static Binder count (`minStatic`, checked for every City Pack during Tag
 * Conformance, Req 4.5) and a minimum instantiated Binder count
 * (`minInstantiated`, the generator must place at least this many Binders among
 * a city's selected Locations, Req 4.6). `minInstantiated` may be 0 for queries
 * — such as archetype-role queries — that are satisfied from the Content Set as
 * a whole rather than per instantiated city.
 */
export const RequiredQuerySchema = z
  .object({
    id: ContentIdSchema,
    query: TagQuerySchema,
    minStatic: z
      .number()
      .int('minStatic must be a whole number')
      .nonnegative('minStatic must not be negative'),
    minInstantiated: z
      .number()
      .int('minInstantiated must be a whole number')
      .nonnegative('minInstantiated must not be negative'),
  })
  .strict()
  .refine((rq) => rq.minInstantiated <= rq.minStatic, {
    message: 'minInstantiated must not exceed minStatic',
    path: ['minInstantiated'],
  });
export type RequiredQuery = z.infer<typeof RequiredQuerySchema>;

/**
 * The Tag Vocabulary file: the facets, Tags and Required Queries of the loaded
 * packs. A core pack ships the base vocabulary in `tags.yaml`; an extension
 * pack may add facets, Tags and Required Queries, which are then checked
 * against every loaded City Pack (Req 4.7).
 */
export const TagVocabularySchema = z
  .object({
    facets: z.array(FacetSchema).min(1, 'the Tag Vocabulary needs at least one facet'),
    tags: z.array(TagSchema).min(1, 'the Tag Vocabulary needs at least one Tag'),
    requiredQueries: z.array(RequiredQuerySchema).default([]),
  })
  .strict();
export type TagVocabulary = z.infer<typeof TagVocabularySchema>;

/**
 * The Tag Vocabulary content kind. It is not City-Scoped and may be contributed
 * by the core pack or an extension pack (Req 4.7). Its Field Declarations point
 * the loader's Tag Query check at the Required Queries' `query` fields so the
 * vocabulary is validated against itself alongside every other kind (Req 4.8).
 */
export const tagVocabularyKind: ContentKindRegistration<TagVocabulary> = {
  kind: 'tag-vocabulary',
  dir: 'tags',
  schema: TagVocabularySchema,
  roles: ['core', 'extension'],
  cityScoped: false,
  owner: CONTENT_EXPANSION_OWNER,
  fields: {
    tagQueries: ['requiredQueries[].query'],
  },
};
