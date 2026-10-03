import { describe, expect, it, vi } from 'vitest';

import type { ModelEntry, Profile } from '../config/models-config.js';
import type { DownloadedModel } from './client-interface.js';
import type { ModelMap } from './download-check.js';
import { preferredSource, resolveSource } from './download-check.js';
import { makeFakeClient } from './fake-client.js';
import {
  pullMissingModels,
  pullMissingModelsForClient,
  type PullAction,
} from './models-pull.js';

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

/** Distinct required Load Identifiers in first-appearance order: voice, fast, judge. */
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

/** A no-op pull spy that records the Source `get` arguments it was asked to pull. */
const makePullSpy = () => vi.fn<PullAction>(async () => undefined);

describe('pullMissingModels', () => {
  it('pulls the preferred (MLX) Source for each unresolved Load Identifier, in profile order', async () => {
    const pull = makePullSpy();
    // Only `voice` has a downloaded build → `fast` and `judge` are missing.
    const result = await pullMissingModels(profile, models, ['voice-mlx'], pull);

    // Pulled exactly the missing ones' preferred `get`, in first-appearance order.
    expect(result.pulled).toEqual(['org/fast-mlx', 'org/judge-mlx']);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(pull.mock.calls.map(([m]) => m)).toEqual([
      'org/fast-mlx',
      'org/judge-mlx',
    ]);
    // The commands are the byte-identical preferred-source `lms get` lines.
    expect(result.commands).toEqual([
      'lms get org/fast-mlx',
      'lms get org/judge-mlx',
    ]);
    // The required set is still the full distinct Load Identifier set.
    expect(result.required).toEqual(['voice', 'fast', 'judge']);
  });

  it('does NOT pull a Load Identifier that resolves via its GGUF fallback', async () => {
    const pull = makePullSpy();
    // `voice` resolves via its GGUF build (so it is NOT missing); only `fast`
    // and `judge` have neither build and must be pulled by their preferred MLX.
    const result = await pullMissingModels(
      profile,
      models,
      ['voice-gguf'],
      pull,
    );

    // The GGUF-resolved `voice` is skipped; the two unresolved ones are pulled.
    expect(result.pulled).toEqual(['org/fast-mlx', 'org/judge-mlx']);
    expect(pull.mock.calls.map(([m]) => m)).not.toContain('org/voice-mlx');
    expect(pull.mock.calls.map(([m]) => m)).not.toContain('org/voice-gguf');
  });

  it('downloads NOTHING when every Load Identifier already resolves', async () => {
    const pull = makePullSpy();
    const result = await pullMissingModels(
      profile,
      models,
      ['voice-mlx', 'fast-mlx', 'judge-mlx'],
      pull,
    );

    expect(pull).not.toHaveBeenCalled();
    expect(result.pulled).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.required).toEqual(['voice', 'fast', 'judge']);
  });

  it('pulls the build resolveSource reports missing, so pull and preflight agree byte-for-byte', async () => {
    const pull = makePullSpy();
    // `fast` is unresolved; its entry resolves to `missing` via resolveSource,
    // which carries the preferred (MLX) Source's `lms get` command.
    const resolution = resolveSource(models.fast, new Set(['voice-mlx']));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;

    const result = await pullMissingModels(profile, models, ['voice-mlx'], pull);

    // The pulled build's command is byte-identical to resolveSource's command,
    // and its `get` argument is the preferred Source's `get`.
    expect(result.commands).toContain(resolution.command);
    expect(result.pulled).toContain(preferredSource(models.fast).get);
    expect(resolution.command).toBe(
      `lms get ${preferredSource(models.fast).get}`,
    );
  });

  it('pulls a shared Load Identifier (fast backs three roles) exactly once', async () => {
    const pull = makePullSpy();
    // Nothing downloaded → all three distinct Load Identifiers missing; fast once.
    const result = await pullMissingModels(profile, models, [], pull);

    expect(result.pulled).toEqual([
      'org/voice-mlx',
      'org/fast-mlx',
      'org/judge-mlx',
    ]);
    const fastPulls = pull.mock.calls.filter(([m]) => m === 'org/fast-mlx');
    expect(fastPulls).toHaveLength(1);
  });
});

describe('pullMissingModelsForClient', () => {
  it('reads the downloaded set off the client, then pulls the missing models', async () => {
    const pull = makePullSpy();
    const listDownloadedModels = vi.fn<
      () => Promise<readonly DownloadedModel[]>
    >(async () => [{ modelKey: 'voice-mlx' }]);
    const client = makeFakeClient([], { listDownloadedModels });

    const result = await pullMissingModelsForClient(
      profile,
      models,
      client,
      pull,
    );

    expect(listDownloadedModels).toHaveBeenCalledTimes(1);
    expect(result.pulled).toEqual(['org/fast-mlx', 'org/judge-mlx']);
    expect(pull.mock.calls.map(([m]) => m)).toEqual([
      'org/fast-mlx',
      'org/judge-mlx',
    ]);
  });

  it('is the only path that downloads: never routes through an inference method', async () => {
    const pull = makePullSpy();
    const client = makeFakeClient(['voice-mlx', 'fast-mlx', 'judge-mlx']);

    await pullMissingModelsForClient(profile, models, client, pull);

    // Nothing to pull, and no inference surface exists on the client.
    expect(pull).not.toHaveBeenCalled();
    const surface = client as unknown as Record<string, unknown>;
    expect(surface.chat).toBeUndefined();
    expect(surface.complete).toBeUndefined();
  });
});
