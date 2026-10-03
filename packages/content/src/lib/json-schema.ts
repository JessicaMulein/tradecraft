/**
 * JSON Schema exports for every content kind.
 *
 * The authoritative definition of each content shape is its Zod schema; this
 * module converts those into JSON Schema (draft 2020-12) so tooling outside the
 * TypeScript world — editor validation of pack YAML, documentation, the
 * `structured()` LLM calls that reuse content shapes — can consume the same
 * contracts without re-describing them. Conversion is via Zod 4's built-in
 * `z.toJSONSchema`, so the JSON Schema can never drift from the Zod source.
 */

import { z } from 'zod';
import { PackManifestSchema } from './pack.js';
import { PredicateDefinitionSchema } from './predicate.js';
import { DifficultyPresetSchema } from './difficulty.js';
import { HintSchema } from './hint.js';
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

/**
 * A JSON Schema document, as produced by `z.toJSONSchema` for a single schema.
 * Derived from the single-schema overload (not the registry overload) by
 * instantiating it against a trivial schema, so the type tracks whatever shape
 * the installed Zod version returns.
 */
export type JsonSchema = ReturnType<typeof z.toJSONSchema<z.ZodType>>;

/**
 * The registry of content-kind Zod schemas, keyed by the kind name used in the
 * design's content-kinds table (plus the pack manifest and predicate
 * definition). Both the JSON Schema map and the exported Zod registry are built
 * from this single source so a new kind is added in exactly one place.
 */
const CONTENT_KIND_SCHEMAS = {
  pack: PackManifestSchema,
  predicate: PredicateDefinitionSchema,
  archetype: ArchetypeSchema,
  'location-type': LocationTypeSchema,
  'plot-template': PlotTemplateSchema,
  'side-thread-template': SideThreadTemplateSchema,
  'document-template': DocumentTemplateSchema,
  'persona-library': PersonaLibrarySchema,
  'cover-identity': CoverIdentitySchema,
  'rumour-template': RumourTemplateSchema,
  hint: HintSchema,
  'difficulty-preset': DifficultyPresetSchema,
} as const;

/** The name of each content kind that exposes a schema. */
export type ContentKindName = keyof typeof CONTENT_KIND_SCHEMAS;

/** Every content-kind name, in a stable order. */
export const CONTENT_KIND_NAMES = Object.keys(
  CONTENT_KIND_SCHEMAS,
) as ContentKindName[];

/** The Zod schema for a content kind, keyed by name. */
export const contentKindSchemas = CONTENT_KIND_SCHEMAS;

/**
 * The JSON Schema for a single content kind. Converted lazily and memoised so a
 * caller that only needs one kind does not pay for the rest.
 */
const jsonSchemaCache = new Map<ContentKindName, JsonSchema>();

export function contentKindJsonSchema(kind: ContentKindName): JsonSchema {
  const cached = jsonSchemaCache.get(kind);
  if (cached !== undefined) {
    return cached;
  }
  const schema = z.toJSONSchema(CONTENT_KIND_SCHEMAS[kind]);
  jsonSchemaCache.set(kind, schema);
  return schema;
}

/** The JSON Schema for every content kind, keyed by name. */
export function contentKindJsonSchemas(): Record<ContentKindName, JsonSchema> {
  const out = {} as Record<ContentKindName, JsonSchema>;
  for (const kind of CONTENT_KIND_NAMES) {
    out[kind] = contentKindJsonSchema(kind);
  }
  return out;
}
