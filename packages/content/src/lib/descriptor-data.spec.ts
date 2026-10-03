/**
 * Tests for the `descriptors.yaml` loader (task 5.2 support; Requirement 22.3).
 *
 * These load the real core pack's `descriptors.yaml` and check that the schema
 * accepts it, that the pools and shared blocks come through, and that the
 * loader reports a missing file and a malformed shape the way the engine
 * expects (a located error rather than a throw). The schema is deliberately
 * permissive, so the tests also pin the tolerated-gap behaviour: extra keys and
 * missing blocks validate.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  DESCRIPTOR_FILE,
  descriptorPoolIds,
  fittingPhrases,
  loadDescriptorData,
  normalizeEntries,
  parseDescriptorData,
} from './descriptor-data.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

describe('loadDescriptorData', () => {
  it('loads the core pack descriptors.yaml', () => {
    const result = loadDescriptorData(CORE_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const data = result.value;
    // The authored pools the archetypes draw from should be present.
    expect(Object.keys(data.pools).length).toBeGreaterThan(0);
    expect(data.pools['street-clothes']).toBeDefined();
    expect(data.pools['street-clothes'].garments.length).toBeGreaterThan(0);
    // Shared building blocks come through.
    expect(data.shared.build.length).toBeGreaterThan(0);
    expect(data.shared.grooming.length).toBeGreaterThan(0);
  });

  it('reports a missing file as a located error', () => {
    const result = loadDescriptorData(join(CORE_DIR, 'does-not-exist'));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].file).toBe(DESCRIPTOR_FILE);
  });
});

describe('parseDescriptorData', () => {
  it('tolerates missing blocks and extra keys', () => {
    const data = parseDescriptorData({
      pools: { 'street-clothes': { garments: ['a loden coat'] } },
      extra: 'ignored',
    });
    expect(data.pools['street-clothes'].garments).toEqual(['a loden coat']);
    // A missing shared block defaults to empty lists rather than failing.
    expect(data.shared.build).toEqual([]);
    // A missing accessories list defaults to empty.
    expect(data.pools['street-clothes'].accessories).toEqual([]);
  });

  it('rejects a non-string phrase', () => {
    expect(() =>
      parseDescriptorData({ pools: { x: { garments: [42] } } }),
    ).toThrow();
  });

  it('accepts entries with a fits tag and defaults an object entry to any', () => {
    const data = parseDescriptorData({
      pools: {
        dress: {
          garments: [
            'a loden coat',
            { text: 'a dirndl', fits: 'female' },
            { text: 'a pressed suit', fits: 'male' },
            { text: 'a raincoat' },
          ],
        },
      },
    });
    const normalized = normalizeEntries(data.pools.dress.garments);
    expect(normalized).toEqual([
      { text: 'a loden coat', fits: 'any' },
      { text: 'a dirndl', fits: 'female' },
      { text: 'a pressed suit', fits: 'male' },
      { text: 'a raincoat', fits: 'any' },
    ]);
  });

  it('rejects an unknown fits tag', () => {
    expect(() =>
      parseDescriptorData({ pools: { x: { garments: [{ text: 'a', fits: 'other' }] } } }),
    ).toThrow();
  });
});

describe('fittingPhrases', () => {
  const entries = [
    'a loden coat',
    { text: 'a dirndl', fits: 'female' as const },
    { text: 'a pressed suit', fits: 'male' as const },
  ];

  it('returns any-tagged and matching-gender entries only', () => {
    expect(fittingPhrases(entries, 'female')).toEqual(['a loden coat', 'a dirndl']);
    expect(fittingPhrases(entries, 'male')).toEqual(['a loden coat', 'a pressed suit']);
  });
});

describe('core pack descriptors.yaml fits tags (Req 1.7)', () => {
  it('every archetype-referenced pool offers fitting garments for both genders', () => {
    const result = loadDescriptorData(CORE_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const data = result.value;

    // Collect the descriptor pools the archetypes actually draw from — any
    // archetype may be stamped as either gender, so each referenced pool must
    // offer at least one fitting garment for both, or the generator would
    // produce an empty descriptor.
    const archetypes = parseYaml(
      readFileSync(join(CORE_DIR, 'archetypes.yaml'), 'utf8'),
    ) as Array<{ descriptorPools: string[] }>;
    const referenced = new Set<string>();
    for (const a of archetypes) {
      for (const p of a.descriptorPools) {
        referenced.add(p);
      }
    }

    for (const poolId of referenced) {
      const pool = data.pools[poolId];
      expect(pool, `pool "${poolId}" must be defined`).toBeDefined();
      for (const gender of ['female', 'male'] as const) {
        expect(
          fittingPhrases(pool.garments, gender).length,
          `pool "${poolId}" needs a ${gender} garment`,
        ).toBeGreaterThan(0);
      }
    }
    // Sanity: the task's named-missing pools are now all present.
    expect(referenced.size).toBeGreaterThan(0);
    expect(descriptorPoolIds(data)).toEqual(expect.arrayContaining([...referenced]));
  });

  it('authors gender-specific grooming notes', () => {
    const result = loadDescriptorData(CORE_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const femaleGrooming = fittingPhrases(result.value.shared.grooming, 'female');
    const maleGrooming = fittingPhrases(result.value.shared.grooming, 'male');
    expect(femaleGrooming).not.toEqual(maleGrooming);
  });
});
