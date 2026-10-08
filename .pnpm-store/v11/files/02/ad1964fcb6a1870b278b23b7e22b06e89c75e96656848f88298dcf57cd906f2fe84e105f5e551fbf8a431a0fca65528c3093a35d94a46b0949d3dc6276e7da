import type { TargetDefaults } from '@nx/devkit';
import { type MatchedTargetRef } from './target-defaults-matching';
/**
 * Adds the missing `PNPM_INSTALL_SETTINGS_INPUTS` to the layer whose `inputs`
 * array the runtime actually uses for this target: the target's own `inputs`
 * when it declares them (its array replaces the defaults' rather than merging
 * with it), otherwise the matching `targetDefaults` entry supplying the array
 * it inherits, and otherwise the target itself with nx's own default spelled
 * out first, so nothing that was hashed stops being hashed. Sources the
 * effective inputs already hash, including via a whole-file root package.json
 * fileset or a `json` input covering the settings fields, are left alone; no
 * `'...'` is ever authored. Returns which layer was mutated, or null when
 * nothing was missing.
 */
export declare function addPnpmDeployOutputCacheInputs(ref: MatchedTargetRef, targetDefaults: TargetDefaults | undefined, executor: string): 'target' | 'defaults' | null;
/**
 * Variant for a plugin-inferred target, whose generated `inputs` already carry
 * the settings sources (the runtime probe only while the root manifest has no
 * valid pnpm pin): a repair is only needed when an overlay (a project-level
 * target entry, exact or glob key, or a matching `targetDefaults` entry)
 * supplies a replacing `inputs` array that discards them. The repair appends
 * the full set, probe included, because it runs once and the pin can be
 * removed later. The inferred layer is modeled as an array of exactly the
 * settings inputs: enough for the missing check, and it makes an overlay-less
 * target come back as nothing missing, so the fallback that would narrow the
 * plugin's richer array to `DEFAULT_INPUTS` can never be reached: with no
 * replacing supplier there is nothing to mutate.
 */
export declare function addPnpmDeployOutputCacheInputsToInferredTargetOverlay(ref: MatchedTargetRef, targetDefaults: TargetDefaults | undefined): 'target' | 'defaults' | null;
