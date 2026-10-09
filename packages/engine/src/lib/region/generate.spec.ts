/**
 * Region generator (multi-city task 3). Slice `generate` is not on this path.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentSet, DifficultyPreset } from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { GeneratorError } from '../generate.js';
import { regionCatalog, type RegionCatalog } from './catalog.js';
import { generateRegion } from './generate.js';
import { loadRegionContent, regionSources } from './load.js';
import { regionGraphFor } from './verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, '..', '..', '..', '..', 'content', 'packs');
const FIXTURES = join(HERE, 'fixtures');

const FIXTURE_DIRS = [
  join(PACKS, 'core'),
  join(PACKS, 'era-cold-war-early'),
  join(PACKS, 'lib-central-europe'),
  join(FIXTURES, 'fixture-north'),
  join(FIXTURES, 'fixture-east'),
  join(FIXTURES, 'fixture-south'),
  join(FIXTURES, 'fixture-west'),
  join(FIXTURES, 'region-fixture'),
];

function show(errors: readonly { pack: string; file: string; path: string; message: string }[]): string {
  return errors.map((error) => `${error.pack}/${error.file}:${error.path} ${error.message}`).join('\n');
}

function loaded(): { content: ContentSet; catalog: RegionCatalog } {
  const result = loadRegionContent(FIXTURE_DIRS, ['region-fixture']);
  if (!result.ok) {
    throw new Error(show(result.errors));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  const sources = regionSources(FIXTURE_DIRS, ids);
  return { content: result.value, catalog: regionCatalog(sources.sources) };
}

const { content, catalog } = loaded();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function regional(id: string) {
  for (const value of catalog.presets.values()) {
    if (value.preset === id) {
      return value;
    }
  }
  throw new Error(`no regional preset ${id}`);
}

function scenario(template: string, mole = false, stationModel: 'regional' | 'per-city' = 'regional'): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole,
    region: { template, stationModel },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

const TEMPLATE = [...catalog.templates.keys()][0] ?? 'central-1953';

function inputs(seed: string, mole = false) {
  return {
    seed,
    content,
    catalog,
    preset: preset('standard'),
    regionalPreset: regional('standard'),
    scenario: scenario(TEMPLATE, mole),
  };
}

describe('generateRegion', () => {
  it('binds the fixture cities, a rail handoff deadline and one cell per touched city', () => {
    const world = generateRegion(inputs('alpha'));
    expect(world.region?.order).toHaveLength(4);
    expect(world.region?.order.length).toBeGreaterThanOrEqual(2);
    expect(world.region?.order.length).toBeLessThanOrEqual(4);
    const principals = Object.values(world.npcs).filter((npc) => npc.role !== 'background');
    expect(principals.length).toBeLessThanOrEqual(48);
    const perCity = new Map<string, number>();
    for (const npc of principals) {
      const city = world.locationOf?.[npc.id];
      const key = city !== undefined && 'city' in city ? city.city : 'none';
      perCity.set(key, (perCity.get(key) ?? 0) + 1);
    }
    for (const count of perCity.values()) {
      expect(count).toBeLessThanOrEqual(22);
    }
    const binding = world.plots?.[0]?.bindings ?? {};
    const hub = world.player.city;
    expect(binding.A).not.toBe(hub);
    expect(binding.B).toBeDefined();
    const handoff = world.plot.stages.find((stage) => stage.handoff !== undefined || stage.requires.length > 0);
    expect(handoff?.deadline).toEqual({ day: 4, phase: 2 });
    const graph = regionGraphFor('alpha');
    const held = new Set(
      (world.player.papers ?? [])
        .map((id) => world.travelDocs?.[id]?.kind)
        .filter((kind) => kind !== undefined),
    );
    expect([...(graph?.brief?.papers ?? [])].sort()).toEqual([...held].sort());
    expect(graph?.brief?.cities).toEqual(world.region?.order);
  });

  it('places a mole only when the scenario asks, and a chief in every city for per-city stations', () => {
    const without = generateRegion(inputs('mole-off', false));
    expect(without.station.mole).toBeUndefined();
    const withMole = generateRegion(inputs('mole-on', true));
    expect(withMole.station.mole).toBe(withMole.station.chief);
    const perCity = generateRegion({
      ...inputs('stations'),
      scenario: scenario(TEMPLATE, false, 'per-city'),
    });
    const chiefs = Object.values(perCity.npcs).filter((npc) => npc.role === 'station-chief');
    expect(chiefs).toHaveLength(4);
  });

  it('raises GeneratorError naming the seed when no plot can bind', () => {
    const templates = new Map(
      [...catalog.templates].map(([id, template]) => [id, { ...template, plots: [] }]),
    );
    expect(() =>
      generateRegion({ ...inputs('no-plot'), catalog: { ...catalog, templates } }),
    ).toThrow(GeneratorError);
    try {
      generateRegion({ ...inputs('no-plot'), catalog: { ...catalog, templates } });
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorError);
      const failed = error as GeneratorError;
      expect(failed.seed).toBe('no-plot');
      expect(failed.attempts).toBe(regional('standard').verifierAttemptLimit);
      expect(failed.message).toContain('no-plot');
      expect(failed.phase).toBe('region');
    }
  });
});
