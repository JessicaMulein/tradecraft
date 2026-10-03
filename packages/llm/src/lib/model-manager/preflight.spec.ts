import { describe, expect, it, vi } from 'vitest';

import type { ModelEntry, Profile } from '../config/models-config.js';
import type { ResidentSetEstimate } from './client-interface.js';
import type { ModelMap } from './download-check.js';
import { makeFakeClient } from './fake-client.js';
import { preflight } from './preflight.js';

const GiB = 1024 ** 3;

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

/** fast/narrator/bookkeeping share the `fast` Load Identifier → 3 distinct ids. */
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

/** The MLX build keys, which the "downloaded" set carries. */
const DOWNLOADED = ['voice-mlx', 'fast-mlx', 'judge-mlx'];
/** The resolved Source keys, in required order — all MLX when all are present. */
const RESOLVED_KEYS = ['voice-mlx', 'fast-mlx', 'judge-mlx'];

/** A context-sensitive estimate: weights fixed per model, KV cache scales with context. */
const estimateHook =
  (opts: { availableBytes: number; weightsPerModel: number; kvPerToken: number }) =>
  async (
    modelKeys: readonly string[],
    contextLength: number,
  ): Promise<ResidentSetEstimate> => {
    const requiredBytes = modelKeys.reduce(
      (sum) => sum + opts.weightsPerModel + opts.kvPerToken * contextLength,
      0,
    );
    return {
      fits: requiredBytes <= opts.availableBytes,
      requiredBytes,
      availableBytes: opts.availableBytes,
    };
  };

describe('preflight', () => {
  it('sizes only the models not already loaded under their Load Identifier', async () => {
    const sized: string[][] = [];
    const client = makeFakeClient(DOWNLOADED, {
      // Only 12 GiB free: enough for one more model, not for all three.
      estimateResidentSet: (keys, ctx) => {
        sized.push([...keys]);
        return estimateHook({ availableBytes: 12 * GiB, weightsPerModel: 10 * GiB, kvPerToken: 1 })(keys, ctx);
      },
      listLoaded: () =>
        Promise.resolve([
          { identifier: 'voice', gpuResident: true },
          { identifier: 'fast', gpuResident: true },
        ]),
    });

    const result = await preflight(profile, models, client, { contextLength: 8192 });

    expect(sized).toEqual([['judge-mlx']]);
    expect(result.ok).toBe(true);
  });

  it('needs no estimate when every model is already loaded', async () => {
    const estimate = vi.fn();
    const client = makeFakeClient(DOWNLOADED, {
      estimateResidentSet: estimate,
      listLoaded: () =>
        Promise.resolve(['voice', 'fast', 'judge'].map((identifier) => ({ identifier, gpuResident: true }))),
    });

    const result = await preflight(profile, models, client, { contextLength: 8192 });

    expect(estimate).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('is ok when downloads are present and the estimate fits', async () => {
    const client = makeFakeClient(DOWNLOADED, {
      estimateResidentSet: estimateHook({
        availableBytes: 64 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    });

    const result = await preflight(profile, models, client, {
      contextLength: 8192,
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.partialGpu).toEqual([]);
    expect(result.estimatedBytes).toBeLessThanOrEqual(result.fitsBytes);
  });

  it('is not ok with the shortfall when the estimate overflows', async () => {
    const client = makeFakeClient(DOWNLOADED, {
      estimateResidentSet: estimateHook({
        availableBytes: 16 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    });

    const result = await preflight(profile, models, client, {
      contextLength: 8192,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.estimatedBytes).toBeGreaterThan(result.fitsBytes);
    // Exactly one cause — the memory shortfall — naming the deficit.
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('short by');
  });

  it('reports BOTH causes when a Load Identifier is unresolved AND the estimate overflows', async () => {
    // `judge` has neither build downloaded, and the set is over the 16 GiB budget.
    const client = makeFakeClient(['voice-mlx', 'fast-mlx'], {
      estimateResidentSet: estimateHook({
        availableBytes: 16 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    });

    const result = await preflight(profile, models, client, {
      contextLength: 8192,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['judge']);
    // Two distinct causes, not stopping at the first.
    expect(result.issues).toHaveLength(2);
    expect(result.issues.join('\n')).toContain('lms get org/judge-mlx');
    expect(result.issues.join('\n')).toContain('short by');
  });

  it('sizes the estimate at the configured context length — a bigger context needs more memory', async () => {
    const hook = estimateHook({
      availableBytes: 64 * GiB,
      weightsPerModel: 10 * GiB,
      kvPerToken: 1024,
    });
    const spy = vi.fn(hook);
    const client = makeFakeClient(DOWNLOADED, { estimateResidentSet: spy });

    const small = await preflight(profile, models, client, {
      contextLength: 4096,
    });
    const large = await preflight(profile, models, client, {
      contextLength: 16384,
    });

    // The resolved Source keys and context length are threaded to the estimate...
    expect(spy).toHaveBeenNthCalledWith(1, RESOLVED_KEYS, 4096);
    expect(spy).toHaveBeenNthCalledWith(2, RESOLVED_KEYS, 16384);
    // ...and a larger context raises the estimated resident set.
    expect(large.estimatedBytes).toBeGreaterThan(small.estimatedBytes);
  });

  it('sizes the resident set over the resolved Source keys (shared model once)', async () => {
    const spy = vi.fn(
      estimateHook({
        availableBytes: 64 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    );
    const client = makeFakeClient(DOWNLOADED, { estimateResidentSet: spy });

    await preflight(profile, models, client, { contextLength: 8192 });

    // `fast` backs three roles but is sized once: 3 distinct resolved keys.
    expect(spy).toHaveBeenCalledWith(RESOLVED_KEYS, 8192);
  });

  it('estimates over the GGUF key when only the GGUF build is downloaded', async () => {
    // `voice` resolves to its GGUF build; the other two to MLX.
    const spy = vi.fn(
      estimateHook({
        availableBytes: 64 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    );
    const client = makeFakeClient(['voice-gguf', 'fast-mlx', 'judge-mlx'], {
      estimateResidentSet: spy,
    });

    await preflight(profile, models, client, { contextLength: 8192 });

    expect(spy).toHaveBeenCalledWith(
      ['voice-gguf', 'fast-mlx', 'judge-mlx'],
      8192,
    );
  });

  it('sizes an unresolved Load Identifier over its preferred (MLX) build', async () => {
    // Nothing downloaded: every key is unresolved, so the estimate sizes the
    // preferred MLX build for each, even though the download cause also blocks.
    const spy = vi.fn(
      estimateHook({
        availableBytes: 64 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    );
    const client = makeFakeClient([], { estimateResidentSet: spy });

    await preflight(profile, models, client, { contextLength: 8192 });

    expect(spy).toHaveBeenCalledWith(RESOLVED_KEYS, 8192);
  });

  it('never pulls and never routes inference through the client', async () => {
    const pull = vi.fn(async () => undefined);
    const client = makeFakeClient(['voice-mlx', 'fast-mlx'], {
      pull,
      estimateResidentSet: estimateHook({
        availableBytes: 64 * GiB,
        weightsPerModel: 10 * GiB,
        kvPerToken: 1024,
      }),
    });

    await preflight(profile, models, client, { contextLength: 8192 });

    // A missing model fails-and-reports; it is never pulled.
    expect(pull).not.toHaveBeenCalled();
    // The management client exposes no inference method to route a call through.
    const surface = client as unknown as Record<string, unknown>;
    expect(surface.chat).toBeUndefined();
    expect(surface.complete).toBeUndefined();
    expect(surface.respond).toBeUndefined();
    expect(surface.completion).toBeUndefined();
    // Only management methods are present.
    expect(typeof client.listDownloadedModels).toBe('function');
    expect(typeof client.estimateResidentSet).toBe('function');
  });
});
