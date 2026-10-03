/**
 * `pnpm models:pull` — download the active profile's missing models (task 25.4;
 * Requirement 43.2).
 *
 * This is the thin CLI entry over the pure pull logic in
 * `src/lib/model-manager/models-pull.ts`. It is the ONLY path that downloads:
 * launching the game never pulls (the preflight fail-and-reports), so an
 * operator whose preflight reported missing models runs this once to fetch
 * them, then launches.
 *
 * It loads `config/models.yaml`, connects to LM Studio (starting the server if
 * it is down, via the same `connectWithRetry` path startup uses), resolves the
 * active profile, and runs the real `lms get <model>` action for each model the
 * profile needs that is not already downloaded. A bad config refuses with the
 * same located `<file>: <path>: <message>` lines the game startup prints
 * (Requirement 41.2); a connection failure prints its cause. When nothing is
 * missing it downloads nothing and says so.
 *
 * Usage (matching the repo's standalone-script convention, e.g.
 * `packages/evals/scripts/record-golden.ts`):
 *   `pnpm --filter @tradecraft/llm exec tsx scripts/models-pull.ts`
 * or via the root `pnpm models:pull` script. The script is not part of the
 * build or CI; it lives outside `src` so it is excluded from the library
 * typecheck and from the test run, exactly like `record-golden.ts`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ConnectionError,
  activeProfile,
  connectWithRetry,
  createLmsStartServerAction,
  createSdkConnectAction,
  formatConfigIssues,
  loadModelsConfig,
} from '../src/index.js';

import {
  createLmsGetAction,
  pullMissingModelsForClient,
} from '../src/lib/model-manager/models-pull.js';

/** The repo-root `config/models.yaml`, resolved relative to this script. */
const CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'config',
  'models.yaml',
);

async function main(): Promise<void> {
  // 1. Load and validate models.yaml. Refuse with located issues on failure,
  //    the way config validation does (Requirement 41.2).
  const loaded = loadModelsConfig(CONFIG_PATH);
  if (!loaded.ok) {
    console.error('models.yaml is invalid; refusing to pull:');
    console.error(formatConfigIssues(loaded.issues));
    process.exitCode = 1;
    return;
  }
  const config = loaded.value;
  const profile = activeProfile(config);

  // 2. Connect (starting the server if down). A failure prints the cause.
  let client;
  try {
    // No baseUrl: the SDK probes LM Studio on its default localhost ports. The
    // `config.endpoint` is the Gateway's OpenAI-compatible URL (`.../v1`), a
    // different protocol from the SDK's management socket, so it is not reused
    // here — model *management* goes through the SDK, inference through the
    // endpoint (Requirement 43.7).
    client = await connectWithRetry({
      connect: createSdkConnectAction(),
      startServer: createLmsStartServerAction(),
    });
  } catch (error) {
    if (error instanceof ConnectionError) {
      console.error(`could not connect to LM Studio: ${error.message}`);
    } else {
      console.error(`could not connect to LM Studio: ${String(error)}`);
    }
    process.exitCode = 1;
    return;
  }

  // 3. Pull the active profile's missing models — the only download path.
  console.log(`pulling missing models for active profile "${config.active}"…`);
  const result = await pullMissingModelsForClient(
    profile,
    config.models,
    client,
    createLmsGetAction(),
  );

  if (result.pulled.length === 0) {
    console.log('all required models are already downloaded; nothing to pull.');
    return;
  }
  console.log(
    `downloaded ${result.pulled.length} model(s): ${result.pulled.join(', ')}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
