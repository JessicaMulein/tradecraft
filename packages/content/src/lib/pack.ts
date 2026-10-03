/**
 * The pack manifest (`pack.yaml`) and the loader-facing types.
 *
 * A pack is a directory of typed YAML files headed by this manifest. The loader
 * reads it first to learn the pack's id, version, which schema generation it
 * was authored against, its dependencies and the ids it is allowed to redefine
 * (Requirements 31.1, 31.3, 31.4). The loader itself lands in task 2.4; this
 * file fixes the shape it parses and the error and manifest records it emits.
 */

import { z } from 'zod';
import {
  ContentIdSchema,
  ContentRefSchema,
  SemverRangeSchema,
  SemverSchema,
} from './common.js';

/**
 * The highest schema generation this build understands. The loader accepts a
 * pack declaring any generation from 1 up to this value and rejects anything
 * higher, so a pack authored against a newer vocabulary cannot load
 * half-interpreted (slice Requirement 31.3, Requirement 1.3). Generation 2
 * adds Pack Roles, the content-file envelope and this spec's content kinds;
 * generation-1 packs keep loading unchanged.
 */
export const CONTENT_SCHEMA_MAX = 2;

/**
 * The schema generation stamped into the Content Manifest. This is part of the
 * generator's determinism contract and travels into saves and recordings
 * (slice Requirement 31.5), so it is held fixed here rather than tracking
 * {@link CONTENT_SCHEMA_MAX}: accepting generation-2 packs must not change the
 * manifest of an otherwise unchanged generation-1 pack set. A future task that
 * bumps the determinism contract (the shared `generatorVersion` bump) may raise
 * it alongside re-recording the golden replays.
 */
export const CONTENT_SCHEMA_GENERATION = 1;

/**
 * The role a pack declares (Requirement 1.1). `core` ships the slice kinds and
 * the Tag Vocabulary; `era`, `city` and `library` carry the period, city and
 * persona content this spec adds; `extension` carries kinds that follow-on
 * specs register through the Content Kind Registry.
 */
export const PACK_ROLES = ['core', 'era', 'city', 'library', 'extension'] as const;
export const PackRoleSchema = z.enum(PACK_ROLES);
export type PackRole = z.infer<typeof PackRoleSchema>;

/** A declared dependency on another pack and the version range it needs. */
export const PackRequirementSchema = z
  .object({
    id: ContentIdSchema,
    range: SemverRangeSchema,
  })
  .strict();
export type PackRequirement = z.infer<typeof PackRequirementSchema>;

/**
 * `pack.yaml`. `requires` drives dependency ordering; `overrides` lists the
 * ids this pack may legitimately redefine so an intentional override is not
 * mistaken for a duplicate-id error (Requirement 31.4).
 */
export const PackManifestSchema = z
  .object({
    id: ContentIdSchema,
    version: SemverSchema,
    contentSchema: z
      .number()
      .int('contentSchema must be an integer')
      .positive('contentSchema must be positive'),
    /**
     * The pack's declared role (Requirement 1.1). Optional in the manifest so a
     * legacy schema-1 pack with no `role` still parses; the loader treats such
     * a pack as `core` (Requirement 1.2) via {@link effectivePackRole}.
     */
    role: PackRoleSchema.optional(),
    requires: z.array(PackRequirementSchema).default([]),
    overrides: z.array(ContentRefSchema).default([]),
  })
  .strict();
export type PackManifest = z.infer<typeof PackManifestSchema>;

/**
 * The role the loader treats a pack as having. A pack that declares a `role`
 * uses it; a schema-1 pack that declares none is `core` (Requirement 1.2). A
 * schema-2 pack is expected to declare its role; the role-to-kind rules that
 * enforce this land with task 1.2.
 */
export function effectivePackRole(manifest: PackManifest): PackRole {
  return manifest.role ?? 'core';
}

/**
 * A single validation or cross-reference failure. The loader collects every
 * error rather than stopping at the first so an author sees the whole picture
 * (Requirement 31.2). Each one names the pack, the file within it and the path
 * to the offending field.
 */
export const ContentErrorSchema = z
  .object({
    pack: z.string(),
    file: z.string(),
    path: z.string(),
    message: z.string(),
  })
  .strict();
export type ContentError = z.infer<typeof ContentErrorSchema>;

/** One pack's identity and content hash as recorded in the manifest. */
export const ManifestEntrySchema = z
  .object({
    id: ContentIdSchema,
    version: SemverSchema,
    hash: z.string(),
  })
  .strict();
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * The Content Manifest: the schema generation plus every loaded pack's id,
 * version and hash. It travels into saves, recordings and Outcome Records and
 * is part of the generator's determinism contract (Requirement 31.5).
 */
export const ContentManifestSchema = z
  .object({
    schema: z.number().int(),
    packs: z.array(ManifestEntrySchema),
  })
  .strict();
export type ContentManifest = z.infer<typeof ContentManifestSchema>;
