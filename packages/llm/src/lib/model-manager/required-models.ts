/**
 * The distinct Load Identifiers a profile requires (design "Model Manager",
 * "Source resolution (Req 21.7)").
 *
 * A profile maps five roles to Load Identifiers, but several roles share one —
 * the default profiles point `fast`, `narrator` and `bookkeeping` at the same
 * Load Identifier so only one copy is resident. The download check (task 16.3),
 * the preflight estimate and the load path all need the *distinct* Load
 * Identifiers, de-duplicated: the download check resolves each to a Model
 * Source, the estimate sizes each resolved Source once, and the load path loads
 * each under its Load Identifier once (Req 43.4). This helper is that single
 * source of truth so every step agrees on the required set and its order.
 *
 * A role's `model` is a Load Identifier, not a model key: it names an entry in
 * the config's `models` map, which carries the Model Sources to resolve. This
 * helper deliberately returns only the Load Identifiers — the caller threads
 * the `models` map in to resolve each one's Source.
 *
 * Order is first-appearance across {@link MODEL_ROLES}, which gives the
 * download check and the `lms get` block a stable, readable ordering rather
 * than the arbitrary order of a Set built some other way.
 */

import { MODEL_ROLES, type Profile } from '../config/models-config.js';

/**
 * The de-duplicated list of Load Identifiers the profile's roles reference, in
 * the order each first appears across `MODEL_ROLES`.
 */
export function requiredModels(profile: Profile): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of MODEL_ROLES) {
    const { model } = profile[role];
    if (!seen.has(model)) {
      seen.add(model);
      out.push(model);
    }
  }
  return out;
}
