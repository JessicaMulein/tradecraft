/**
 * The Claim Extraction schema, derived from the loaded predicate definitions
 * (design "Claim Extractor"; Requirements 7.1, 7.2, 32.3).
 *
 * The Claim Extractor is the one model job that turns an NPC's free-text
 * utterance into typed data — a list of Claims the Sim then evaluates. It must
 * never invent a *kind* of fact the game does not know about, so its structured
 * schema is not hand-written: it is generated from the same predicate
 * definitions that drive rendering, encoding and truth evaluation (the
 * design's "the Sim derives … the Claim Extractor schema"). A pack that adds a
 * predicate therefore widens what the extractor can transcribe with no code
 * change (Requirement 32.1).
 *
 * The schema is a Zod discriminated union on `predicate`: one branch per
 * compiled predicate, each constraining `subject` and `object` to exactly the
 * argument kinds that predicate declares, and `place` / `when` to whether the
 * predicate's place and window rules allow them. Entity arguments accept the
 * Entity Registry id grammar plus the sentinel `'unknown'`, so a model that
 * heard a person it cannot pin to an id can still record the Claim (it becomes
 * an Unidentified Subject downstream). Every branch carries a `hedged` flag so
 * the model can mark a Claim the NPC stated tentatively.
 *
 * The whole thing is wrapped in {@link buildExtractionSchema} as an {@link
 * ExtractionResult}: `{ claims: ExtractedClaim[] }`, capped so a runaway reply
 * cannot flood the Case File. The Gateway's `structured` path sends the JSON
 * Schema derived from this and re-validates the reply against it (Requirement
 * 14.4), so the extractor can only ever return claims the Sim recognises;
 * anything else is a schema failure the orchestrator retries then records as an
 * unparsed note (Requirement 7.5).
 *
 * This module is pure schema construction: it reads the predicate registry and
 * returns Zod schemas. It makes no model call and touches no world state.
 */

import type { PredicateDefinition, PredicateRegistry } from '@tradecraft/content';
import { z } from 'zod';

/** The most Claims a single extraction reply may carry (design: `.max(8)`). */
export const MAX_EXTRACTED_CLAIMS = 8;

/**
 * The sentinel an entity argument takes when the model heard a party it cannot
 * tie to an Entity Registry id. Downstream the extractor turns it into an
 * Unidentified Subject rather than dropping the Claim.
 */
export const UNKNOWN_ENTITY = 'unknown';

/** The id-grammar fragments the schema accepts for each entity argument kind. */
const ENTITY_PATTERNS: Readonly<Record<'npc' | 'unk' | 'org', string>> = {
  npc: 'npc:[A-Za-z0-9][A-Za-z0-9_-]*',
  unk: 'unk:(?:0|[1-9][0-9]*)',
  org: 'org:[A-Za-z0-9][A-Za-z0-9_-]*',
};

/**
 * A Zod string schema matching an id in any of the given entity kinds, or the
 * {@link UNKNOWN_ENTITY} sentinel. Built as one anchored alternation so the
 * generated JSON Schema is a single readable `pattern` the endpoint renders
 * cleanly.
 */
function entitySchema(kinds: readonly ('npc' | 'unk' | 'org')[]): z.ZodType<string> {
  const alternatives = [...kinds.map((k) => ENTITY_PATTERNS[k]), UNKNOWN_ENTITY];
  const pattern = new RegExp(`^(?:${alternatives.join('|')})$`);
  return z.string().regex(pattern);
}

/** The schema for a predicate's literal object kind. */
function literalSchema(kind: 'text' | 'amount' | 'time'): z.ZodTypeAny {
  switch (kind) {
    case 'text':
      return z.object({ kind: z.literal('text'), value: z.string() });
    case 'amount':
      return z.object({ kind: z.literal('amount'), value: z.number() });
    case 'time':
      return z.object({
        kind: z.literal('time'),
        value: z.object({
          day: z.int().min(0),
          phase: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        }),
      });
  }
}

/** The schema for a predicate's object argument (entity kinds or a literal). */
function objectSchema(definition: PredicateDefinition): z.ZodTypeAny {
  if ('literal' in definition.object) {
    return literalSchema(definition.object.literal);
  }
  return entitySchema(definition.object.entity);
}

/** A `when` window: a `from` game time, and an optional `to`. */
const GameTimeShape = z.object({
  day: z.int().min(0),
  phase: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
const WindowShape = z.object({ from: GameTimeShape, to: GameTimeShape.optional() });

/** A `place`: a Location id. */
const PlaceShape = z.string().regex(/^loc:[A-Za-z0-9][A-Za-z0-9_-]*$/);

/**
 * Build the Zod branch for one compiled predicate. The branch fixes `predicate`
 * to the predicate's id (the discriminator), constrains `subject` and `object`
 * to the declared kinds, and includes `place` / `when` according to the
 * predicate's place and window rules (`required` → present, `optional` →
 * optional, `none` → absent). Every branch carries `hedged`.
 */
function predicateBranch(definition: PredicateDefinition): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    predicate: z.literal(definition.id),
    subject: entitySchema(definition.subject),
    object: objectSchema(definition),
    hedged: z.boolean(),
  };

  if (definition.place === 'required') {
    shape.place = PlaceShape;
  } else if (definition.place === 'optional') {
    shape.place = PlaceShape.optional();
  }

  if (definition.window === 'required') {
    shape.when = WindowShape;
  } else if (definition.window === 'optional') {
    shape.when = WindowShape.optional();
  }

  // `strict` so a field the predicate does not declare — a `place` on a
  // place:none predicate, say — is rejected rather than silently dropped. The
  // extractor's schema is a contract: a Claim must carry exactly the arguments
  // its predicate allows.
  return z.strictObject(shape);
}

/** One extracted Claim, as the model returns it before the Sim evaluates it. */
export interface ExtractedClaim {
  readonly predicate: string;
  readonly subject: string;
  readonly object: string | { readonly kind: string; readonly value: unknown };
  readonly place?: string;
  readonly when?: { readonly from: unknown; readonly to?: unknown };
  readonly hedged: boolean;
}

/** The structured result of an extraction call: a bounded list of Claims. */
export interface ExtractionResult {
  readonly claims: readonly ExtractedClaim[];
}

/**
 * Build the Claim Extraction schema from a compiled predicate registry
 * (Requirement 32.3). The result is a Zod schema for an {@link
 * ExtractionResult} — `{ claims: ExtractedClaim[] }` with at most {@link
 * MAX_EXTRACTED_CLAIMS} entries — whose `claims` are a discriminated union on
 * `predicate` with one branch per predicate. Pass the registry's compiled
 * predicates straight in; the branches are built in registry order so the
 * generated JSON Schema is stable across runs.
 *
 * A registry with no predicates yields a schema whose `claims` can only be the
 * empty list, which is the correct degenerate behaviour: with no fact
 * vocabulary, nothing is extractable.
 *
 * @param registry the compiled predicate registry to derive branches from.
 * @returns a Zod schema validating an {@link ExtractionResult}.
 */
export function buildExtractionSchema(
  registry: PredicateRegistry,
): z.ZodType<ExtractionResult> {
  const branches = registry.predicates.map((p) => predicateBranch(p.definition));

  const claimSchema =
    branches.length === 0
      ? z.never()
      : branches.length === 1
        ? branches[0]
        : z.discriminatedUnion(
            'predicate',
            branches as unknown as Parameters<typeof z.discriminatedUnion>[1],
          );

  return z.object({
    claims: z.array(claimSchema).max(MAX_EXTRACTED_CLAIMS),
  }) as unknown as z.ZodType<ExtractionResult>;
}
