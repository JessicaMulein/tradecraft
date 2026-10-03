import { describe, expect, it, vi } from 'vitest';

import type { ModelEntry, Profile } from '../config/models-config.js';
import {
  checkDownloads,
  formatMissingDownloads,
  lmsGetCommand,
  preferredSource,
  resolveSource,
  type ModelMap,
} from './download-check.js';
import { makeFakeClient } from './fake-client.js';
import { requiredModels } from './required-models.js';

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

/** A profile whose roles name Load Identifiers; fast/narrator/bookkeeping share one. */
const profile: Profile = {
  voice: role('voice'),
  fast: role('fast'),
  narrator: role('fast'), // shares the fast Load Identifier
  bookkeeping: role('fast'),
  judge: role('judge'),
};

/**
 * A model entry: an `[mlx, gguf]` Source pair whose `key`s are
 * `<id>-mlx` / `<id>-gguf` and whose `get`s are `org/<id>-<fmt>`.
 */
const entry = (id: string): ModelEntry => ({
  family: 'gemma',
  sources: [
    { format: 'mlx', get: `org/${id}-mlx`, key: `${id}-mlx` },
    { format: 'gguf', get: `org/${id}-gguf`, key: `${id}-gguf` },
  ],
});

/** The `models` map for the profile's three distinct Load Identifiers. */
const models: ModelMap = {
  voice: entry('voice'),
  fast: entry('fast'),
  judge: entry('judge'),
};

describe('requiredModels', () => {
  it('de-duplicates shared Load Identifiers in first-appearance order', () => {
    expect(requiredModels(profile)).toEqual(['voice', 'fast', 'judge']);
  });
});

describe('resolveSource', () => {
  it('resolves to the MLX Source when its key is downloaded', () => {
    const result = resolveSource(
      entry('voice'),
      new Set(['voice-mlx', 'voice-gguf']),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.format).toBe('mlx');
    expect(result.source.key).toBe('voice-mlx');
  });

  it('prefers MLX even when both builds are downloaded', () => {
    const result = resolveSource(
      entry('voice'),
      new Set(['voice-gguf', 'voice-mlx']),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.format).toBe('mlx');
  });

  it('falls back to the GGUF Source when only GGUF is downloaded', () => {
    const result = resolveSource(entry('voice'), new Set(['voice-gguf']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.format).toBe('gguf');
    expect(result.source.key).toBe('voice-gguf');
  });

  it('reports missing with the preferred (MLX) `lms get` command when neither is downloaded', () => {
    const result = resolveSource(entry('voice'), new Set());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.command).toBe('lms get org/voice-mlx');
  });
});

describe('preferredSource', () => {
  it('is the MLX Source, the first element of the `[mlx, gguf]` tuple', () => {
    const source = preferredSource(entry('voice'));
    expect(source.format).toBe('mlx');
    expect(source.get).toBe('org/voice-mlx');
  });

  it("names the build resolveSource reports missing when neither is downloaded", () => {
    const e = entry('voice');
    const result = resolveSource(e, new Set());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.command).toBe(lmsGetCommand(preferredSource(e).get));
  });
});

describe('lmsGetCommand', () => {
  it('formats the exact `lms get` command for a Source `get` argument', () => {
    expect(lmsGetCommand('lmstudio-community/Qwen3.8-27B-MLX-4bit')).toBe(
      'lms get lmstudio-community/Qwen3.8-27B-MLX-4bit',
    );
  });
});

describe('checkDownloads', () => {
  it('is ok when every Load Identifier resolves to a downloaded Source (MLX)', () => {
    const result = checkDownloads(profile, models, [
      'voice-mlx',
      'fast-mlx',
      'judge-mlx',
    ]);
    expect(result.ok).toBe(true);
    expect([...result.required].sort()).toEqual(['fast', 'judge', 'voice']);
  });

  it('is ok when a Load Identifier resolves via its GGUF fallback', () => {
    // voice has only its GGUF build downloaded; it still resolves.
    const result = checkDownloads(profile, models, [
      'voice-gguf',
      'fast-mlx',
      'judge-mlx',
    ]);
    expect(result.ok).toBe(true);
  });

  it('is not ok and lists the preferred-source command for one unresolved Load Identifier', () => {
    const result = checkDownloads(profile, models, ['voice-mlx', 'fast-mlx']);
    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow for TypeScript
    expect(result.missing).toEqual([
      { model: 'judge', command: 'lms get org/judge-mlx' },
    ]);
  });

  it('lists a shared unresolved Load Identifier once, not once per role', () => {
    // fast backs fast, narrator and bookkeeping, but must appear once.
    const result = checkDownloads(profile, models, ['voice-mlx', 'judge-mlx']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual([
      { model: 'fast', command: 'lms get org/fast-mlx' },
    ]);
  });

  it('lists every unresolved Load Identifier with its command when nothing is downloaded', () => {
    const result = checkDownloads(profile, models, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing.map((m) => m.command)).toEqual([
      'lms get org/voice-mlx',
      'lms get org/fast-mlx',
      'lms get org/judge-mlx',
    ]);
  });

  it('does not resolve a Load Identifier when only a different build is downloaded', () => {
    // `fast-mlx-v2` is neither the MLX nor the GGUF key of `fast`.
    const result = checkDownloads(profile, models, [
      'voice-mlx',
      'fast-mlx-v2',
      'judge-mlx',
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing.map((m) => m.model)).toEqual(['fast']);
  });

  it('never pulls: reads the downloaded set and never calls a download method', async () => {
    // Inject spies so we can assert the check only *reads* the downloaded set
    // and never attempts a download; the fixture itself imports no test lib.
    const listDownloadedModels = vi.fn(async () => [{ modelKey: 'voice-mlx' }]);
    const pull = vi.fn(async () => undefined);
    const client = makeFakeClient(['voice-mlx'], {
      listDownloadedModels,
      pull,
    });
    const downloaded = (await client.listDownloadedModels()).map(
      (m) => m.modelKey,
    );

    const result = checkDownloads(profile, models, downloaded);

    expect(result.ok).toBe(false);
    // It read the downloaded set exactly once...
    expect(listDownloadedModels).toHaveBeenCalledTimes(1);
    // ...and never attempted a download of any kind.
    expect(pull).not.toHaveBeenCalled();
  });
});

describe('formatMissingDownloads', () => {
  it('renders one `lms get` command per line', () => {
    const result = checkDownloads(profile, models, ['voice-mlx']);
    expect(formatMissingDownloads(result)).toBe(
      'lms get org/fast-mlx\nlms get org/judge-mlx',
    );
  });

  it('is the empty string when nothing is missing', () => {
    const result = checkDownloads(profile, models, [
      'voice-mlx',
      'fast-mlx',
      'judge-mlx',
    ]);
    expect(formatMissingDownloads(result)).toBe('');
  });
});
