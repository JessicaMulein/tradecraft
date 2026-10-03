import { describe, expect, it, vi } from 'vitest';

import type { ModelEntry, Profile } from '../config/models-config.js';
import type { LoadModelOptions, LoadedModel } from './client-interface.js';
import type { ModelMap } from './download-check.js';
import { makeFakeClient } from './fake-client.js';
import { loadProfile, unloadProfile } from './load-profile.js';

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

/**
 * fast/narrator/bookkeeping share the `fast` Load Identifier, so the profile
 * references three distinct Load Identifiers in first-appearance order:
 * voice, fast, judge.
 */
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

const models: ModelMap = {
  voice: entry('voice'),
  fast: entry('fast'),
  judge: entry('judge'),
};

/** The distinct Load Identifiers, in load order. */
const DISTINCT = ['voice', 'fast', 'judge'];
/** The MLX build keys the "downloaded" set carries, in the same order. */
const MLX_KEYS = ['voice-mlx', 'fast-mlx', 'judge-mlx'];

/** A loaded-model listing where every given identifier is fully GPU-resident. */
const allResident = (identifiers: readonly string[]): readonly LoadedModel[] =>
  identifiers.map((identifier) => ({ identifier, gpuResident: true }));

/** A typed no-op load spy whose call records carry the (modelKey, options) tuple. */
const makeLoadSpy = () =>
  vi.fn<(modelKey: string, options: LoadModelOptions) => Promise<void>>(
    async () => undefined,
  );

/** A typed no-op unload spy whose call records carry the identifier. */
const makeUnloadSpy = () =>
  vi.fn<(identifier: string) => Promise<void>>(async () => undefined);

describe('loadProfile', () => {
  it('loads each distinct model once: resolved Source key under its Load Identifier', async () => {
    const loadModel = makeLoadSpy();
    // Nothing loaded beforehand; after loading, everything is fully resident.
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, { loadModel, listLoaded });

    const result = await loadProfile(profile, models, client, {
      contextLength: 8192,
    });

    // Three distinct Load Identifiers loaded — `fast` backs three roles, once.
    expect(loadModel).toHaveBeenCalledTimes(3);
    expect(result.loaded).toEqual(DISTINCT);

    // Each loaded with the resolved MLX Source key, under its Load Identifier.
    expect(loadModel).toHaveBeenCalledWith(
      'voice-mlx',
      expect.objectContaining({ identifier: 'voice', contextLength: 8192 }),
    );
    expect(loadModel).toHaveBeenCalledWith(
      'fast-mlx',
      expect.objectContaining({ identifier: 'fast', contextLength: 8192 }),
    );
    expect(loadModel).toHaveBeenCalledWith(
      'judge-mlx',
      expect.objectContaining({ identifier: 'judge', contextLength: 8192 }),
    );
    // `fast` (shared by three roles) is loaded exactly once.
    const fastLoads = loadModel.mock.calls.filter(
      ([, options]) => options.identifier === 'fast',
    );
    expect(fastLoads).toHaveLength(1);
  });

  it('loads the GGUF Source key when only the GGUF build is downloaded', async () => {
    const loadModel = makeLoadSpy();
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(allResident(DISTINCT));
    // `voice` only has its GGUF build downloaded; the others resolve to MLX.
    const client = makeFakeClient(['voice-gguf', 'fast-mlx', 'judge-mlx'], {
      loadModel,
      listLoaded,
    });

    await loadProfile(profile, models, client, { contextLength: 8192 });

    // `voice` loads its GGUF key, still under the `voice` Load Identifier.
    expect(loadModel).toHaveBeenCalledWith(
      'voice-gguf',
      expect.objectContaining({ identifier: 'voice' }),
    );
  });

  it('resolves roles independently: loads some by MLX and others by GGUF in one profile', async () => {
    const loadModel = makeLoadSpy();
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(allResident(DISTINCT));
    // `fast` (the shared Load Identifier, backing three roles) has only its
    // GGUF build downloaded; `voice` and `judge` resolve to their MLX builds.
    const client = makeFakeClient(['voice-mlx', 'fast-gguf', 'judge-mlx'], {
      loadModel,
      listLoaded,
    });

    const result = await loadProfile(profile, models, client, {
      contextLength: 8192,
    });

    // Still three distinct loads: each role's Load Identifier loaded once.
    expect(result.loaded).toEqual(DISTINCT);
    expect(loadModel).toHaveBeenCalledTimes(3);
    // The mix: voice/judge by their MLX keys, the shared `fast` by its GGUF key.
    expect(loadModel).toHaveBeenCalledWith(
      'voice-mlx',
      expect.objectContaining({ identifier: 'voice' }),
    );
    expect(loadModel).toHaveBeenCalledWith(
      'judge-mlx',
      expect.objectContaining({ identifier: 'judge' }),
    );
    expect(loadModel).toHaveBeenCalledWith(
      'fast-gguf',
      expect.objectContaining({ identifier: 'fast' }),
    );
    // The shared GGUF-resolved identifier still loads exactly once, not thrice.
    const fastLoads = loadModel.mock.calls.filter(
      ([, options]) => options.identifier === 'fast',
    );
    expect(fastLoads).toHaveLength(1);
    expect(fastLoads[0][0]).toBe('fast-gguf');
  });

  it('disables idle-unload / auto-evict on every load (keepResident)', async () => {
    const loadModel = makeLoadSpy();
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, { loadModel, listLoaded });

    await loadProfile(profile, models, client, { contextLength: 8192 });

    for (const [, options] of loadModel.mock.calls) {
      expect(options.keepResident).toBe(true);
    }
  });

  it('warns by Load Identifier on a partially-GPU-resident model and populates partialGpu', async () => {
    const loadModel = makeLoadSpy();
    // After loading, `fast` is only partially on the GPU; the rest are full.
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { identifier: 'voice', gpuResident: true },
        { identifier: 'fast', gpuResident: false },
        { identifier: 'judge', gpuResident: true },
      ]);
    const client = makeFakeClient(MLX_KEYS, { loadModel, listLoaded });

    const result = await loadProfile(profile, models, client, {
      contextLength: 8192,
    });

    expect(result.partialGpu).toEqual(['fast']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fast');
    // The clean models are not warned about.
    expect(result.warnings.join('\n')).not.toContain('voice');
  });

  it('yields no warnings when every loaded model is fully GPU-resident', async () => {
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, { listLoaded });

    const result = await loadProfile(profile, models, client, {
      contextLength: 8192,
    });

    expect(result.partialGpu).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('is idempotent: a Load Identifier already loaded is not re-loaded', async () => {
    const loadModel = makeLoadSpy();
    // `fast` is already resident; only `voice` and `judge` load.
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([{ identifier: 'fast', gpuResident: true }])
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, { loadModel, listLoaded });

    const result = await loadProfile(profile, models, client, {
      contextLength: 8192,
    });

    expect(loadModel).toHaveBeenCalledTimes(2);
    expect(loadModel).not.toHaveBeenCalledWith(
      'fast-mlx',
      expect.anything(),
    );
    // The result still reports every distinct Load Identifier as loaded.
    expect(result.loaded).toEqual(DISTINCT);
  });

  it('never routes inference through the client (management surface only)', async () => {
    const listLoaded = vi
      .fn<() => Promise<readonly LoadedModel[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(allResident(DISTINCT));
    const client = makeFakeClient(MLX_KEYS, { listLoaded });

    await loadProfile(profile, models, client, { contextLength: 8192 });

    const surface = client as unknown as Record<string, unknown>;
    expect(surface.chat).toBeUndefined();
    expect(surface.complete).toBeUndefined();
    expect(surface.respond).toBeUndefined();
    expect(surface.completion).toBeUndefined();
    // Only management methods are present.
    expect(typeof client.loadModel).toBe('function');
    expect(typeof client.unloadModel).toBe('function');
    expect(typeof client.listLoaded).toBe('function');
  });
});

describe('unloadProfile', () => {
  it('unloads each distinct Load Identifier exactly once (shared one once)', async () => {
    const unloadModel = makeUnloadSpy();
    const client = makeFakeClient(MLX_KEYS, { unloadModel });

    const unloaded = await unloadProfile(profile, client);

    expect(unloadModel).toHaveBeenCalledTimes(3);
    expect(unloaded).toEqual(DISTINCT);
    for (const identifier of DISTINCT) {
      expect(unloadModel).toHaveBeenCalledWith(identifier);
    }
    // `fast` backed three roles but is unloaded once.
    const fastUnloads = unloadModel.mock.calls.filter(
      ([identifier]) => identifier === 'fast',
    );
    expect(fastUnloads).toHaveLength(1);
  });
});

describe('profile switch (unload old, load new)', () => {
  it('supports a load -> unload -> load sequence for the eval harness', async () => {
    // A tiny in-memory residency model: identifiers currently loaded.
    const resident = new Set<string>();
    const listLoaded = vi.fn<() => Promise<readonly LoadedModel[]>>(
      async () =>
        [...resident].map((identifier) => ({ identifier, gpuResident: true })),
    );
    const load = vi.fn<
      (modelKey: string, options: LoadModelOptions) => Promise<void>
    >(async (_modelKey, options) => {
      resident.add(options.identifier);
    });
    const unload = vi.fn<(identifier: string) => Promise<void>>(
      async (identifier) => {
        resident.delete(identifier);
      },
    );
    const client = makeFakeClient(MLX_KEYS, {
      loadModel: load,
      unloadModel: unload,
      listLoaded,
    });

    // First profile load.
    const first = await loadProfile(profile, models, client, {
      contextLength: 8192,
    });
    expect(first.loaded).toEqual(DISTINCT);
    expect(first.partialGpu).toEqual([]);
    expect([...resident].sort()).toEqual([...DISTINCT].sort());

    // Switch: unload the old profile.
    await unloadProfile(profile, client);
    expect(resident.size).toBe(0);

    // Load a second profile (reusing the same shape here is fine — the point is
    // the sequence works and re-loads from an empty resident set).
    const second = await loadProfile(profile, models, client, {
      contextLength: 4096,
    });
    expect(second.loaded).toEqual(DISTINCT);
    expect(second.partialGpu).toEqual([]);
    // The second load re-loaded all three (resident set was emptied).
    const secondLoadContexts = load.mock.calls
      .slice(-3)
      .map(([, options]) => options.contextLength);
    expect(secondLoadContexts).toEqual([4096, 4096, 4096]);
  });
});
