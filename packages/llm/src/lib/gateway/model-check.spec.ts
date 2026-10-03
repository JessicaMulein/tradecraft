import { describe, expect, it } from 'vitest';

import type { Profile } from '../config/models-config.js';
import { checkModels, formatMissingRoles } from './model-check.js';

const role = (model: string) => ({
  model,
  temperature: 0.7,
  maxTokens: 200,
  timeoutMs: 8000,
  reasoning: 'off' as const,
});

const profile: Profile = {
  voice: role('voice-model'),
  fast: role('fast-model'),
  narrator: role('fast-model'), // shares the fast model
  bookkeeping: role('fast-model'),
  judge: role('voice-model'),
};

describe('checkModels', () => {
  it('passes when every role model is available', () => {
    const result = checkModels(profile, ['voice-model', 'fast-model']);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('de-duplicates the required model ids', () => {
    const result = checkModels(profile, ['voice-model', 'fast-model']);
    expect([...result.required].sort()).toEqual(['fast-model', 'voice-model']);
  });

  it('reports every role whose model is missing', () => {
    const result = checkModels(profile, ['voice-model']);
    expect(result.ok).toBe(false);
    // fast, narrator and bookkeeping all point at the absent fast-model.
    expect(result.missing.map((m) => m.role)).toEqual([
      'fast',
      'narrator',
      'bookkeeping',
    ]);
    for (const m of result.missing) {
      expect(m.model).toBe('fast-model');
    }
  });

  it('reports all roles when the endpoint serves nothing', () => {
    const result = checkModels(profile, []);
    expect(result.missing.map((m) => m.role)).toEqual([
      'voice',
      'fast',
      'narrator',
      'bookkeeping',
      'judge',
    ]);
  });

  it('matches model ids exactly', () => {
    const result = checkModels(profile, ['voice-model', 'fast-model-v2']);
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.model)).toContain('fast-model');
  });

  it('formats missing roles one per line', () => {
    const result = checkModels(profile, ['voice-model']);
    expect(formatMissingRoles(result)).toBe(
      'fast: fast-model\nnarrator: fast-model\nbookkeeping: fast-model',
    );
  });

  it('formats to the empty string when nothing is missing', () => {
    const result = checkModels(profile, ['voice-model', 'fast-model']);
    expect(formatMissingRoles(result)).toBe('');
  });
});
