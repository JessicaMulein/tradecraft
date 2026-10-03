/**
 * The Model Manager's source resolution and download check (Requirements 43.2,
 * 21.7; design "Model Manager", step 2, and "Source resolution (Req 21.7)").
 *
 * Launching the game must never trigger a 35–40 GB model download as a side
 * effect. So before any load, the preflight compares the active profile's
 * models against the set LM Studio reports as downloaded. If any are missing it
 * does NOT pull them: it prints the exact `lms get <get>` command the operator
 * can run and fails the preflight. The actual download happens only behind an
 * explicit `pnpm models:pull` (task 16.4).
 *
 * A profile role now names a *Load Identifier*, not a model key. Each Load
 * Identifier maps (through the config's `models` map) to a {@link ModelEntry}
 * that carries two {@link ModelSource}s — an MLX build preferred, a GGUF build
 * as the fallback. {@link resolveSource} is the single place that decides which
 * Source a Load Identifier resolves to against the downloaded set: the MLX
 * Source when its `key` is downloaded, else the GGUF Source when its `key` is
 * downloaded, else `missing` carrying the preferred (MLX) Source's `lms get`
 * command (Req 21.7). Every downstream step — this check, the preflight
 * estimate, the load path, and the explicit pull — resolves through it so they
 * all agree on which build to size, load and download.
 *
 * This module is the pure comparison. The caller supplies the already-fetched
 * downloaded set (from `LmStudioClient.listDownloadedModels()`), so the logic
 * is trivially testable offline and never reaches for a download method — there
 * is no download method on `LmStudioClient` to reach for. The result is a
 * discriminated structure, not an exception, so the preflight (task 25.2) can
 * compose it with the other preflight steps and report every cause at once, the
 * way config validation reports every issue (Requirement 41.2).
 */

import type {
  ModelEntry,
  ModelSource,
  ModelsConfig,
  Profile,
} from '../config/models-config.js';
import { requiredModels } from './required-models.js';

/**
 * The `models` map from a loaded {@link ModelsConfig}: Load Identifier → its
 * {@link ModelEntry} (reasoning family and the MLX/GGUF Model Source pair).
 * Threaded into every resolution step alongside the {@link Profile}, because a
 * role's `model` is now a Load Identifier that must be looked up here to find
 * its Model Sources.
 */
export type ModelMap = ModelsConfig['models'];

/**
 * The outcome of resolving one Load Identifier's {@link ModelEntry} against the
 * downloaded set. `downloaded` carries the resolved {@link ModelSource} — the
 * MLX build when present, otherwise the GGUF build — whose `key` the load and
 * estimate paths use. `missing` carries the preferred (MLX) Source's `lms get`
 * command, which the download check surfaces so the operator pulls the build
 * the game prefers (Req 21.7).
 */
export type SourceResolution =
  | { readonly ok: true; readonly source: ModelSource }
  | { readonly ok: false; readonly command: string };

/**
 * Resolve a Load Identifier's {@link ModelEntry} against the downloaded set
 * (Req 21.7).
 *
 * The entry's `sources` is an `[mlx, gguf]` tuple fixing the preference order.
 * Resolution is: the MLX Source when its `key` is downloaded, else the GGUF
 * Source when its `key` is downloaded, else `missing` carrying the preferred
 * (MLX, the first element) Source's `lms get` command. Pure: it reads the entry
 * and the downloaded set and returns a verdict, downloading nothing.
 *
 * @param entry      the model entry (its `sources` are the MLX/GGUF pair)
 * @param downloaded the set of `modelKey`s LM Studio reports as downloaded
 */
export function resolveSource(
  entry: ModelEntry,
  downloaded: ReadonlySet<string>,
): SourceResolution {
  const [mlx, gguf] = entry.sources;
  if (downloaded.has(mlx.key)) {
    return { ok: true, source: mlx };
  }
  if (downloaded.has(gguf.key)) {
    return { ok: true, source: gguf };
  }
  // Neither build is downloaded: report the preferred source's command.
  return { ok: false, command: lmsGetCommand(preferredSource(entry).get) };
}

/**
 * The preferred (MLX) {@link ModelSource} of an entry — the first element of
 * its `[mlx, gguf]` tuple. The one place that names "preferred", so the build
 * {@link resolveSource} reports when neither is downloaded and the build the
 * explicit pull (task 16.4) fetches are the same Source by construction, not by
 * each indexing `sources` independently (Req 21.7).
 */
export function preferredSource(entry: ModelEntry): ModelSource {
  return entry.sources[0];
}

/** One Load Identifier the active profile needs that has no downloaded Source. */
export interface MissingDownload {
  /** The Load Identifier the profile requires, exactly as configured. */
  readonly model: string;
  /** The exact command the operator runs, `lms get <preferred source `get`>`. */
  readonly command: string;
}

/**
 * The outcome of the download check. `ok` is true only when every Load
 * Identifier the active profile needs resolves to a downloaded Source. On
 * failure, `missing` lists each Load Identifier that has neither Source
 * downloaded, with the preferred Source's `lms get` command, in the order the
 * Load Identifiers first appear across the profile's roles. `required` is the
 * distinct set of Load Identifiers the profile needs, for reporting and for the
 * explicit pull path.
 */
export type DownloadCheckResult =
  | { readonly ok: true; readonly required: readonly string[] }
  | {
      readonly ok: false;
      readonly required: readonly string[];
      readonly missing: readonly MissingDownload[];
    };

/**
 * Format the `lms get` command for one `get` argument. Centralised so the check
 * and the explicit pull path (task 16.4) emit byte-identical commands. The
 * argument is a Model Source's `get` value, not a Load Identifier.
 */
export function lmsGetCommand(get: string): string {
  return `lms get ${get}`;
}

/**
 * Compare the active profile's distinct Load Identifiers against the downloaded
 * set, resolving each one's Model Source (Req 21.7).
 *
 * Pure and side-effect free: it reads the inputs and returns a result. It never
 * downloads — a Load Identifier whose entry resolves to `missing` (neither its
 * MLX nor GGUF `key` is downloaded) becomes a {@link MissingDownload} carrying
 * the preferred Source's `lms get` command, and the result is `ok: false`. A
 * Load Identifier counts as present when {@link resolveSource} resolves it to a
 * downloaded Source.
 *
 * @param profile    the active profile whose role Load Identifiers must resolve
 * @param models     the config's `models` map, to look each entry up
 * @param downloaded the model keys LM Studio reports as locally downloaded
 */
export function checkDownloads(
  profile: Profile,
  models: ModelMap,
  downloaded: Iterable<string>,
): DownloadCheckResult {
  const present = new Set(downloaded);
  const required = requiredModels(profile);

  const missing: MissingDownload[] = [];
  for (const loadId of required) {
    const entry = models[loadId];
    // The config loader guarantees every role's model is a key of `models`
    // (ModelsConfigSchema's refinement), so a missing entry means an
    // unvalidated config was passed; treat it as needing a pull with the
    // Load Identifier itself as the command argument so the cause is visible.
    if (entry === undefined) {
      missing.push({ model: loadId, command: lmsGetCommand(loadId) });
      continue;
    }
    const resolution = resolveSource(entry, present);
    if (!resolution.ok) {
      missing.push({ model: loadId, command: resolution.command });
    }
  }

  if (missing.length === 0) {
    return { ok: true, required };
  }
  return { ok: false, required, missing };
}

/**
 * Render a failed download check as one `lms get <get>` line per missing Load
 * Identifier, the block the preflight prints so the operator can copy the
 * commands. Returns the empty string when nothing is missing.
 */
export function formatMissingDownloads(result: DownloadCheckResult): string {
  if (result.ok) {
    return '';
  }
  return result.missing.map((m) => m.command).join('\n');
}
