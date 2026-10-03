/**
 * The real `@lmstudio/sdk` adapter (Requirement 43.1; design "Model Manager").
 *
 * This is the ONLY module that references the concrete `@lmstudio/sdk` class.
 * Everything else in the Model Manager depends on the {@link LmStudioClient}
 * interface, so the pure logic (connection retry, download diffing, `lms get`
 * formatting) is testable offline against a fake while this thin seam is the
 * single place a live SDK connection is made. Keeping the import confined here
 * is what lets tasks 25.1–25.5 inject a fake and keeps the SDK off every other
 * code path — crucially off the inference path, which stays on the Gateway's
 * OpenAI-compatible endpoint (Requirement 43.7).
 *
 * The adapter wraps the SDK's `LMStudioClient` and exposes exactly the surface
 * the Model Manager needs: a client that lists downloaded models, estimates the
 * resident set, loads/unloads models under stable identifiers and lists what is
 * loaded with its GPU residency (task 25.3), plus a {@link ConnectAction} that
 * proves the server is reachable and a {@link StartServerAction} that runs
 * `lms server start`. Still no inference method — that stays on the Gateway's
 * OpenAI endpoint (Requirement 43.7).
 */

import { spawn } from 'node:child_process';

import { LMStudioClient } from '@lmstudio/sdk';

import type {
  DownloadedModel,
  LmStudioClient,
  LoadModelOptions,
  LoadedModel,
  ResidentSetEstimate,
} from './client-interface.js';
import type { ConnectAction, StartServerAction } from './connect.js';

/** Options for building the real adapter. */
export interface SdkAdapterOptions {
  /**
   * The LM Studio server base URL (`ws://`/`wss://`). Omit to let the SDK probe
   * localhost on its default ports.
   */
  readonly baseUrl?: string;
}

/**
 * Wrap a concrete `LMStudioClient` as the Model Manager's {@link LmStudioClient}.
 * The SDK's `system.listDownloadedModels()` returns richer `ModelInfo` records;
 * we project them to the single `modelKey` the Model Manager compares against.
 */
export function adaptLmStudioClient(client: LMStudioClient): LmStudioClient {
  return {
    async listDownloadedModels(): Promise<readonly DownloadedModel[]> {
      const models = await client.system.listDownloadedModels();
      return models.map((m) => ({ modelKey: m.modelKey }));
    },

    async estimateResidentSet(
      modelKeys: readonly string[],
      contextLength: number,
    ): Promise<ResidentSetEstimate> {
      // The SDK's estimate-only path sizes one model at a time. We size each
      // distinct key at the configured context length (so the KV cache is
      // accounted for), sum the totals into the resident set's requirement, and
      // only call the set a fit if every model passes the SDK's guardrails. No
      // model is loaded — `estimateResourcesUsage` is a pure sizing call.
      let requiredBytes = 0;
      let availableBytes = Number.POSITIVE_INFINITY;
      let fits = true;

      for (const modelKey of modelKeys) {
        const usage = await client.llm.estimateResourcesUsage(modelKey, {
          contextLength,
        });
        requiredBytes += usage.memory.totalBytes;
        // The guardrail verdict is per-model; the set fits only if all do.
        fits = fits && usage.passesGuardrails;
        // The SDK reports usage, not a standalone capacity figure. Derive the
        // budget from the tightest guardrail we can see: a model that passes had
        // at least its own total available, one that fails had less. Taking the
        // minimum across models yields a conservative `availableBytes` the pure
        // check can compare against while `fits` stays authoritative.
        const perModelAvailable = usage.passesGuardrails
          ? usage.memory.totalBytes
          : Math.max(0, usage.memory.totalBytes - 1);
        availableBytes = Math.min(availableBytes, perModelAvailable);
      }

      // An empty set trivially fits and needs nothing; avoid an infinite budget.
      if (!Number.isFinite(availableBytes)) {
        availableBytes = requiredBytes;
      }

      return { fits, requiredBytes, availableBytes };
    },

    async loadModel(
      modelKey: string,
      options: LoadModelOptions,
    ): Promise<void> {
      // Load through the SDK under the caller's stable identifier (the
      // models.yaml model string) at the configured context length
      // (Requirements 43.4, 43.7). When `keepResident` is set we disable
      // idle-unload/auto-evict so an explicitly loaded model stays resident for
      // the whole session rather than unloading after an idle window the way a
      // first-request load would (Requirement 43.6): `ttl` left undefined means
      // no idle TTL, and `keepModelInMemory` reserves RAM so the OS does not
      // evict it. `load` makes the model resident; it is a management call, not
      // inference (which stays on the Gateway's OpenAI endpoint, Req 43.7).
      await client.llm.load(modelKey, {
        identifier: options.identifier,
        config: {
          contextLength: options.contextLength,
          keepModelInMemory: options.keepResident,
        },
        // `ttl` is left undefined so the instance has no idle TTL and does not
        // auto-unload while the game runs (Requirement 43.6).
      });
    },

    async unloadModel(identifier: string): Promise<void> {
      await client.llm.unload(identifier);
    },

    async listLoaded(): Promise<readonly LoadedModel[]> {
      // The SDK lists loaded instances as handles keyed by their identifier.
      // GPU residency is read from each instance's load config: the GPU offload
      // ratio is 1 / "max" when every offloadable layer is on the GPU, and less
      // when macOS has spilled layers to RAM (a partial load that still runs,
      // far slower). We call anything short of a full offload "not fully
      // GPU-resident" so the load path can warn by identifier (Requirement 43.5).
      const loaded = await client.llm.listLoaded();
      return Promise.all(
        loaded.map(async (model) => {
          const config = await model.getLoadConfig();
          return {
            identifier: model.identifier,
            gpuResident: isFullyGpuResident(config.gpu?.ratio),
          };
        }),
      );
    },
  };
}

/**
 * Whether a model's GPU offload ratio means it is *fully* on the GPU. The SDK's
 * ratio is `number | "max" | "off"`: `"max"` and a numeric `>= 1` are a full
 * offload; `"off"`, a numeric `< 1`, or an absent ratio mean layers live in RAM,
 * i.e. a partial load (Requirement 43.5). An absent ratio is treated as not
 * fully resident so an uncertain read warns rather than silently passing.
 */
function isFullyGpuResident(
  ratio: number | 'max' | 'off' | undefined,
): boolean {
  if (ratio === 'max') {
    return true;
  }
  if (typeof ratio === 'number') {
    return ratio >= 1;
  }
  return false;
}

/**
 * A {@link ConnectAction} that constructs the real SDK client and verifies the
 * server is reachable before returning it. Construction alone does not open a
 * connection, so we issue a cheap `listDownloadedModels()` as the reachability
 * probe: if the server is down this rejects, which is exactly what
 * {@link connectWithRetry} needs to drive its start-and-retry loop.
 */
export function createSdkConnectAction(
  options: SdkAdapterOptions = {},
): ConnectAction {
  return async () => {
    const client = new LMStudioClient(
      options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl },
    );
    const adapted = adaptLmStudioClient(client);
    // Reachability probe: a connected server answers; a down server rejects.
    await adapted.listDownloadedModels();
    return adapted;
  };
}

/**
 * A {@link StartServerAction} that runs `lms server start`. Resolves when the
 * command exits 0, rejects on a non-zero exit or a spawn error. The connection
 * retry loop treats a rejection here as non-fatal and still retries, so a
 * "server already running" style failure does not abort startup.
 */
export function createLmsStartServerAction(): StartServerAction {
  return () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn('lms', ['server', 'start'], { stdio: 'ignore' });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`\`lms server start\` exited with code ${code ?? 'null'}`));
        }
      });
    });
}
