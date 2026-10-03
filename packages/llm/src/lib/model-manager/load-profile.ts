/**
 * Explicit profile load/unload (Requirements 43.4, 43.5, 43.6, 43.7; design
 * "Model Manager", steps 4–6).
 *
 * The preflight (`./preflight.ts`) connects, checks downloads and sizes the
 * resident set but loads nothing. This module is the step that follows a passing
 * preflight: it makes a profile's models resident under stable identifiers and,
 * conversely, tears them down so the eval harness (Requirement 18, task 23.4)
 * can switch profiles between runs with `unloadProfile(old)` then
 * `loadProfile(new)`.
 *
 * Four properties the design calls for are enforced here, over the pure
 * {@link LmStudioClient} surface so the whole path is testable offline:
 *
 *   - **Load each distinct model once.** A profile maps five roles to models,
 *     but the defaults point `fast`/`narrator`/`bookkeeping` at one model;
 *     loading it per-role would double (triple) its weights in memory. We load
 *     the de-duplicated set (`requiredModels`), so a model serving two roles is
 *     loaded exactly once (Requirement 43.4).
 *   - **Stable identifier + context length.** Each model is loaded under its
 *     Load Identifier as the `identifier` — the same string the Gateway sends
 *     to the OpenAI endpoint — while the *build* loaded is the resolved Model
 *     Source's `key` (the MLX build when downloaded, else GGUF), so a build/quant
 *     swap never touches config or the Gateway and inference stays on the
 *     portable endpoint (Requirements 43.7, 21.7). The context length is passed
 *     in (the config carries none here), sizing the KV cache (Requirement 43.4).
 *   - **Keep resident while the game runs.** Every load sets `keepResident` so
 *     an explicitly loaded model is not idle-unloaded or auto-evicted mid-session
 *     (Requirement 43.6).
 *   - **Verify GPU residency.** After loading, the SDK's loaded-model listing is
 *     read and any model only *partially* on the GPU is reported by identifier,
 *     both as a `partialGpu` entry and a human-readable warning (Requirement
 *     43.5). A partial load still runs — just far slower — so this warns rather
 *     than fails.
 *
 * No inference happens here. Loading, listing and unloading are all management
 * calls on the SDK; running the models is the Gateway's job over the OpenAI
 * endpoint (Requirement 43.7).
 */

import type { Profile } from '../config/models-config.js';
import type { LmStudioClient } from './client-interface.js';
import { resolveSource, type ModelMap } from './download-check.js';
import { requiredModels } from './required-models.js';

/**
 * The outcome of loading a profile (design "Model Manager", step 5). `loaded`
 * is the distinct identifiers made resident, in load order; `partialGpu` is the
 * subset that came up only partially GPU-resident; `warnings` is the
 * human-readable form of each partial-residency finding, naming the model by
 * identifier (Requirement 43.5). A clean load has an empty `partialGpu` and no
 * `warnings`.
 *
 * `partialGpu` mirrors the `PreflightResult.partialGpu` slot (which `preflight`
 * leaves empty because it loads nothing): the startup path reads the slot off
 * whichever result its stage produced — the post-load residency finding lives
 * on *this* result because that is the stage that actually loaded.
 */
export interface LoadProfileResult {
  /** The distinct model identifiers made resident, in load order. */
  readonly loaded: readonly string[];
  /** Identifiers that came up only partially GPU-resident. */
  readonly partialGpu: readonly string[];
  /** One warning per partial-residency finding, naming the identifier. */
  readonly warnings: readonly string[];
}

/** Options for {@link loadProfile}. */
export interface LoadProfileOptions {
  /**
   * The context length to load every model at, in tokens. Sizes the KV cache
   * (Requirement 43.4), matching how `preflight` takes it as an option. It is an
   * internal param of the Model Manager: {@link startModelManager} reads
   * `config.contextLength` and threads it in, so no caller outside the manager
   * supplies it (design "Context Length").
   */
  readonly contextLength: number;
}

/**
 * Human-readable warning for a model that came up only partially on the GPU.
 * Named by identifier (Requirement 43.5) so an operator can match it to a
 * `models.yaml` role.
 */
function partialGpuWarning(identifier: string): string {
  return `model "${identifier}" is only partially GPU-resident — it will run far slower; free GPU memory or lower the context length`;
}

/**
 * Load the profile's distinct models and verify GPU residency.
 *
 * Sequence:
 *   1. De-duplicate the profile's Load Identifiers (`requiredModels`), so a
 *      Load Identifier serving two roles is loaded once.
 *   2. Resolve each Load Identifier's Model Source against the downloaded set
 *      (the MLX build when downloaded, else GGUF) and load that Source's `key`
 *      under the Load Identifier as the stable `identifier`, at `contextLength`,
 *      with `keepResident` set so it is not idle-unloaded mid-session
 *      (Requirements 43.4, 43.6, 43.7, 21.7). A Load Identifier already loaded
 *      is skipped, so a re-`loadProfile` (or a shared one) never double-loads.
 *   3. Read the loaded-model listing and collect every model that is not fully
 *      GPU-resident into `partialGpu`, with a warning naming it (Requirement
 *      43.5).
 *
 * The listing is read once, after all loads, and residency is matched by
 * identifier against the distinct set this call loaded, so an unrelated model a
 * prior profile left resident does not generate a spurious warning.
 *
 * @param profile the profile whose Load Identifiers to make resident
 * @param models  the config's `models` map, to resolve each Load Identifier
 * @param client  an already-connected management client
 * @param options the context length to load at
 */
export async function loadProfile(
  profile: Profile,
  models: ModelMap,
  client: LmStudioClient,
  options: LoadProfileOptions,
): Promise<LoadProfileResult> {
  const required = requiredModels(profile);

  // Resolve each Load Identifier's Model Source against what is downloaded, so
  // the build loaded is the MLX one when present and GGUF otherwise (Req 21.7).
  const downloaded = new Set(
    (await client.listDownloadedModels()).map((m) => m.modelKey),
  );

  // Which identifiers are already resident — loading one twice would double its
  // weights, so a shared Load Identifier or a re-load is idempotent (Req 43.4).
  const alreadyLoaded = new Set(
    (await client.listLoaded()).map((m) => m.identifier),
  );

  const loaded: string[] = [];
  for (const identifier of required) {
    if (!alreadyLoaded.has(identifier)) {
      const entry = models[identifier];
      const resolution =
        entry === undefined ? undefined : resolveSource(entry, downloaded);
      // The schema guarantees the entry exists and the preflight already
      // refused an unresolved Load Identifier, so by here a Source resolves;
      // fall back to the preferred build's key defensively if not.
      const modelKey =
        resolution !== undefined && resolution.ok
          ? resolution.source.key
          : (entry?.sources[0].key ?? identifier);
      // Load the Source's `key`, under the Load Identifier (Req 43.7, 21.7).
      await client.loadModel(modelKey, {
        identifier,
        contextLength: options.contextLength,
        keepResident: true,
      });
      alreadyLoaded.add(identifier);
    }
    loaded.push(identifier);
  }

  // Verify GPU residency after loading (Requirement 43.5). Match by identifier
  // against the set we loaded so a leftover model from another profile is
  // ignored. A model missing from the listing is treated as not-fully-resident.
  const residency = new Map(
    (await client.listLoaded()).map((m) => [m.identifier, m.gpuResident]),
  );
  const partialGpu: string[] = [];
  const warnings: string[] = [];
  for (const identifier of loaded) {
    if (residency.get(identifier) !== true) {
      partialGpu.push(identifier);
      warnings.push(partialGpuWarning(identifier));
    }
  }

  return { loaded, partialGpu, warnings };
}

/**
 * Unload the profile's distinct Load Identifiers (Requirement 43.6).
 *
 * Unloads by Load Identifier — the stable `identifier` each model was loaded
 * under — and needs no `models` map, since the Source only mattered at load
 * time. De-duplicates the same way `loadProfile` does, so a Load Identifier
 * that backed two roles — and was therefore loaded once — is unloaded exactly
 * once. Together
 * with {@link loadProfile}, this is how the eval harness switches profiles
 * between runs: `unloadProfile(old)` then `loadProfile(new)`.
 *
 * @returns the distinct identifiers that were unloaded, in order.
 */
export async function unloadProfile(
  profile: Profile,
  client: LmStudioClient,
): Promise<readonly string[]> {
  const required = requiredModels(profile);
  const unloaded: string[] = [];
  for (const identifier of required) {
    await client.unloadModel(identifier);
    unloaded.push(identifier);
  }
  return unloaded;
}
