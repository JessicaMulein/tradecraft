/**
 * Template Variant compilation and resolution (content-expansion task 2.2).
 *
 * A Template Variant replaces a base template, scoped to one City Definition or
 * one Era Pack (design, "Locale and Template Variants"). This module is the two
 * halves the design names there:
 *
 * - **Compilation (load-time).** {@link compileTemplateVariants} parses each
 *   variant's `template`, finds its base, and compares the variant's slot set
 *   with the base's. A variant conforms iff its slot set *equals* its base's;
 *   any mismatch is a located {@link import('./pack.js').ContentError} that
 *   lists the missing and extra slots, so the loader refuses to start (Req 8.3,
 *   lint rule CE-VARIANT). The slot set is the one {@link templateSlots}
 *   computes — every `{slot}`, `{slot.attr}` and `{?slot}` name — because a
 *   variant must bind exactly what the base binds for rendering to leave no
 *   slot unresolved (Property 11).
 *
 * - **Resolution (run-time, pure).** {@link resolveTemplate} returns the
 *   compiled template to render for a `(base, city)`: the city-scoped variant
 *   if one exists, else the era-scoped variant, else the base itself (Req 8.2).
 *   It is a pure function of its {@link TemplateVariantIndex}; a per-`(base,
 *   city)` memo makes the design's "resolved once per game and cached" a
 *   transparent optimisation, never an observable change.
 *
 * A base template is addressed by its namespaced id. In the slice the base
 * templates are the Document templates (the newspaper, dossier, cable and
 * public-text kinds the design names): a Document template's slot set and
 * compiled form are the union of its title pattern and section bodies, built by
 * {@link documentBaseTemplate}. Keeping the base source behind the
 * {@link BaseTemplate} shape lets later tasks register other single-template
 * bases (city article and Rumour templates) the same way without touching the
 * compiler or the resolver.
 *
 * The module depends only on the template engine and the kind schemas, so it
 * stays within `content`'s `zod`-and-`yaml` dependency budget.
 */

import {
  parseTemplate,
  templateSlots,
  TemplateParseError,
  type TemplateAst,
} from './template.js';
import type { DocumentTemplate } from './kinds.js';

// --- compiled shapes -------------------------------------------------------

/**
 * A compiled template ready to render: its namespaced id, its parsed AST and
 * the set of slot names it binds. {@link resolveTemplate} returns one of these,
 * so a caller renders the resolved AST and knows the slots it must bind without
 * re-parsing.
 */
export interface CompiledTemplate {
  /** The base template's namespaced id. */
  readonly id: string;
  /** The parsed template to render. */
  readonly ast: TemplateAst;
  /** The slot names the template binds (see {@link templateSlots}). */
  readonly slots: ReadonlySet<string>;
}

/**
 * A base template a variant may replace: its namespaced id, its compiled AST
 * and its slot set. Document templates are turned into these by
 * {@link documentBaseTemplate}; a later task may add other base sources.
 */
export type BaseTemplate = CompiledTemplate;

/**
 * The scope of a compiled variant, normalised to the one id it names and
 * whether that id is a city or an era. Carrying the discriminant keeps the
 * resolver from re-inspecting the original union.
 */
export type CompiledVariantScope =
  | { readonly kind: 'city'; readonly id: string }
  | { readonly kind: 'era'; readonly id: string };

/**
 * A compiled Template Variant: its own id, the base it replaces, its scope, and
 * its compiled AST and slot set. Produced only for variants whose slot set
 * matched their base, so a compiled variant is always safe to resolve to.
 */
export interface CompiledVariant extends CompiledTemplate {
  /** The variant's own namespaced id. */
  readonly variantId: string;
  /** The base template id this variant replaces (`id` holds the same value). */
  readonly base: string;
  readonly scope: CompiledVariantScope;
}

/**
 * The resolved index {@link resolveTemplate} reads: every base template and the
 * compiled variants that passed the slot-set check, keyed by base id. The
 * loader builds one of these and stores it on the Content Set. It is treated as
 * immutable; the resolver only reads it.
 */
export interface TemplateVariantIndex {
  /** Base templates by namespaced id. */
  readonly bases: ReadonlyMap<string, BaseTemplate>;
  /**
   * City-scoped variants, keyed `${base}\u0000${cityId}`. A `(base, city)` pair
   * maps to the city variant that wins for it.
   */
  readonly cityVariants: ReadonlyMap<string, CompiledVariant>;
  /** Era-scoped variants, keyed by base id. One era variant per base. */
  readonly eraVariants: ReadonlyMap<string, CompiledVariant>;
}

// --- base templates --------------------------------------------------------

/**
 * Build the {@link BaseTemplate} for a Document template: its slot set and
 * compiled form are the union of its title pattern and every section body.
 * Rendering a Document fills the title and each section, so a variant that
 * stands in for the whole document must bind exactly the union of their slots.
 * The combined AST joins the title and sections with newlines in authored
 * order, giving a single compiled template whose slot set is that union.
 *
 * `id` is the Document template's namespaced id, so a variant's `base` resolves
 * to it the same way every other reference namespaces (`<pack>/<name>`).
 */
export function documentBaseTemplate(
  id: string,
  doc: DocumentTemplate,
): BaseTemplate {
  const source = [doc.titlePattern, ...doc.sections.map((s) => s.body)].join(
    '\n',
  );
  const ast = parseTemplate(source);
  return { id, ast, slots: templateSlots(ast) };
}

// --- compilation -----------------------------------------------------------

/** The key a city-scoped variant is stored under in the index. */
function cityKey(base: string, city: string): string {
  return `${base}\u0000${city}`;
}

/** Sorted list form of a slot set, for stable error messages. */
function sortedSlots(slots: ReadonlySet<string>): string[] {
  return [...slots].sort();
}

/**
 * A located variant error plus the raw variant it came from, so the loader can
 * attach the pack, file and item path it already tracks. `path` is relative to
 * the variant item (empty for the item itself, `template` for its template).
 */
export interface VariantCompileError {
  /** The variant's namespaced id, for attribution. */
  readonly variantId: string;
  /** The sub-path within the item the error points at (e.g. `template`). */
  readonly path: string;
  readonly message: string;
}

/** The outcome of compiling one pack set's variants. */
export interface VariantCompileResult {
  readonly index: TemplateVariantIndex;
  readonly errors: readonly VariantCompileError[];
}

/**
 * One raw variant to compile: its namespaced id, the namespaced base id it
 * refers to, its scope and its template source. The loader namespaces the ids
 * and resolves the base ref before calling, so this module works in namespaced
 * ids only and never re-implements reference resolution.
 */
export interface RawVariant {
  readonly variantId: string;
  readonly base: string;
  readonly scope: CompiledVariantScope;
  readonly template: string;
}

/**
 * Compile every Template Variant against the base templates (Req 8.3).
 *
 * For each variant, in input order:
 *
 * 1. Parse its template. A parse error is reported on the `template` field.
 * 2. Resolve its base id against `bases`. An unknown base is reported.
 * 3. Compare the variant's slot set with the base's. If they differ, report a
 *    slot mismatch listing the missing slots (in the base but not the variant)
 *    and the extra slots (in the variant but not the base).
 *
 * Only variants that pass all three checks enter the index, so the resolver
 * never returns a non-conforming template. The returned index always carries
 * every base, so `resolveTemplate` falls back to a base even when a bad variant
 * for it was dropped.
 */
export function compileTemplateVariants(
  variants: readonly RawVariant[],
  bases: ReadonlyMap<string, BaseTemplate>,
): VariantCompileResult {
  const errors: VariantCompileError[] = [];
  const cityVariants = new Map<string, CompiledVariant>();
  const eraVariants = new Map<string, CompiledVariant>();

  for (const variant of variants) {
    let ast: TemplateAst;
    try {
      ast = parseTemplate(variant.template);
    } catch (err) {
      if (err instanceof TemplateParseError) {
        errors.push({
          variantId: variant.variantId,
          path: 'template',
          message: err.message,
        });
        continue;
      }
      throw err;
    }

    const base = bases.get(variant.base);
    if (base === undefined) {
      errors.push({
        variantId: variant.variantId,
        path: 'base',
        message: `template variant base "${variant.base}" does not resolve to any loaded base template`,
      });
      continue;
    }

    const slots = templateSlots(ast);
    const missing = sortedSlots(base.slots).filter((s) => !slots.has(s));
    const extra = sortedSlots(slots).filter((s) => !base.slots.has(s));
    if (missing.length > 0 || extra.length > 0) {
      errors.push({
        variantId: variant.variantId,
        path: 'template',
        message:
          `template variant "${variant.variantId}" does not match the slot set of base "${variant.base}"` +
          `: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
      });
      continue;
    }

    const compiled: CompiledVariant = {
      id: variant.base,
      variantId: variant.variantId,
      base: variant.base,
      scope: variant.scope,
      ast,
      slots,
    };
    if (variant.scope.kind === 'city') {
      cityVariants.set(cityKey(variant.base, variant.scope.id), compiled);
    } else {
      eraVariants.set(variant.base, compiled);
    }
  }

  return {
    index: { bases, cityVariants, eraVariants },
    errors,
  };
}

// --- resolution ------------------------------------------------------------

/**
 * The slice of the Content Set the resolver needs: its Template Variant index.
 * Declared structurally so `resolveTemplate` can take the whole `ContentSet`
 * (which carries `templateVariants`) without this module importing it, keeping
 * the dependency one-way (the Content Set imports these types, not vice versa).
 */
export interface HasTemplateVariants {
  readonly templateVariants: TemplateVariantIndex;
}

/**
 * A per-index, per-`(base, city)` memo of resolution results. Keyed by the
 * index object identity so a reload with a fresh index starts a fresh memo and
 * two different Content Sets never share results. Because resolution is a pure
 * function of the index, the memo only ever stores the value the function would
 * recompute, so it is invisible to callers (design: "resolved once per game and
 * cached by `(base, city)`").
 */
const resolutionMemo = new WeakMap<
  TemplateVariantIndex,
  Map<string, CompiledTemplate | undefined>
>();

/**
 * Resolve the template to render for a base in a city (Req 8.2). Returns the
 * city-scoped variant if one exists for `(base, city)`, else the era-scoped
 * variant for the base, else the base template itself. Returns `undefined` only
 * when `base` names no loaded base template.
 *
 * `city` is a City Definition's namespaced id, or `'core'` for the Core City
 * (which has no City Pack and so never has a city variant). Pure: the result is
 * a function of the Content Set's variant index and the two ids; repeated calls
 * return the same value, served from the `(base, city)` memo.
 */
export function resolveTemplate(
  set: HasTemplateVariants,
  base: string,
  city: string,
): CompiledTemplate | undefined {
  const index = set.templateVariants;
  let memo = resolutionMemo.get(index);
  if (memo === undefined) {
    memo = new Map();
    resolutionMemo.set(index, memo);
  }
  const key = cityKey(base, city);
  if (memo.has(key)) {
    return memo.get(key);
  }

  const resolved = resolveUncached(index, base, city);
  memo.set(key, resolved);
  return resolved;
}

/** The resolution itself, before memoisation: city, then era, then base. */
function resolveUncached(
  index: TemplateVariantIndex,
  base: string,
  city: string,
): CompiledTemplate | undefined {
  if (city !== 'core') {
    const cityVariant = index.cityVariants.get(cityKey(base, city));
    if (cityVariant !== undefined) {
      return cityVariant;
    }
  }
  const eraVariant = index.eraVariants.get(base);
  if (eraVariant !== undefined) {
    return eraVariant;
  }
  return index.bases.get(base);
}

/** An empty Template Variant index, for a Content Set with no variants. */
export function emptyTemplateVariantIndex(): TemplateVariantIndex {
  return {
    bases: new Map(),
    cityVariants: new Map(),
    eraVariants: new Map(),
  };
}
