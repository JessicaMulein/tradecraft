/**
 * Era timeline: year lookup, a tension draw cached per year, cipher overlap
 * with the weakest-cipher fallback, and the doctrine shift clamped to [0, 1].
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DifficultyPreset } from '@tradecraft/content';
import { createPrng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { epochAt, eraOverrides, tensionAt } from './era.js';

const CORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'content',
  'packs',
  'core',
);

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(
  loaded.value,
  campaignSources([CORE], new Set(['core'])).sources,
);
const standard = loaded.value.difficultyPresets.get('core/standard');
const easy = loaded.value.difficultyPresets.get('core/easy');
if (standard === undefined || easy === undefined) {
  throw new Error('core difficulty presets missing');
}

describe('era timeline', () => {
  it('finds the core epoch for each year from 1948 through 1962', () => {
    const expected = [
      [1948, 'occupation-years'],
      [1950, 'occupation-years'],
      [1951, 'hardening'],
      [1955, 'hardening'],
      [1956, 'crisis-years'],
      [1958, 'crisis-years'],
      [1959, 'wall-years'],
      [1962, 'wall-years'],
    ] as const;
    for (const [year, id] of expected) {
      const found = epochAt(year, content.epochs);
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.value.id).toBe(id);
      }
    }
    expect(epochAt(1947, content.epochs).ok).toBe(false);
    expect(epochAt(1963, content.epochs).ok).toBe(false);
  });

  it('draws tension once per year and keeps it on the truth map', () => {
    const epoch = content.epochs.find((item) => item.id === 'occupation-years');
    if (epoch === undefined) {
      throw new Error('occupation-years missing');
    }
    const rng = createPrng('era-tension');
    const first = tensionAt(1949, epoch, rng, {});
    const [lo, hi] = epoch.tension;
    expect(first.tension).toBeGreaterThanOrEqual(lo);
    expect(first.tension).toBeLessThanOrEqual(hi);
    const state = rng.state();
    const again = tensionAt(1949, epoch, rng, first.tensionByYear);
    expect(again.tension).toBe(first.tension);
    expect(again.tensionByYear).toBe(first.tensionByYear);
    expect(rng.state()).toEqual(state);

    const zeroEpoch = { ...epoch, tension: [0, 0] as [number, number] };
    const zero = tensionAt(1948, zeroEpoch, rng, {});
    expect(zero.tension).toBe(0);
    const afterZero = rng.state();
    expect(tensionAt(1948, zeroEpoch, rng, zero.tensionByYear).tension).toBe(0);
    expect(rng.state()).toEqual(afterZero);
  });

  it('intersects ciphers and falls back to the weakest epoch cipher', () => {
    const epoch = content.epochs[0];
    if (epoch === undefined) {
      throw new Error('no epoch loaded');
    }
    const overlap = eraOverrides(epoch, 0.5, easy);
    expect(overlap.allowedCiphers).toEqual(easy.allowedCiphers);
    expect(overlap.allowedCiphers).not.toContain('otp');

    const onlyPad = { ...epoch, ciphers: ['otp' as const] };
    const fallback = eraOverrides(onlyPad, 0.5, easy);
    expect(fallback.allowedCiphers).toEqual(['otp']);

    const strength = ['caesar', 'columnar', 'vigenere', 'book', 'otp'] as const;
    for (const cipher of strength) {
      const outside = strength.find((kind) => kind !== cipher);
      if (outside === undefined) {
        continue;
      }
      const narrowed = { ...epoch, ciphers: [cipher] };
      const preset = {
        ...easy,
        allowedCiphers: [outside] as DifficultyPreset['allowedCiphers'],
      };
      expect(eraOverrides(narrowed, 0.5, preset).allowedCiphers).toEqual([cipher]);
    }
    const mixed = { ...epoch, ciphers: ['book' as const, 'caesar' as const] };
    const padOnly = { ...easy, allowedCiphers: ['otp'] as DifficultyPreset['allowedCiphers'] };
    expect(eraOverrides(mixed, 0.5, padOnly).allowedCiphers).toEqual(['caesar']);
  });

  it('shifts doctrine with tension and clamps each end into [0, 1]', () => {
    const epoch = content.epochs[0];
    if (epoch === undefined) {
      throw new Error('no epoch loaded');
    }
    const preset: DifficultyPreset = {
      ...standard,
      doctrine: {
        risk: { min: 0.05, max: 0.1 },
        security: { min: 0.9, max: 0.95 },
        deception: { min: 0.4, max: 0.5 },
      },
    };
    const low = eraOverrides(epoch, 0, preset, 0.5).doctrine;
    expect(low?.risk).toEqual({ min: 0, max: 0 });
    expect(low?.security).toEqual({ min: 0.65, max: 0.7 });
    const high = eraOverrides(epoch, 1, preset, 0.5).doctrine;
    expect(high?.security).toEqual({ min: 1, max: 1 });
    expect(high?.deception).toEqual({ min: 0.65, max: 0.75 });
  });
});
