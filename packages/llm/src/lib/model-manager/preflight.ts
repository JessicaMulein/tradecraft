/**
 * The Model Manager's startup preflight (Requirements 43.3, 43.8; design "Model
 * Manager").
 *
 * The preflight runs before the first model call and, like config validation,
 * refuses to start on failure and reports the cause (Requirement 43.8,
 * consistent with Requirement 41.2). It composes the three management checks:
 *
 *   1. Connect to LM Studio (the server is started and the connection retried
 *      by `./connect.ts`). A connected {@link LmStudioClient} is passed in here,
 *      so a connection that already failed is reported by the caller as the
 *      first cause and `preflight` is not reached; this keeps `preflight` a pure
 *      composition over an *already-connected* client, matching how
 *      `connectWithRetry` is shaped (it returns the client or throws).
 *   2. Check downloads — compare the profile's Load Identifiers against the
 *      SDK's downloaded set, resolving each to its Model Source; a Load
 *      Identifier with neither MLX nor GGUF build downloaded is reported with
 *      its preferred-source `lms get` command and never pulled
 *      (`./download-check.ts`).
 *   3. Estimate memory — size the resident set over the *resolved* Source keys
 *      at the configured context length and refuse an over-budget profile with
 *      its shortfall (`./estimate-check.ts`), loading nothing.
 *
 * Crucially, the preflight does NOT stop at the first failing check. Like config
 * validation reporting every field issue at once (Requirement 41.2), it runs
 * every check it can and collects *all* causes, so an operator whose profile is
 * both missing a model and over budget sees both at once rather than fixing one
 * only to hit the next on the next launch. The estimate is sized over the
 * profile's full required set regardless of what is downloaded, so the memory
 * cause is reported even alongside a download cause; when a model is absent the
 * download cause already blocks startup.
 *
 * The result is the design's {@link PreflightResult}: a boolean `ok`, the
 * missing model keys, the estimated and available byte figures, a `partialGpu`
 * slot the post-load residency check (task 25.3) fills, and a flat list of
 * human-readable `issues` the startup path (task 25.4) prints when it refuses to
 * start. No inference is performed and no model is loaded here.
 */

import type { Profile } from '../config/models-config.js';
import type { LmStudioClient, ResidentSetEstimate } from './client-interface.js';
import {
  checkDownloads,
  formatMissingDownloads,
  resolveSource,
  type ModelMap,
} from './download-check.js';
import { checkEstimate, formatMemoryShortfall } from './estimate-check.js';
import { requiredModels } from './required-models.js';

/**
 * The preflight outcome (design "Model Manager"). `ok` is true only when every
 * check passed. `missing` lists model keys to `lms get`; `estimatedBytes` and
 * `fitsBytes` are the resident-set estimate and the available budget;
 * `partialGpu` is populated only by the post-load residency check (task 25.3)
 * and is empty here; `issues` carries every failing cause as a human-readable
 * line, reported the way config errors are (Requirement 41.2).
 */
export interface PreflightResult {
  /** True iff downloads are present and the resident set fits. */
  readonly ok: boolean;
  /** Model keys the profile needs that are not downloaded (`lms get` these). */
  readonly missing: readonly string[];
  /** Estimated memory the resident set needs at the context length, in bytes. */
  readonly estimatedBytes: number;
  /** Memory available to make the set resident, in bytes. */
  readonly fitsBytes: number;
  /**
   * Identifiers not fully GPU-resident. Always empty from `preflight` (which
   * loads nothing); filled by the post-load residency check (task 25.3).
   */
  readonly partialGpu: readonly string[];
  /** Every failing cause, human-readable, as config errors are reported. */
  readonly issues: readonly string[];
}

/** Options for the preflight composition. */
export interface PreflightOptions {
  /**
   * The context length the models will be loaded at, in tokens. Threaded into
   * the memory estimate because the KV cache scales with it (Requirement 43.3).
   *
   * `RoleConfig`/`Profile` in `models.yaml` carry sampling and timeout settings
   * but no context-length field, so the context length is supplied here rather
   * than read off the profile. It is an internal param of the Model Manager:
   * {@link startModelManager} reads `config.contextLength` and threads it in, so
   * no caller outside the manager supplies it (design "Context Length"). The
   * project targets ≈ 8K for the slice's ~3K-token prompts (design "Model
   * Manager", step 4).
   */
  readonly contextLength: number;
}

/**
 * Run the download and estimate checks against an already-connected client and
 * compose a {@link PreflightResult} reporting every failing cause at once.
 *
 * Sequence:
 *   1. List the downloaded models through the client (the one management call
 *      the client makes here).
 *   2. Check downloads; collect each missing model's `lms get` line as an issue.
 *   3. Estimate the resident set at `contextLength` and check the fit; on a
 *      shortfall collect the shortfall line as an issue. Nothing is loaded.
 *   4. `ok` is true only when both checks pass; `issues` holds every cause.
 *
 * The client is already connected (step 1 of the preflight, `connectWithRetry`,
 * ran before this), so a connection failure is surfaced by the caller as its
 * own cause and never reaches here.
 *
 * @param profile the active profile whose Load Identifiers are checked
 * @param models  the config's `models` map, to resolve each Load Identifier
 * @param client  an already-connected management client
 * @param options the context length to size the estimate at
 */
export async function preflight(
  profile: Profile,
  models: ModelMap,
  client: LmStudioClient,
  options: PreflightOptions,
): Promise<PreflightResult> {
  const required = requiredModels(profile);
  const issues: string[] = [];

  // 1–2. Downloads: resolve each Load Identifier's Model Source against the
  // downloaded set; a Load Identifier with neither build downloaded is a cause.
  const downloaded = (await client.listDownloadedModels()).map(
    (m) => m.modelKey,
  );
  const present = new Set(downloaded);
  const downloadResult = checkDownloads(profile, models, downloaded);
  const missing: readonly string[] = downloadResult.ok
    ? []
    : downloadResult.missing.map((m) => m.model);
  if (!downloadResult.ok) {
    issues.push(
      `missing downloads — run:\n${formatMissingDownloads(downloadResult)}`,
    );
  }

  // 3. Estimate: size the resident set at the configured context length, over
  // the *resolved* Source keys — the MLX build when downloaded, else GGUF, else
  // the preferred (MLX) build for a Load Identifier with nothing downloaded (so
  // the memory cause is reported even alongside a download cause — report every
  // cause at once, Requirement 41.2). Loads nothing.
  // A Load Identifier already resident (from an earlier run) costs nothing more:
  // the load step reuses it, so only the models still to load are sized.
  // Otherwise a second launch with the models loaded is refused for want of the
  // very memory those models already occupy.
  const alreadyLoaded = new Set((await client.listLoaded()).map((m) => m.identifier));
  const toLoad = required.filter((loadId) => !alreadyLoaded.has(loadId));
  const sourceKeys = toLoad.map((loadId) => {
    const entry = models[loadId];
    if (entry === undefined) {
      // Unvalidated config (the schema otherwise guarantees the entry); fall
      // back to the Load Identifier so the estimate still has a key to size.
      return loadId;
    }
    const resolution = resolveSource(entry, present);
    return resolution.ok ? resolution.source.key : entry.sources[0].key;
  });
  const estimate: ResidentSetEstimate =
    sourceKeys.length === 0
      ? { fits: true, requiredBytes: 0, availableBytes: 0 }
      : await client.estimateResidentSet(sourceKeys, options.contextLength);
  const estimateResult = checkEstimate(estimate);
  if (!estimateResult.ok) {
    issues.push(formatMemoryShortfall(estimateResult));
  }

  return {
    ok: downloadResult.ok && estimateResult.ok,
    missing,
    estimatedBytes: estimateResult.requiredBytes,
    fitsBytes: estimateResult.availableBytes,
    partialGpu: [],
    issues,
  };
}
