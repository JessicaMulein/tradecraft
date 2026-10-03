/**
 * The Model Manager's startup/bootstrap composition (Requirements 43.2, 43.8;
 * design "Model Manager").
 *
 * The individual management steps already exist as pure, offline-testable
 * pieces: `connectWithRetry` (connect, starting the server if it is down),
 * `preflight` (check downloads and size the resident set, loading nothing), and
 * `loadProfile` (make the profile's models resident). This module is the single
 * entry point that wires them together in the one order the design mandates and
 * that a real game entry (and task 25.5's tests) calls BEFORE the first model
 * call:
 *
 *   1. Connect to LM Studio (`connectWithRetry`). A connection that cannot be
 *      made aborts startup with the connection cause — nothing is preflighted or
 *      loaded.
 *   2. Run `preflight` against the connected client, sized at the config's
 *      `contextLength`. Preflight runs BEFORE any load, and therefore before
 *      the first model call, exactly as Requirement 43.8 requires.
 *   3. ONLY on `preflight.ok` does the profile load (`loadProfile`). On a
 *      failing preflight the module loads NOTHING and refuses to start, carrying
 *      the preflight's `issues` so the caller prints them and exits — the same
 *      way config validation refuses and reports every cause at once
 *      (Requirements 41.2, 43.8).
 *
 * "Refuse to start" is modelled as a thrown typed error ({@link StartupError}
 * for a failed preflight, and the connection path's own `ConnectionError` for an
 * unreachable server), so a caller cannot accidentally proceed to inference past
 * a failure: there is no "ready" value to misuse unless every gate passed. The
 * connect/startServer actions are injected (threaded straight into
 * `connectWithRetry`), so the whole bootstrap is testable offline against a fake
 * client with no real server, process, or model.
 *
 * No inference happens here. Connecting, preflighting and loading are all
 * management; running the models is the Gateway's job over the OpenAI endpoint
 * (Requirement 43.7).
 */

import type { ModelsConfig, Profile } from '../config/models-config.js';
import type { LmStudioClient } from './client-interface.js';
import {
  connectWithRetry,
  type ConnectAction,
  type SleepFn,
  type StartServerAction,
} from './connect.js';
import { loadProfile, type LoadProfileResult } from './load-profile.js';
import { preflight, type PreflightResult } from './preflight.js';

/**
 * A started Model Manager: the connected management client, the preflight
 * result it passed, and the profile load that followed. Returned only when
 * every gate passed, so holding a {@link StartupResult} is proof the preflight
 * ran and succeeded before the first model call (Requirement 43.8).
 */
export interface StartupResult {
  /** The connected management client, ready for the Gateway to run inference against the endpoint. */
  readonly client: LmStudioClient;
  /** The passing preflight result (`ok` is always true here). */
  readonly preflight: PreflightResult;
  /** The outcome of loading the active profile (identifiers + any partial-GPU warnings). */
  readonly load: LoadProfileResult;
}

/**
 * Raised when the preflight fails, so startup refuses and nothing is loaded.
 * Carries the whole {@link PreflightResult} — crucially its `issues` — so the
 * caller prints every cause and exits, the way config validation reports every
 * issue at once (Requirements 41.2, 43.8).
 */
export class StartupError extends Error {
  /** The failing preflight result; `result.issues` are the causes to print. */
  readonly result: PreflightResult;

  constructor(result: PreflightResult) {
    const detail =
      result.issues.length > 0 ? `:\n${result.issues.join('\n')}` : '';
    super(`Model Manager preflight failed, refusing to start${detail}`);
    this.name = 'StartupError';
    this.result = result;
  }
}

/** Options for {@link startModelManager}. */
export interface StartupOptions {
  /** Attempt a single connection. Injected so startup is offline-testable. Required. */
  readonly connect: ConnectAction;
  /** Start the LM Studio server (`lms server start`). Injected. Required. */
  readonly startServer: StartServerAction;
  /** Maximum connection attempts. Forwarded to `connectWithRetry`. */
  readonly maxAttempts?: number;
  /** Backoff between connection attempts, in milliseconds. Forwarded to `connectWithRetry`. */
  readonly backoffMs?: number;
  /** Sleep implementation; injectable so tests add no real delay. */
  readonly sleep?: SleepFn;
  /** Observability hook called before each connection retry. */
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Resolve the active profile out of a loaded {@link ModelsConfig}. The config
 * loader (`ModelsConfigSchema`) already guarantees `active` names a defined
 * profile, so this is a direct lookup; it throws only if an unvalidated config
 * is passed, which the type system otherwise prevents.
 */
export function activeProfile(config: ModelsConfig): Profile {
  const profile = config.profiles[config.active];
  if (profile === undefined) {
    throw new Error(
      `active profile "${config.active}" is not defined in models.yaml`,
    );
  }
  return profile;
}

/**
 * Connect, preflight, and (only on success) load the active profile — the one
 * bootstrap a game entry runs before the first model call.
 *
 * Sequence (short-circuiting on the first gate that fails):
 *   1. `connectWithRetry` obtains a connected client, starting the server if it
 *      is down. If it cannot connect it throws `ConnectionError`; this function
 *      lets that propagate so the caller reports the connection cause and exits.
 *      Nothing is preflighted or loaded.
 *   2. `preflight` runs against the connected client, sized at the config's
 *      `contextLength` — BEFORE any load, hence before the first model call.
 *   3. If `preflight.ok` is false, throw {@link StartupError} carrying the
 *      result's `issues`; NOTHING is loaded.
 *   4. Otherwise `loadProfile` makes the profile's models resident and a
 *      {@link StartupResult} is returned.
 *
 * Preflight-before-load is enforced structurally: `loadProfile` is only reached
 * on the `ok` branch, after `preflight` has already run on the connected client.
 *
 * The context length both the preflight estimate and every model load are sized
 * at is read from `config.contextLength` (Req 22.2); callers no longer supply it
 * (design "Context Length").
 *
 * @param config  the loaded, validated `models.yaml`
 * @param options the injected connect/startServer path
 */
export async function startModelManager(
  config: ModelsConfig,
  options: StartupOptions,
): Promise<StartupResult> {
  const profile = activeProfile(config);

  // 1. Connect (starting the server if down). A failure throws ConnectionError,
  //    which we let propagate — the caller reports the connection cause and the
  //    preflight is never reached.
  const client = await connectWithRetry({
    connect: options.connect,
    startServer: options.startServer,
    maxAttempts: options.maxAttempts,
    backoffMs: options.backoffMs,
    sleep: options.sleep,
    onRetry: options.onRetry,
  });

  // 2. Preflight BEFORE any load (so before the first model call): resolve each
  //    Load Identifier's Model Source, check downloads, and size the resident
  //    set over the resolved keys at the config's context length. Loads nothing.
  const preflightResult = await preflight(profile, config.models, client, {
    contextLength: config.contextLength,
  });

  // 3. Refuse to start on a failing preflight, carrying every cause. No load.
  if (!preflightResult.ok) {
    throw new StartupError(preflightResult);
  }

  // 4. Only now, on a passing preflight, load the profile's resolved Sources
  //    under their Load Identifiers, at the config's context length.
  const load = await loadProfile(profile, config.models, client, {
    contextLength: config.contextLength,
  });

  return { client, preflight: preflightResult, load };
}
