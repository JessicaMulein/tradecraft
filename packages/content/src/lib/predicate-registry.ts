/**
 * The compiled predicate registry.
 *
 * Task 2.1 defined the predicate *data* shape (`PredicateDefinitionSchema`).
 * This module builds the compiled registry the Sim actually uses: from the
 * loaded, already-validated definitions it derives
 *
 * - the second- and third-person renderers (compiled from each predicate's
 *   render templates), used for NPC prompts and for Fact Lines / Documents;
 * - the field-message codes the Cipher Engine keys encoded messages on;
 * - the truth-evaluation dispatch, which maps each predicate to the built-in
 *   evaluator kind the Truth Store looks up (Requirement 32.3).
 *
 * Compilation also enforces the one cross-predicate rule a single definition
 * cannot: every field-message code must be unique across the set (Requirement
 * 32.2, 32.4). A clash is reported as a {@link PredicateCompileError} rather
 * than thrown, so the pack loader (task 2.4) can attach the pack name and
 * collect it alongside every other problem, reporting the whole picture at
 * once (Requirement 31.2). The error carries the file and field path; the
 * loader adds the `pack` to turn it into a full `ContentError`.
 *
 * The render templates are parsed and checked with the shared template engine
 * (`./template.js`, task 2.2), so predicate renderers obey exactly the same
 * grammar, slot validation and deterministic `render(ast, bindings, namer,
 * rng)` contract as every other piece of Fact text. The registry layers the
 * predicate-specific rule on top: a template may reference `subject` and
 * `object`, and `place` / `when` only when the predicate's place and window
 * rules allow them (Requirement 32.3).
 */

import {
  compileTemplate,
  render as renderTemplate,
  type Namer,
  type TemplateAst,
  type TemplateRng,
} from './template.js';
import {
  EVALUATOR_KINDS,
  type EvaluatorKind,
  type PredicateDefinition,
} from './predicate.js';

export type { Namer } from './template.js';

/** A bound entity argument: its id plus the raw kind the predicate declared. */
export interface EntityBinding {
  readonly kind: 'npc' | 'unk' | 'org' | 'item';
  readonly id: string;
}

/**
 * The values a renderer needs to fill a predicate's template. `subject` and an
 * entity `object` are passed through the {@link Namer}; a literal object is
 * given as already-formatted display text. `place` and `when` are display
 * strings the caller has already rendered from the Proposition, omitted when
 * the Proposition carries none.
 */
export interface RenderBindings {
  readonly subject: EntityBinding;
  /** An entity object is namer-resolved; a literal object is pre-formatted text. */
  readonly object: EntityBinding | { readonly literal: string };
  readonly place?: string;
  readonly when?: string;
  /** The predicate's instrument argument, when it declares one. */
  readonly instrument?: EntityBinding;
}

/** The two perspectives a predicate renders in. */
export type RenderPerspective = 'second' | 'third';

/**
 * A compilation failure, naming the file and the path to the offending field.
 * This is a `ContentError` without its `pack`: the registry compiles a bare set
 * of definitions and does not know which pack they came from, so the loader
 * attaches the `pack` when it merges these with the rest of a pack's errors.
 */
export interface PredicateCompileError {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

/** A compiled predicate: its definition plus the derived, ready-to-use parts. */
export interface CompiledPredicate {
  readonly definition: PredicateDefinition;
  readonly id: string;
  readonly fieldCode: string;
  readonly evaluator: EvaluatorKind;
  /** Render this predicate in the given perspective with the given bindings. */
  render(
    perspective: RenderPerspective,
    bindings: RenderBindings,
    namer: Namer,
  ): string;
}

/**
 * The compiled registry over a predicate set. Lookups are by predicate id; the
 * derived maps (`fieldCodes`, `evaluators`) are exposed for the Cipher Engine
 * and the Truth Store.
 */
export interface PredicateRegistry {
  /** Every compiled predicate, in the order the definitions were given. */
  readonly predicates: readonly CompiledPredicate[];
  /** Look a predicate up by its id (`MEETS_AT`), or `undefined` if absent. */
  get(id: string): CompiledPredicate | undefined;
  /** True when a predicate with this id is defined. */
  has(id: string): boolean;
  /** Predicate id → field-message code, for the Cipher Engine. */
  readonly fieldCodes: ReadonlyMap<string, string>;
  /** Predicate id → evaluator kind, for the Truth Store's dispatch. */
  readonly evaluators: ReadonlyMap<string, EvaluatorKind>;
  /** Render a predicate by id; throws if the id is unknown. */
  render(
    id: string,
    perspective: RenderPerspective,
    bindings: RenderBindings,
    namer: Namer,
  ): string;
}

/** The result of compiling a predicate set: a registry, or the errors found. */
export type CompileResult =
  | { readonly ok: true; readonly registry: PredicateRegistry }
  | { readonly ok: false; readonly errors: readonly PredicateCompileError[] };

const EVALUATOR_SET: ReadonlySet<string> = new Set(EVALUATOR_KINDS);

/**
 * A predicate render never draws a `{pick:…}` — its text is fixed phrasing
 * around slots — so the engine's rng is never consulted. This stub makes that
 * explicit and keeps rendering a pure function of the bindings and namer alone.
 */
const NO_PICK_RNG: TemplateRng = {
  pick() {
    throw new Error('a predicate render template must not use {pick:…}');
  },
};

/**
 * Compile a set of validated predicate definitions into a registry.
 *
 * The definitions are assumed to have passed `PredicateDefinitionSchema`; this
 * step layers the cross-predicate and template checks on top. Errors are
 * collected, not thrown: the returned result is either the registry or every
 * {@link PredicateCompileError} found, each naming the file and the field
 * path, so the loader can merge them with the rest of a pack's problems.
 *
 * @param definitions the predicate definitions to compile.
 * @param file the file the definitions were loaded from, used in error paths.
 */
export function compilePredicateRegistry(
  definitions: readonly PredicateDefinition[],
  file = 'predicates.yaml',
): CompileResult {
  const errors: PredicateCompileError[] = [];
  const seenIds = new Set<string>();
  const fieldCodeOwners = new Map<string, string>();
  const compiled: CompiledPredicate[] = [];

  definitions.forEach((definition, index) => {
    const at = (field: string): string => `[${index}].${field}`;

    // A duplicate id would make `get` ambiguous and silently drop a predicate.
    if (seenIds.has(definition.id)) {
      errors.push({
        file,
        path: at('id'),
        message: `duplicate predicate id "${definition.id}"`,
      });
    }
    seenIds.add(definition.id);

    // Field-message codes must be unique: the Cipher Engine keys encoded
    // messages on them, so a clash would make two predicates indistinguishable
    // on the wire (Requirement 32.2, 32.4).
    const prior = fieldCodeOwners.get(definition.fieldCode);
    if (prior !== undefined && prior !== definition.id) {
      errors.push({
        file,
        path: at('fieldCode'),
        message: `field code "${definition.fieldCode}" is already used by predicate "${prior}"`,
      });
    } else {
      fieldCodeOwners.set(definition.fieldCode, definition.id);
    }

    // The schema already closes the evaluator enum, but guard here too so the
    // Truth Store's dispatch map can never carry an unknown kind.
    if (!EVALUATOR_SET.has(definition.evaluator)) {
      errors.push({
        file,
        path: at('evaluator'),
        message: `unknown evaluator kind "${definition.evaluator}"`,
      });
    }

    const second = compileRenderTemplate(definition, 'second', errors, file, index);
    const third = compileRenderTemplate(definition, 'third', errors, file, index);

    if (second !== undefined && third !== undefined) {
      compiled.push(makeCompiledPredicate(definition, { second, third }));
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, registry: makeRegistry(compiled) };
}

/** Build the registry object around the compiled predicates. */
function makeRegistry(compiled: CompiledPredicate[]): PredicateRegistry {
  const byId = new Map(compiled.map((p) => [p.id, p]));
  const fieldCodes = new Map(compiled.map((p) => [p.id, p.fieldCode]));
  const evaluators = new Map(compiled.map((p) => [p.id, p.evaluator]));

  return {
    predicates: compiled,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    fieldCodes,
    evaluators,
    render(id, perspective, bindings, namer) {
      const predicate = byId.get(id);
      if (predicate === undefined) {
        throw new Error(`no predicate "${id}" in the registry`);
      }
      return predicate.render(perspective, bindings, namer);
    },
  };
}

/** Build one compiled predicate from its definition and parsed templates. */
function makeCompiledPredicate(
  definition: PredicateDefinition,
  asts: { second: TemplateAst; third: TemplateAst },
): CompiledPredicate {
  return {
    definition,
    id: definition.id,
    fieldCode: definition.fieldCode,
    evaluator: definition.evaluator,
    render(perspective, bindings, namer) {
      const ast = perspective === 'second' ? asts.second : asts.third;
      return renderTemplate(ast, toTemplateBindings(bindings), namer, NO_PICK_RNG);
    },
  };
}

/**
 * Parse and validate one render template with the shared template engine,
 * declaring exactly the slots this predicate carries so a template that reaches
 * for a `{place}` the predicate forbids is rejected at compile time. Any
 * failure becomes a {@link PredicateCompileError}; the predicate is dropped
 * from the registry (compilation has already failed), but every other template
 * is still checked so one bad definition does not mask the rest.
 */
function compileRenderTemplate(
  definition: PredicateDefinition,
  perspective: RenderPerspective,
  errors: PredicateCompileError[],
  file: string,
  index: number,
): TemplateAst | undefined {
  const source = definition.render[perspective];
  const path = `[${index}].render.${perspective}`;

  try {
    return compileTemplate(source, { slots: allowedSlots(definition), pools: [] });
  } catch (err) {
    errors.push({
      file,
      path,
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** The slots a predicate's templates may reference, given its place/window rules. */
function allowedSlots(definition: PredicateDefinition): string[] {
  const slots = ['subject', 'object'];
  if (definition.place !== 'none') {
    slots.push('place');
  }
  if (definition.window !== 'none') {
    slots.push('when');
  }
  if (definition.instrument !== undefined) {
    slots.push('instrument');
  }
  return slots;
}

/**
 * Turn the typed render bindings into the engine's slot→value map. Entity
 * arguments are passed through as {@link EntityBinding}s for the namer to
 * stringify; a literal object is passed as its pre-formatted text; `place` and
 * `when` are passed only when present so an optional section renders correctly.
 */
function toTemplateBindings(
  bindings: RenderBindings,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    subject: bindings.subject,
    object:
      'literal' in bindings.object ? bindings.object.literal : bindings.object,
  };
  if (bindings.place !== undefined) {
    out.place = bindings.place;
  }
  if (bindings.when !== undefined) {
    out.when = bindings.when;
  }
  if (bindings.instrument !== undefined) {
    out.instrument = bindings.instrument;
  }
  return out;
}
