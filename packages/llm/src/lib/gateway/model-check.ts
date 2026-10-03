/**
 * The startup model check (Requirements 14.3, 14.5).
 *
 * When the game starts, the Gateway asks the endpoint which models are loaded
 * and compares that list against the model id each role in the active profile
 * names. Any role whose model the endpoint does not report is a missing role:
 * the game cannot voice that role until the developer loads the model or
 * remaps the profile. This module is the pure comparison; `OpenAIGateway`
 * supplies the live model list from LM Studio.
 */

import { MODEL_ROLES, type Profile, type Role } from '../config/models-config.js';

/** One role whose configured model is not among the endpoint's models. */
export interface MissingRole {
  readonly role: Role;
  /** The model id the profile asked for. */
  readonly model: string;
}

/** The result of comparing a profile against the endpoint's model list. */
export interface ModelCheckResult {
  /** True when every role's model is present on the endpoint. */
  readonly ok: boolean;
  /** The roles whose models are missing, in `MODEL_ROLES` order. */
  readonly missing: readonly MissingRole[];
  /** The distinct model ids the active profile requires, de-duplicated. */
  readonly required: readonly string[];
}

/**
 * Compare the active profile's role models against the models the endpoint
 * reports. Pure: the caller passes the already-fetched list. A model counts as
 * present on an exact id match, since the config stores the id exactly as the
 * endpoint reports it (design "LLM Gateway").
 */
export function checkModels(
  profile: Profile,
  available: readonly string[],
): ModelCheckResult {
  const present = new Set(available);
  const missing: MissingRole[] = [];
  const requiredSet = new Set<string>();

  for (const role of MODEL_ROLES) {
    const { model } = profile[role];
    requiredSet.add(model);
    if (!present.has(model)) {
      missing.push({ role, model });
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    required: [...requiredSet],
  };
}

/**
 * Render a `ModelCheckResult` as one `<role>: <model>` line per missing role,
 * for the startup error the design prints when models are missing. Returns the
 * empty string when nothing is missing.
 */
export function formatMissingRoles(result: ModelCheckResult): string {
  return result.missing
    .map((m) => `${m.role}: ${m.model}`)
    .join('\n');
}
