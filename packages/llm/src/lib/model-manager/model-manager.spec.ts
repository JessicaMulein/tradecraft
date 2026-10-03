/**
 * Consolidated Model Manager acceptance tests (task 25.5; Requirements
 * 43.1–43.7, 21.7).
 *
 * The per-step specs (download-check, estimate-check, preflight, load-profile,
 * startup, models-pull) each pin their own narrow unit. This file is the one
 * place that exercises the Model Manager AS A WHOLE against a single faked SDK
 * client, driving `startModelManager` / `preflight` / `loadProfile` /
 * `unloadProfile` end-to-end so the acceptance behaviours of Req 43 (and the
 * Source resolution of Req 21.7) are each asserted at the integration level:
 *
 *   1. preflight reports an unresolved Load Identifier WITHOUT pulling (43.2)
 *   2. refuses an over-budget profile with the shortfall (43.3, 43.8)
 *   3. loads a shared-role Load Identifier once, by its resolved key (43.4, 21.7)
 *   4. warns on partial GPU residency (43.5)
 *   5. switches profiles via unload/load (43.6)
 *   6. inference is never routed through the SDK (43.7)
 *
 * A role now names a Load Identifier that resolves (through the config's
 * `models` map) to an MLX-preferred / GGUF-fallback Model Source; the fake's
 * downloaded set carries the MLX build keys, so every Load Identifier resolves
 * to its MLX Source. The fake is built here via {@link FakeClientHooks} and a
 * small in-memory residency model local to this spec; `fake-client.ts` itself
 * imports no test framework. All behaviour is deterministic and offline — no
 * process, no server and no real model are ever touched.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ModelEntry,
  ModelsConfig,
  Profile,
} from '../config/models-config.js';
import type {
  LmStudioClient,
  LoadModelOptions,
  LoadedModel,
  ResidentSetEstimate,
} from './client-interface.js';
import { makeFakeClient, type FakeClient } from './fake-client.js';
import { loadProfile, unloadProfile } from './load-profile.js';
import { preflight } from './preflight.js';
import { StartupError, startModelManager } from './startup.js';

const GiB = 1024 ** 3;

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

/** A model entry: `[mlx, gguf]` with keys `<id>-mlx` / `<id>-gguf`. */
const entry = (id: string): ModelEntry => ({
  family: 'gemma',
  sources: [
    { format: 'mlx', get: `org/${id}-mlx`, key: `${id}-mlx` },
    { format: 'gguf', get: `org/${id}-gguf`, key: `${id}-gguf` },
  ],
});

/** The MLX key of a Load Identifier (what the downloaded set carries). */
const mlx = (id: string) => `${id}-mlx`;

/**
 * Profile A: fast/narrator/bookkeeping all share `fast-a`, so the distinct set
 * is three Load Identifiers in first-appearance order.
 */
const profileA: Profile = {
  voice: role('voice-a'),
  fast: role('fast-a'),
  narrator: role('fast-a'),
  bookkeeping: role('fast-a'),
  judge: role('judge-a'),
};
const DISTINCT_A = ['voice-a', 'fast-a', 'judge-a'];

/** Profile B: a disjoint line-up, also with a shared fast Load Identifier. */
const profileB: Profile = {
  voice: role('voice-b'),
  fast: role('fast-b'),
  narrator: role('fast-b'),
  bookkeeping: role('fast-b'),
  judge: role('judge-b'),
};
const DISTINCT_B = ['voice-b', 'fast-b', 'judge-b'];

const models = {
  'voice-a': entry('voice-a'),
  'fast-a': entry('fast-a'),
  'judge-a': entry('judge-a'),
  'voice-b': entry('voice-b'),
  'fast-b': entry('fast-b'),
  'judge-b': entry('judge-b'),
};

const config: ModelsConfig = {
  endpoint: 'http://localhost:1234/v1',
  contextLength: 8192,
  models,
  profiles: { 'profile-a': profileA, 'profile-b': profileB },
  active: 'profile-a',
};

const noSleep = () => Promise.resolve();
const noopStart = () => Promise.resolve();
const connectTo = (client: LmStudioClient) => () => Promise.resolve(client);

/** A fitting estimate: whatever the set, it fits comfortably. */
const fits: ResidentSetEstimate = {
  fits: true,
  requiredBytes: 10 * GiB,
  availableBytes: 64 * GiB,
};

/**
 * An in-memory residency model shared across `loadModel` / `unloadModel` /
 * `listLoaded`, so a whole-flow test can watch the resident set transition the
 * way a real LM Studio instance would. Built here (not in the fixture) so the
 * fixture never imports vitest; the spies are `vi.fn()` so call counts and
 * arguments are assertable. `gpuOverrides` lets a test force a given identifier
 * to come up only partially GPU-resident.
 */
function makeResidencyFake(
  downloaded: readonly string[],
  options: {
    readonly estimate?: ResidentSetEstimate;
    readonly gpuOverrides?: Readonly<Record<string, boolean>>;
  } = {},
) {
  const resident = new Set<string>();
  const gpuOverrides = options.gpuOverrides ?? {};

  const loadModel = vi.fn<
    (modelKey: string, opts: LoadModelOptions) => Promise<void>
  >(async (_modelKey, opts) => {
    resident.add(opts.identifier);
  });
  const unloadModel = vi.fn<(identifier: string) => Promise<void>>(
    async (identifier) => {
      resident.delete(identifier);
    },
  );
  const listLoaded = vi.fn<() => Promise<readonly LoadedModel[]>>(async () =>
    [...resident].map((identifier) => ({
      identifier,
      gpuResident: gpuOverrides[identifier] ?? true,
    })),
  );
  const estimateResidentSet = vi.fn<
    (keys: readonly string[], ctx: number) => Promise<ResidentSetEstimate>
  >(async () => options.estimate ?? fits);
  const pull = vi.fn<() => Promise<unknown>>(async () => undefined);

  const client = makeFakeClient(downloaded, {
    estimateResidentSet,
    loadModel,
    unloadModel,
    listLoaded,
    pull,
  });

  return {
    client,
    resident,
    loadModel,
    unloadModel,
    listLoaded,
    estimateResidentSet,
    pull,
  };
}

/**
 * The inference-shaped method names the management surface must NOT expose. The
 * Gateway runs inference over the OpenAI endpoint; the SDK client is management
 * only (Requirement 43.7).
 */
const INFERENCE_METHODS = [
  'chat',
  'complete',
  'completion',
  'completions',
  'respond',
  'response',
  'generate',
  'infer',
  'inference',
  'predict',
  'embed',
  'embeddings',
] as const;

/** Assert the client exposes no inference-shaped method of any kind. */
function expectNoInferenceSurface(client: FakeClient): void {
  const surface = client as unknown as Record<string, unknown>;
  for (const name of INFERENCE_METHODS) {
    expect(surface[name], `client must not expose "${name}"`).toBeUndefined();
  }
}

describe('Model Manager (consolidated acceptance, Req 43.1–43.7, 21.7)', () => {
  it('1. preflight reports an unresolved Load Identifier WITHOUT pulling (43.2)', async () => {
    // `fast-a` has neither build downloaded.
    const fake = makeResidencyFake([mlx('voice-a'), mlx('judge-a')]);

    const result = await preflight(profileA, models, fake.client, {
      contextLength: 8192,
    });

    // The missing Load Identifier is named, with its preferred `lms get`.
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['fast-a']);
    expect(result.issues.join('\n')).toContain('lms get org/fast-a-mlx');

    // The never-call guard: preflight never pulled, and loaded nothing.
    expect(fake.pull).not.toHaveBeenCalled();
    expect(fake.loadModel).not.toHaveBeenCalled();
    expect(fake.resident.size).toBe(0);

    // Driving the same situation through the full bootstrap refuses to start
    // (43.8) carrying the cause, and still never pulls or loads.
    const error = await startModelManager(config, {
      connect: connectTo(fake.client),
      startServer: noopStart,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StartupError);
    expect((error as StartupError).result.missing).toContain('fast-a');
    expect((error as StartupError).message).toContain('fast-a');
    expect(fake.pull).not.toHaveBeenCalled();
    expect(fake.loadModel).not.toHaveBeenCalled();
  });

  it('2. refuses an over-budget profile with the shortfall, and does NOT load (43.3, 43.8)', async () => {
    const overBudget: ResidentSetEstimate = {
      fits: false,
      requiredBytes: 80 * GiB,
      availableBytes: 64 * GiB,
    };
    // Everything downloaded, so the ONLY cause is the memory shortfall.
    const fake = makeResidencyFake(DISTINCT_A.map(mlx), {
      estimate: overBudget,
    });

    // preflight alone reports not-ok with the shortfall figures.
    const result = await preflight(profileA, models, fake.client, {
      contextLength: 8192,
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.estimatedBytes).toBe(80 * GiB);
    expect(result.fitsBytes).toBe(64 * GiB);
    expect(result.estimatedBytes).toBeGreaterThan(result.fitsBytes);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('short by');

    // Through the full bootstrap: it throws StartupError carrying the issues,
    // and loadProfile did NOT run (no loadModel calls, nothing resident).
    const error = await startModelManager(config, {
      connect: connectTo(fake.client),
      startServer: noopStart,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StartupError);
    const se = error as StartupError;
    expect(se.result.ok).toBe(false);
    expect(se.result.issues.join('\n')).toContain('short by');
    expect(fake.loadModel).not.toHaveBeenCalled();
    expect(fake.resident.size).toBe(0);
  });

  it('3. loads a shared-role Load Identifier once by its resolved key, unloads once (43.4, 21.7)', async () => {
    const fake = makeResidencyFake(DISTINCT_A.map(mlx));

    const started = await startModelManager(config, {
      connect: connectTo(fake.client),
      startServer: noopStart,
      sleep: noSleep,
    });

    // fast-a backs three roles but is loaded once: three distinct loads total.
    expect(started.load.loaded).toEqual(DISTINCT_A);
    expect(fake.loadModel).toHaveBeenCalledTimes(3);
    const fastLoads = fake.loadModel.mock.calls.filter(
      ([, opts]) => opts.identifier === 'fast-a',
    );
    expect(fastLoads).toHaveLength(1);
    expect([...fake.resident].sort()).toEqual([...DISTINCT_A].sort());

    // Each loaded by its resolved MLX key, under its Load Identifier.
    for (const loadId of DISTINCT_A) {
      expect(fake.loadModel).toHaveBeenCalledWith(
        mlx(loadId),
        expect.objectContaining({ identifier: loadId, contextLength: 8192 }),
      );
    }

    // Unload tears the shared Load Identifier down exactly once (not per role).
    const unloaded = await unloadProfile(profileA, fake.client);
    expect(unloaded).toEqual(DISTINCT_A);
    expect(fake.unloadModel).toHaveBeenCalledTimes(3);
    const fastUnloads = fake.unloadModel.mock.calls.filter(
      ([identifier]) => identifier === 'fast-a',
    );
    expect(fastUnloads).toHaveLength(1);
    expect(fake.resident.size).toBe(0);
  });

  it('4. warns, by Load Identifier, on a partially-GPU-resident model (43.5)', async () => {
    // After loading, fast-a comes up only partially on the GPU.
    const fake = makeResidencyFake(DISTINCT_A.map(mlx), {
      gpuOverrides: { 'fast-a': false },
    });

    const started = await startModelManager(config, {
      connect: connectTo(fake.client),
      startServer: noopStart,
      sleep: noSleep,
    });

    // The post-load residency finding lives on the load result.
    expect(started.load.partialGpu).toEqual(['fast-a']);
    expect(started.load.warnings).toHaveLength(1);
    expect(started.load.warnings[0]).toContain('fast-a');
    // The fully-resident models are not warned about.
    expect(started.load.warnings.join('\n')).not.toContain('voice-a');
    expect(started.load.warnings.join('\n')).not.toContain('judge-a');
  });

  it('5. switches profiles via unload/load, transitioning the resident set (43.6)', async () => {
    // One client whose downloaded set covers BOTH profiles' models, so the eval
    // harness can switch between them. One in-memory residency set, shared
    // across load/unload/listLoaded, is the ground truth we watch.
    const fake = makeResidencyFake([
      ...DISTINCT_A.map(mlx),
      ...DISTINCT_B.map(mlx),
    ]);

    // Load profile A.
    const loadedA = await loadProfile(profileA, models, fake.client, {
      contextLength: 8192,
    });
    expect(loadedA.loaded).toEqual(DISTINCT_A);
    expect([...fake.resident].sort()).toEqual([...DISTINCT_A].sort());

    // Unload profile A: its models leave residency.
    await unloadProfile(profileA, fake.client);
    for (const id of DISTINCT_A) {
      expect(fake.resident.has(id)).toBe(false);
    }
    expect(fake.resident.size).toBe(0);

    // Load profile B: B's models become resident, A's stay gone.
    const loadedB = await loadProfile(profileB, models, fake.client, {
      contextLength: 8192,
    });
    expect(loadedB.loaded).toEqual(DISTINCT_B);
    expect([...fake.resident].sort()).toEqual([...DISTINCT_B].sort());
    for (const id of DISTINCT_A) {
      expect(fake.resident.has(id)).toBe(false);
    }
    for (const id of DISTINCT_B) {
      expect(fake.resident.has(id)).toBe(true);
    }
  });

  it('6. never routes inference through the SDK across the whole flow (43.7)', async () => {
    const fake = makeResidencyFake([
      ...DISTINCT_A.map(mlx),
      ...DISTINCT_B.map(mlx),
    ]);

    // Drive the entire management lifecycle: preflight → start → load → switch.
    await preflight(profileA, models, fake.client, { contextLength: 8192 });
    const started = await startModelManager(config, {
      connect: connectTo(fake.client),
      startServer: noopStart,
      sleep: noSleep,
    });
    await unloadProfile(profileA, fake.client);
    await loadProfile(profileB, models, fake.client, { contextLength: 8192 });

    // No inference-shaped method exists on the client surface at any point.
    expectNoInferenceSurface(fake.client);

    // Only management methods are present — the surface used end-to-end.
    expect(typeof fake.client.listDownloadedModels).toBe('function');
    expect(typeof fake.client.estimateResidentSet).toBe('function');
    expect(typeof fake.client.loadModel).toBe('function');
    expect(typeof fake.client.unloadModel).toBe('function');
    expect(typeof fake.client.listLoaded).toBe('function');

    // And a resident model is the Gateway's to run over the OpenAI endpoint —
    // the start result exposes the connected client but no inference entry.
    expectNoInferenceSurface(started.client as FakeClient);
  });
});
