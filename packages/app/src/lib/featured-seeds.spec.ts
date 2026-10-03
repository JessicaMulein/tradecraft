/**
 * Featured seeds: loading the vetted list, drawing a seedless new game from
 * it, and catching a list that has gone stale against the current generator.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GENERATOR_VERSION } from '@tradecraft/engine';

import { WALK_REPO_ROOT } from './game-harness-config.js';
import {
  FEATURED_SEEDS_PATH,
  featuredSeedSource,
  loadFeaturedSeeds,
} from './featured-seeds.js';
import { vetSeed } from './playability-probe.js';
import type { ScriptedPreset } from './scripted-games.js';

const dirs: string[] = [];
function repoWith(contents: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'featured-seeds-'));
  dirs.push(root);
  if (contents !== undefined) {
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(root, FEATURED_SEEDS_PATH), contents, 'utf8');
  }
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadFeaturedSeeds', () => {
  it('reads the per-preset lists', () => {
    const root = repoWith(
      JSON.stringify({ presets: { easy: [{ seed: 'a', winDay: 10, finalDeadline: 30 }] } }),
    );
    expect(loadFeaturedSeeds(root)).toEqual({
      easy: [{ seed: 'a', winDay: 10, finalDeadline: 30 }],
    });
  });

  it('yields an empty list when the file is missing or malformed', () => {
    expect(loadFeaturedSeeds(repoWith(undefined))).toEqual({});
    expect(loadFeaturedSeeds(repoWith('{ not json'))).toEqual({});
    expect(loadFeaturedSeeds(repoWith(JSON.stringify({ presets: 3 })))).toEqual({});
  });

  it('drops entries without a seed', () => {
    const root = repoWith(JSON.stringify({ presets: { easy: [{ seed: '' }, { nope: 1 }, { seed: 'b' }] } }));
    expect(loadFeaturedSeeds(root).easy.map((e) => e.seed)).toEqual(['b']);
  });
});

describe('featuredSeedSource', () => {
  const featured = {
    easy: [
      { seed: 'e0', winDay: 1, finalDeadline: 2 },
      { seed: 'e1', winDay: 1, finalDeadline: 2 },
    ],
  };

  it('draws a featured seed for the preset', () => {
    expect(featuredSeedSource(featured, () => 1)('easy')).toBe('e1');
  });

  it('falls back to a random seed (undefined) for a preset with no list', () => {
    expect(featuredSeedSource(featured, () => 0)('hard')).toBeUndefined();
    expect(featuredSeedSource({}, () => 0)('easy')).toBeUndefined();
  });
});

describe('the shipped featured-seed list', () => {
  const shipped = loadFeaturedSeeds(WALK_REPO_ROOT);

  it('lists seeds for every preset', () => {
    for (const preset of ['easy', 'standard', 'hard']) {
      expect(shipped[preset]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('was vetted against the current generator (re-run `pnpm seeds:vet` if not)', async () => {
    const { readFileSync } = await import('node:fs');
    const file = JSON.parse(readFileSync(join(WALK_REPO_ROOT, FEATURED_SEEDS_PATH), 'utf8')) as {
      generatorVersion: string;
    };
    expect(file.generatorVersion).toBe(GENERATOR_VERSION);
    // Re-vet a sample: a change to the engine, the pack or the presets that
    // makes a featured seed unplayable fails here.
    for (const preset of ['easy', 'standard', 'hard'] as ScriptedPreset[]) {
      for (const entry of (shipped[preset] ?? []).slice(0, 2)) {
        const { ok } = await vetSeed(entry.seed, preset);
        expect(ok, `${preset} ${entry.seed} no longer vets; re-run pnpm seeds:vet`).toBe(true);
      }
    }
  }, 300_000);
});
