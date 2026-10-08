/**
 * Property 19: for any year in 1948–1962 and any preset, allowed ciphers are
 * the epoch/preset overlap, or the epoch's weakest cipher when that overlap
 * is empty. Tension for a year stays inside the epoch and is stable once
 * cached. Shifted doctrine ends stay inside [0, 1].
 *
 * Core epochs allow every cipher, so the generated cipher lists are what make
 * an empty overlap possible. The year still selects the core epoch's tension.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DifficultyPreset } from '@tradecraft/content';
import { createPrng } from '@tradecraft/engine';
import fc from 'fast-check';
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

const CIPHERS = ['caesar', 'columnar', 'vigenere', 'book', 'otp'] as const;
type CipherKind = (typeof CIPHERS)[number];

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(
  loaded.value,
  campaignSources([CORE], new Set(['core'])).sources,
);
const presets = [...loaded.value.difficultyPresets.values()];
if (presets.length === 0 || content.epochs.length === 0) {
  throw new Error('core campaign content is missing presets or epochs');
}

function cipherList(): fc.Arbitrary<CipherKind[]> {
  return fc.subarray([...CIPHERS], { minLength: 1 }).map((kinds) => [...kinds]);
}

function unitRange(): fc.Arbitrary<{ min: number; max: number }> {
  return fc
    .tuple(
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
    )
    .map(([left, right]) => (left <= right ? { min: left, max: right } : { min: right, max: left }));
}

/** Preset order, then the weakest epoch cipher when nothing is shared. */
function expectedCiphers(epochCiphers: readonly CipherKind[], presetCiphers: readonly CipherKind[]): CipherKind[] {
  const allowed = new Set<string>(epochCiphers);
  const shared = presetCiphers.filter((cipher) => allowed.has(cipher));
  if (shared.length > 0) {
    return shared;
  }
  const weakest = CIPHERS.find((cipher) => allowed.has(cipher));
  return weakest === undefined ? [] : [weakest];
}

describe('era gating property', () => {
  it('keeps ciphers inside the epoch, tension stable, and doctrine inside [0, 1]', () => {
    // Feature: campaign-career, Property 19: Era gating
    fc.assert(
      fc.property(
        fc.record({
          year: fc.integer({ min: 1948, max: 1962 }),
          seed: fc.integer({ min: 1, max: 1_000_000 }),
          base: fc.constantFrom(...presets),
          epochCiphers: cipherList(),
          presetCiphers: cipherList(),
          doctrineScale: fc.double({ min: 0, max: 0.5, noNaN: true }),
          risk: unitRange(),
          security: unitRange(),
          deception: unitRange(),
        }),
        (sample) => {
          const found = epochAt(sample.year, content.epochs);
          expect(found.ok).toBe(true);
          if (!found.ok) {
            return;
          }
          const epoch = { ...found.value, ciphers: sample.epochCiphers };
          expect(sample.year).toBeGreaterThanOrEqual(epoch.years[0]);
          expect(sample.year).toBeLessThanOrEqual(epoch.years[1]);

          const rng = createPrng(`era:${sample.year}:${sample.seed}`);
          const drawn = tensionAt(sample.year, epoch, rng, {});
          const [lo, hi] = epoch.tension;
          expect(drawn.tension).toBeGreaterThanOrEqual(lo);
          expect(drawn.tension).toBeLessThanOrEqual(hi);
          const again = tensionAt(sample.year, epoch, createPrng('other-stream'), drawn.tensionByYear);
          expect(again.tension).toBe(drawn.tension);
          expect(again.tensionByYear).toEqual(drawn.tensionByYear);

          const preset: DifficultyPreset = {
            ...sample.base,
            allowedCiphers: sample.presetCiphers,
            doctrine: {
              risk: sample.risk,
              security: sample.security,
              deception: sample.deception,
            },
          };
          const overrides = eraOverrides(epoch, drawn.tension, preset, sample.doctrineScale);
          const allowed = overrides.allowedCiphers ?? [];
          expect(allowed).toEqual(expectedCiphers(sample.epochCiphers, sample.presetCiphers));
          for (const cipher of allowed) {
            expect(sample.epochCiphers).toContain(cipher);
          }

          const doctrine = overrides.doctrine;
          expect(doctrine).toBeDefined();
          if (doctrine === undefined) {
            return;
          }
          for (const range of [doctrine.risk, doctrine.security, doctrine.deception]) {
            const min = range?.min;
            const max = range?.max;
            expect(typeof min).toBe('number');
            expect(typeof max).toBe('number');
            if (typeof min !== 'number' || typeof max !== 'number') {
              continue;
            }
            expect(min).toBeGreaterThanOrEqual(0);
            expect(max).toBeLessThanOrEqual(1);
            expect(min).toBeLessThanOrEqual(max);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
