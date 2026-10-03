/**
 * Shared helper for this spec's content-kind stub modules (content-expansion
 * task 1.2).
 *
 * Tasks 1.3–1.7 each add one new content kind — `city`, `district`,
 * `location`, `era`, `locale`, `template-variant` and so on — and each edits
 * only its own module under `../kinds`. To let those tasks land in parallel,
 * task 1.2 registers every new kind now with a placeholder schema and empty
 * Field Declarations, so the loader already knows the kind (and does not refuse
 * a pack that contains it, Requirement 17.2) before its real schema exists.
 *
 * Each stub module calls {@link defineKindStub} with the kind name, the
 * directory/file stem a pack writes it under, the Pack Roles that may contain
 * it and whether it is City-Scoped. When a later task implements the kind, it
 * replaces the `schema` and `fields` on its own registration in place; the
 * `kind`, `dir`, `roles` and `cityScoped` set here are the contract the role
 * rules and the loader already rely on.
 */

import { z } from 'zod';

import type {
  ContentKindRegistration,
  FieldDeclarations,
  PackRole,
} from '../lib/registry.js';

/** The package that owns this spec's content kinds, for error attribution. */
export const CONTENT_EXPANSION_OWNER = '@tradecraft/content';

/**
 * A placeholder schema for a not-yet-implemented kind. It accepts any value, so
 * the loader can register the kind and recognise its files without yet
 * enforcing a shape; the owning task (1.3–1.7) replaces it with the real Zod
 * schema. It is deliberately permissive rather than `z.never()` so a pack that
 * already carries draft content of the kind loads during development.
 */
export const STUB_SCHEMA: z.ZodType = z.unknown();

/** Build a stub registration for a kind whose schema arrives in a later task. */
export function defineKindStub(args: {
  readonly kind: string;
  readonly dir: string;
  readonly roles: readonly PackRole[];
  readonly cityScoped: boolean;
  readonly fields?: FieldDeclarations;
}): ContentKindRegistration {
  return {
    kind: args.kind,
    dir: args.dir,
    schema: STUB_SCHEMA,
    roles: args.roles,
    cityScoped: args.cityScoped,
    fields: args.fields ?? {},
    owner: CONTENT_EXPANSION_OWNER,
  };
}
