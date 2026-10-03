/**
 * The explicit `models:pull` download path (Requirement 43.2; design "Model
 * Manager", step 2).
 *
 * Everywhere else in the Model Manager, a missing model is reported and never
 * pulled: the download check (`./download-check.ts`) and the preflight
 * (`./preflight.ts`) compare the active profile's models against what LM Studio
 * has downloaded and, if any are absent, fail-and-report rather than trigger a
 * 35–40 GB download as a startup side effect. This module is the ONE place that
 * actually downloads, and it runs only behind an explicit `pnpm models:pull`
 * (the thin CLI entry in `scripts/models-pull.ts`). The split is deliberate:
 * downloads are large and slow, so they happen only when an operator asks for
 * them, never implicitly at launch.
 *
 * The pull reuses the exact same source resolution the preflight uses
 * (`resolveSource` → `lmsGetCommand`), so the build it pulls and the command it
 * prints are byte-identical to what the preflight told the operator to run: for
 * each missing Load Identifier it fetches the preferred (MLX) Source
 * `resolveSource` reports, never a build chosen a second, independent way (Req
 * 21.7). It downloads only the models the ACTIVE profile needs and that are not
 * already downloaded; when nothing is missing it downloads nothing. The actual
 * `lms get <model>` is a {@link PullAction} injected by the caller — the real
 * CLI entry supplies {@link createLmsGetAction}, which shells out exactly the
 * way `createLmsStartServerAction` runs `lms server start`; a test supplies a
 * spy and asserts the exact commands without spawning a process.
 */

import { spawn } from 'node:child_process';

import type { Profile } from '../config/models-config.js';
import type { LmStudioClient } from './client-interface.js';
import {
  checkDownloads,
  lmsGetCommand,
  preferredSource,
  resolveSource,
  type ModelMap,
} from './download-check.js';

/**
 * Download a single model, i.e. run `lms get <model>`. Injected so the pull is
 * testable offline: the real CLI entry passes {@link createLmsGetAction} (which
 * spawns the command); a test passes a `vi.fn()` spy and asserts the model ids
 * it was called with. Rejecting aborts the pull.
 */
export type PullAction = (model: string) => Promise<void>;

/** The outcome of a pull: which models were (or would be) downloaded, with their commands. */
export interface PullResult {
  /** The active profile's distinct required models, in first-appearance order. */
  readonly required: readonly string[];
  /** The models that were missing and therefore pulled, in order. */
  readonly pulled: readonly string[];
  /** The exact `lms get <model>` command run for each pulled model, in order. */
  readonly commands: readonly string[];
}

/**
 * Pull the active profile's missing models by running the download action for
 * each, in the order they appear in the profile.
 *
 * It is the SOLE download path (Requirement 43.2): it computes the missing set
 * with `checkDownloads` — identical to what the preflight uses — and, for each
 * missing Load Identifier, resolves the build to fetch through the same
 * {@link resolveSource} the download check and preflight use (Req 21.7). A Load
 * Identifier whose entry resolves to `missing` is pulled by its preferred (MLX)
 * Source's `get` argument, so `models:pull` and the preflight agree byte-for-byte
 * on which build to fetch. A model already downloaded is skipped, so re-running
 * the pull after a partial download only fetches what is still absent, and when
 * nothing is missing the action is never called and nothing is downloaded.
 *
 * The caller supplies the already-fetched downloaded set (from
 * `LmStudioClient.listDownloadedModels()`), keeping this function a pure
 * composition over the download check, the source resolution and the injected
 * action.
 *
 * @param profile    the active profile whose missing models to download
 * @param models     the config's `models` map, to resolve each entry's Source
 * @param downloaded the model ids LM Studio reports as locally downloaded
 * @param pull       the per-model download action (`lms get <model>`)
 */
export async function pullMissingModels(
  profile: Profile,
  models: ModelMap,
  downloaded: Iterable<string>,
  pull: PullAction,
): Promise<PullResult> {
  const present = new Set(downloaded);
  const check = checkDownloads(profile, models, present);

  // Nothing missing → download nothing (the preflight would already pass).
  if (check.ok) {
    return { required: check.required, pulled: [], commands: [] };
  }

  const pulled: string[] = [];
  const commands: string[] = [];
  // `check.missing` is already the resolveSource-driven list, in profile order.
  // For each, fetch the preferred Source resolveSource reports missing — the
  // single rule the download check and preflight use — rather than a build
  // chosen by indexing `sources` a second, independent way here (Req 21.7).
  for (const { model: loadId } of check.missing) {
    const getArg = missingGetArg(loadId, models[loadId], present);
    await pull(getArg);
    pulled.push(getArg);
    commands.push(lmsGetCommand(getArg));
  }
  return { required: check.required, pulled, commands };
}

/**
 * The `lms get` argument for a Load Identifier the download check reports
 * missing: the preferred Source {@link resolveSource} points at (Req 21.7).
 * `resolveSource` reports its `missing` command via `preferredSource`, and this
 * reads the same `preferredSource`, so the build pulled and the command the
 * preflight prints are the one Source by construction.
 *
 * An entry can only be absent when an unvalidated config was passed — the loader
 * guarantees every role's model is a key of `models` — so that case falls back
 * to the Load Identifier itself, the same visible-cause fallback
 * `checkDownloads` uses. The `resolveSource` call confirms the entry is still
 * unresolved (always true for a `check.missing` entry); only then do we pull.
 */
function missingGetArg(
  loadId: string,
  entry: ModelMap[string] | undefined,
  present: ReadonlySet<string>,
): string {
  if (entry === undefined) {
    return loadId;
  }
  const resolution = resolveSource(entry, present);
  // Resolved after all (unreachable for a `check.missing` entry): pull that
  // downloaded build's `get`. Otherwise pull the preferred Source it reports.
  return resolution.ok
    ? resolution.source.get
    : preferredSource(entry).get;
}

/**
 * Convenience wrapper that reads the downloaded set off a connected client and
 * then pulls the active profile's missing models. This is what the CLI entry
 * calls once it has connected: it asks LM Studio what is downloaded, then runs
 * {@link pullMissingModels}. The listing is the one management call it makes —
 * no inference, consistent with the rest of the Model Manager (Requirement 43.7).
 *
 * @param profile the active profile whose missing models to download
 * @param client  a connected management client
 * @param pull    the per-model download action (`lms get <model>`)
 */
export async function pullMissingModelsForClient(
  profile: Profile,
  models: ModelMap,
  client: LmStudioClient,
  pull: PullAction,
): Promise<PullResult> {
  const downloaded = (await client.listDownloadedModels()).map(
    (m) => m.modelKey,
  );
  return pullMissingModels(profile, models, downloaded, pull);
}

/**
 * A {@link PullAction} that runs `lms get <model>`, shelling out exactly the way
 * `createLmsStartServerAction` runs `lms server start`. Resolves when the
 * command exits 0, rejects on a non-zero exit or spawn error so the pull aborts
 * on a failed download. `stdio: 'inherit'` lets `lms get`'s own download
 * progress reach the operator's terminal.
 */
export function createLmsGetAction(): PullAction {
  return (model: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn('lms', ['get', model], { stdio: 'inherit' });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `\`${lmsGetCommand(model)}\` exited with code ${code ?? 'null'}`,
            ),
          );
        }
      });
    });
}
