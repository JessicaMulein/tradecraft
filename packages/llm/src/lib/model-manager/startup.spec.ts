import { describe, expect, it, vi } from 'vitest';

import type {
  ModelEntry,
  ModelsConfig,
  Profile,
} from '../config/models-config.js';
import type {
  DownloadedModel,
  LmStudioClient,
  LoadModelOptions,
  LoadedModel,
  ResidentSetEstimate,
} from './client-interface.js';
import { ConnectionError } from './connect.js';
import { makeFakeClient } from './fake-client.js';
import { StartupError, activeProfile, startModelManager } from './startup.js';

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

/** voice/fast/narrator/bookkeeping/judge → distinct Load Identifiers: voice, fast, judge. */
const profile: Profile = {
  voice: role('voice'),
  fast: role('fast'),
  narrator: role('fast'),
  bookkeeping: role('fast'),
  judge: role('judge'),
};

/** A model entry: `[mlx, gguf]` with keys `<id>-mlx` / `<id>-gguf`. */
const entry = (id: string): ModelEntry => ({
  family: 'gemma',
  sources: [
    { format: 'mlx', get: `org/${id}-mlx`, key: `${id}-mlx` },
    { format: 'gguf', get: `org/${id}-gguf`, key: `${id}-gguf` },
  ],
});

const models = {
  voice: entry('voice'),
  fast: entry('fast'),
  judge: entry('judge'),
};

/** The distinct Load Identifiers the profile loads, in order. */
const DISTINCT = ['voice', 'fast', 'judge'];
/** The MLX build keys the "downloaded" set carries, in the same order. */
const MLX_KEYS = ['voice-mlx', 'fast-mlx', 'judge-mlx'];

const config: ModelsConfig = {
  endpoint: 'http://localhost:1234/v1',
  contextLength: 8192,
  models,
  profiles: { 'gemma-voice': profile, other: profile },
  active: 'gemma-voice',
};

/** A fitting estimate so the memory check passes. */
const fits: ResidentSetEstimate = {
  fits: true,
  requiredBytes: 10,
  availableBytes: 100,
};

/** A loaded listing where every given identifier is fully GPU-resident. */
const allResident = (ids: readonly string[]): readonly LoadedModel[] =>
  ids.map((identifier) => ({ identifier, gpuResident: true }));

/** No-op sleep so retries add no real delay. */
const noSleep = () => Promise.resolve();
const noopStart = () => Promise.resolve();

describe('activeProfile', () => {
  it('resolves the active profile out of the config', () => {
    expect(activeProfile(config)).toBe(profile);
  });
});

describe('startModelManager', () => {
  it('connects, preflights, then loads and returns a ready result when preflight passes', async () => {
    // A listing that reports nothing loaded before the load, everything
    // resident after, so loadProfile loads the whole distinct set cleanly.
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([]) // preflight's already-loaded check
      .mockResolvedValueOnce([]) // loadProfile's pre-load snapshot
      .mockResolvedValue(allResident(DISTINCT)); // post-load residency
    const loadModel =
      vi.fn<(modelKey: string, options: LoadModelOptions) => Promise<void>>(
        async () => undefined,
      );
    const client = makeFakeClient(MLX_KEYS, {
      estimateResidentSet: async () => fits,
      loadModel,
      listLoaded,
    });
    const connect = vi.fn(() => Promise.resolve(client as LmStudioClient));
    const startServer = vi.fn(noopStart);

    const result = await startModelManager(config, {
      connect,
      startServer,
      sleep: noSleep,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.client).toBe(client);
    expect(result.preflight.ok).toBe(true);
    // The profile was loaded (all three distinct Load Identifiers resident).
    expect(result.load.loaded).toEqual(DISTINCT);
    expect(loadModel).toHaveBeenCalledTimes(3);
    // Each distinct model loaded by its resolved MLX key under its Load Id.
    expect(loadModel).toHaveBeenCalledWith(
      'voice-mlx',
      expect.objectContaining({ identifier: 'voice' }),
    );
  });

  it('runs preflight BEFORE any load (and only on a passing preflight)', async () => {
    // Record the order of the preflight's estimate call and the first load.
    const events: string[] = [];
    const estimateResidentSet = vi.fn<
      (keys: readonly string[], ctx: number) => Promise<ResidentSetEstimate>
    >(async () => {
      events.push('preflight:estimate');
      return fits;
    });
    const loadModel = vi.fn<
      (modelKey: string, options: LoadModelOptions) => Promise<void>
    >(async () => {
      events.push('load');
    });
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([]) // preflight's already-loaded check
      .mockResolvedValueOnce([]) // loadProfile's pre-load snapshot
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, {
      estimateResidentSet,
      loadModel,
      listLoaded,
    });

    await startModelManager(config, {
      connect: () => Promise.resolve(client as LmStudioClient),
      startServer: noopStart,
      sleep: noSleep,
    });

    // The estimate (part of preflight) happened, and strictly before any load.
    expect(events[0]).toBe('preflight:estimate');
    expect(events).toContain('load');
    expect(events.indexOf('preflight:estimate')).toBeLessThan(
      events.indexOf('load'),
    );
  });

  it('refuses and does NOT load when a required model is unresolved', async () => {
    const loadModel = vi.fn<
      (modelKey: string, options: LoadModelOptions) => Promise<void>
    >(async () => undefined);
    // `fast` has neither build downloaded → preflight download check fails.
    const client = makeFakeClient(['voice-mlx', 'judge-mlx'], {
      estimateResidentSet: async () => fits,
      loadModel,
    });

    const error = await startModelManager(config, {
      connect: () => Promise.resolve(client as LmStudioClient),
      startServer: noopStart,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StartupError);
    const se = error as StartupError;
    expect(se.result.ok).toBe(false);
    expect(se.result.missing).toContain('fast');
    // The issues carry the cause so the caller can print it.
    expect(se.result.issues.join('\n')).toContain('org/fast-mlx');
    expect(se.message).toContain('fast');
    // Crucially, nothing was loaded.
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('refuses and does NOT load when the resident set is over budget', async () => {
    const loadModel = vi.fn<
      (modelKey: string, options: LoadModelOptions) => Promise<void>
    >(async () => undefined);
    const overBudget: ResidentSetEstimate = {
      fits: false,
      requiredBytes: 200,
      availableBytes: 100,
    };
    const client = makeFakeClient(MLX_KEYS, {
      estimateResidentSet: async () => overBudget,
      loadModel,
    });

    const error = await startModelManager(config, {
      connect: () => Promise.resolve(client as LmStudioClient),
      startServer: noopStart,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StartupError);
    const se = error as StartupError;
    expect(se.result.ok).toBe(false);
    expect(se.result.issues.length).toBeGreaterThan(0);
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('reads config.contextLength (not an option) into BOTH the preflight estimate and every load', async () => {
    // A non-default context length that no StartupOptions field could supply —
    // StartupOptions carries no contextLength (task 16.3 removed it), so the
    // only way this value can reach the estimate and the loads is by
    // startModelManager reading config.contextLength (Req 22.2).
    const CTX = 4096;
    const estimateResidentSet = vi.fn<
      (keys: readonly string[], ctx: number) => Promise<ResidentSetEstimate>
    >(async () => fits);
    const loadModel = vi.fn<
      (modelKey: string, options: LoadModelOptions) => Promise<void>
    >(async () => undefined);
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([]) // preflight's already-loaded check
      .mockResolvedValueOnce([]) // loadProfile's pre-load snapshot
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, {
      estimateResidentSet,
      loadModel,
      listLoaded,
    });

    await startModelManager(
      { ...config, contextLength: CTX },
      {
        connect: () => Promise.resolve(client as LmStudioClient),
        startServer: noopStart,
        sleep: noSleep,
      },
    );

    // The preflight estimate was sized at the config's context length, over the
    // resolved MLX keys.
    expect(estimateResidentSet).toHaveBeenCalledTimes(1);
    expect(estimateResidentSet).toHaveBeenCalledWith(MLX_KEYS, CTX);
    // Every load used the SAME config context length under its Load Identifier.
    expect(loadModel).toHaveBeenCalledTimes(3);
    for (const [, options] of loadModel.mock.calls) {
      expect(options.contextLength).toBe(CTX);
    }
  });

  it('refuses with the connection cause when the server cannot be reached', async () => {
    // Spies on the (never-returned) client's preflight and load calls. If a
    // regression preflighted or loaded despite a failed connection, these fire.
    const listDownloadedModels = vi.fn<
      () => Promise<readonly DownloadedModel[]>
    >(async () => []);
    const loadModel = vi.fn<
      (modelKey: string, options: LoadModelOptions) => Promise<void>
    >(async () => undefined);
    makeFakeClient(MLX_KEYS, { listDownloadedModels, loadModel });

    const cause = new Error('ECONNREFUSED');
    const connect = vi.fn(async (): Promise<LmStudioClient> => {
      throw cause;
    });

    const error = await startModelManager(config, {
      connect,
      startServer: noopStart,
      maxAttempts: 2,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).message).toContain('ECONNREFUSED');
    // Never preflighted or loaded (the connection never produced a client).
    expect(listDownloadedModels).not.toHaveBeenCalled();
    expect(loadModel).not.toHaveBeenCalled();
  });
});
