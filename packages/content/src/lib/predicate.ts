/**
 * Predicate definitions.
 *
 * Predicates are the game's fact vocabulary, defined as data so a pack can add
 * a kind of fact that stays renderable, extractable, encodable and checkable
 * without a code change (Requirement 32.1, 32.2). From these definitions the
 * Sim derives the second- and third-person renderers, the Claim Extractor
 * schema, the Cipher Engine's field-message codes and truth evaluation. The one
 * thing a pack cannot add is a new `evaluator` kind — that is the single
 * extension point that needs code (Requirement 32.4).
 */

import { z } from 'zod';
import { ContentIdSchema, TemplateStringSchema } from './common.js';

/**
 * The argument kinds a predicate's subject or object may take. `npc` and `unk`
 * (an Unidentified Subject) are the entity kinds; `org` lets `KNOWS` and
 * `SUSPECTS` take an organisation subject.
 */
export const PREDICATE_ENTITY_KINDS = ['npc', 'unk', 'org', 'loc', 'item', 'evt'] as const;
export const PredicateEntityKindSchema = z.enum(PREDICATE_ENTITY_KINDS);

/** The literal (non-entity) object kinds a predicate may carry. */
export const PREDICATE_LITERAL_KINDS = ['text', 'amount', 'time'] as const;
export const PredicateLiteralKindSchema = z.enum(PREDICATE_LITERAL_KINDS);

/**
 * A predicate's object is either one or more entity kinds, or a single literal
 * kind. The two forms are mutually exclusive, which `.strict()` on each branch
 * enforces.
 */
export const PredicateObjectSchema = z.union([
  z
    .object({
      entity: z
        .array(PredicateEntityKindSchema)
        .min(1, 'an entity object must allow at least one entity kind'),
    })
    .strict(),
  z
    .object({
      literal: PredicateLiteralKindSchema,
    })
    .strict(),
]);
export type PredicateObject = z.infer<typeof PredicateObjectSchema>;

/** Whether a predicate requires, allows or forbids a place argument. */
export const PLACE_RULES = ['required', 'optional', 'none'] as const;
export const PlaceRuleSchema = z.enum(PLACE_RULES);

/** Whether a predicate requires, allows or forbids a time window. */
export const WINDOW_RULES = ['required', 'optional', 'none'] as const;
export const WindowRuleSchema = z.enum(WINDOW_RULES);

/**
 * The built-in truth-evaluation kinds. This set is closed: a predicate that
 * needs a rule outside it needs a code change to add a new kind, which is the
 * only content extension that does (Requirement 32.4).
 *
 * - `fact-match`: a matching fact exists with an overlapping window.
 * - `fact-match-symmetric`: as `fact-match`, but subject and object may swap.
 * - `alias`: checks the Truth Store's identity mapping.
 * - `membership-transitive`: follows `MEMBER_OF` and `REPORTS_TO` chains.
 */
export const EVALUATOR_KINDS = [
  'fact-match',
  'fact-match-symmetric',
  'alias',
  'membership-transitive',
  'custody-chain',
] as const;
export const EvaluatorKindSchema = z.enum(EVALUATOR_KINDS);
export type EvaluatorKind = z.infer<typeof EvaluatorKindSchema>;

/**
 * Which argument an arrest-evidence implication attaches to, and which hostile
 * marks the *other* argument must carry for the implication to hold. Used by
 * the arrest gate (see Arrest Evidence); optional on a predicate.
 */
export const IMPLICATION_ROLES = ['subject', 'object', 'either'] as const;
export const ImplicationRoleSchema = z.enum(IMPLICATION_ROLES);

/** The hostile marks an implication's other argument may be required to carry. */
export const HOSTILE_MARKS = [
  'hostile-org',
  'hostile-person',
  'materiel',
  'hostile-channel',
  'none',
] as const;
export const HostileMarkSchema = z.enum(HOSTILE_MARKS);

export const ImplicationSchema = z
  .object({
    role: ImplicationRoleSchema,
    other: z
      .array(HostileMarkSchema)
      .min(1, 'implication.other must list at least one mark'),
    /**
     * How much one independently confirmed fact of this predicate adds to the
     * case against its target (the arrest gate sums these). Intent is worth
     * more than an association. Defaults to 1.
     */
    weight: z.number().int().min(1).max(5).optional(),
  })
  .strict();
export type Implication = z.infer<typeof ImplicationSchema>;

/** The second- and third-person render templates a predicate must supply. */
export const PredicateRenderSchema = z
  .object({
    second: TemplateStringSchema,
    third: TemplateStringSchema,
  })
  .strict();
export type PredicateRender = z.infer<typeof PredicateRenderSchema>;

/**
 * A single field-message code used by the Cipher Engine. Short upper-case so it
 * reads as a code in an encoded message; uniqueness across a pack set is a
 * cross-pack check the loader runs (Requirement 32.4), not something a single
 * definition can guarantee.
 */
export const FieldCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{1,4}$/, 'fieldCode must be 1–4 upper-case letters or digits');

/**
 * A predicate definition. The id is upper-snake-case by convention
 * (`MEETS_AT`), distinct from the hyphenated content ids, because predicates
 * read as a vocabulary in prompts, Fact Lines and encoded messages.
 */
export const PredicateDefinitionSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
        'a predicate id must be UPPER_SNAKE_CASE',
      ),
    subject: z
      .array(PredicateEntityKindSchema)
      .min(1, 'a predicate must allow at least one subject kind'),
    object: PredicateObjectSchema,
    place: PlaceRuleSchema,
    window: WindowRuleSchema,
    evaluator: EvaluatorKindSchema,
    fieldCode: FieldCodeSchema,
    render: PredicateRenderSchema,
    extractorHint: z
      .string()
      .min(1, 'a predicate needs an extractor description'),
    implication: ImplicationSchema.optional(),
    /**
     * `functional` predicates have at most one object for a subject in any
     * overlapping window. Absent means `multi` (plot-library Req 9.1).
     */
    cardinality: z.enum(['functional', 'multi']).optional(),
    /**
     * An optional third argument (the item a handover carries, for example).
     * Renderers expose it as `{instrument}` (plot-library Req 11.4).
     */
    instrument: z
      .object({
        entity: z
          .array(z.enum(['item', 'npc', 'unk', 'org']))
          .min(1, 'an instrument must allow at least one entity kind'),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PredicateDefinition = z.infer<typeof PredicateDefinitionSchema>;

/** A `predicates.yaml` file is a list of predicate definitions. */
export const PredicateFileSchema = z.array(PredicateDefinitionSchema);

/** Re-exported so cross-pack code can reference the content-id grammar here. */
export { ContentIdSchema };
