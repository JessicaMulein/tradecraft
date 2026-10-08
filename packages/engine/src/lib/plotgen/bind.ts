/**
 * The Binder (plot-library). Parameters are bound in declared order from a
 * city view. Candidates are id-sorted and drawn on the caller's stream.
 * Role slots are not drawn here; {@link bindable} only checks they have an
 * archetype.
 */

import type { PlotTemplateV2, TemplateParam } from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';

export interface BindCity {
  binders(kind: string, query: readonly string[]): readonly string[];
  archetypesWithTags?(query: readonly string[]): readonly string[];
  /** Tags on a bound entity, used to apply a parameter's `exclude` list. */
  tags?(id: string): readonly string[];
}

export type BindingResult =
  | { readonly ok: true; readonly bindings: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly missing: readonly { readonly param: string; readonly query: readonly string[] }[] };

function candidatesFor(
  city: BindCity,
  param: TemplateParam,
  usedInGroup: ReadonlySet<string>,
  query: readonly string[] = param.query,
): string[] {
  const raw = city.binders(param.kind, query);
  return raw
    .filter((id) => !usedInGroup.has(id))
    .filter((id) => {
      if (param.exclude.length === 0 || city.tags === undefined) {
        return true;
      }
      const tags = city.tags(id);
      return !param.exclude.some((tag) => tags.includes(tag));
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Bind every template parameter. A non-mandatory parameter with no candidate
 * is bound through its fallback query. Failure lists each parameter that had
 * no candidate left after the earlier bindings.
 */
export function bind(template: PlotTemplateV2, city: BindCity, rng: Prng): BindingResult {
  const bindings: Record<string, string> = {};
  const missing: { param: string; query: readonly string[] }[] = [];
  const usedByGroup = new Map<string, Set<string>>();

  for (const [name, param] of Object.entries(template.params)) {
    const used = param.group === undefined ? new Set<string>() : (usedByGroup.get(param.group) ?? new Set<string>());
    let pool = candidatesFor(city, param, used);
    let query = param.query;
    if (pool.length === 0 && !param.mandatory && param.fallback !== undefined) {
      query = param.fallback;
      pool = candidatesFor(city, param, used, param.fallback);
    }
    if (pool.length === 0) {
      missing.push({ param: name, query });
      continue;
    }
    const chosen = rng.pick(pool);
    bindings[name] = chosen;
    if (param.group !== undefined) {
      const set = usedByGroup.get(param.group) ?? new Set<string>();
      set.add(chosen);
      usedByGroup.set(param.group, set);
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, bindings };
}

/**
 * Draw-free eligibility: every mandatory parameter and role slot has at least
 * one candidate, and a greedy pass can assign distinct entities inside each
 * distinctness group.
 */
export function bindable(
  template: PlotTemplateV2,
  city: BindCity,
): { readonly ok: true } | { readonly ok: false; readonly missing: readonly { readonly param: string; readonly query: readonly string[] }[] } {
  const missing: { param: string; query: readonly string[] }[] = [];
  const usedByGroup = new Map<string, Set<string>>();
  for (const [name, param] of Object.entries(template.params)) {
    const used = param.group === undefined ? new Set<string>() : (usedByGroup.get(param.group) ?? new Set<string>());
    let pool = candidatesFor(city, param, used);
    let query: readonly string[] = param.query;
    if (pool.length === 0 && !param.mandatory && param.fallback !== undefined) {
      query = param.fallback;
      pool = candidatesFor(city, param, used, param.fallback);
    }
    if (pool.length === 0) {
      if (param.mandatory || param.fallback !== undefined) {
        missing.push({ param: name, query });
      }
      continue;
    }
    const chosen = pool[0];
    if (chosen !== undefined && param.group !== undefined) {
      const set = usedByGroup.get(param.group) ?? new Set<string>();
      set.add(chosen);
      usedByGroup.set(param.group, set);
    }
  }
  if (city.archetypesWithTags !== undefined) {
    for (const [name, slot] of Object.entries(template.roleSlots)) {
      if (!slot.mandatory) {
        continue;
      }
      if (city.archetypesWithTags(slot.query).length === 0) {
        missing.push({ param: name, query: slot.query });
      }
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
