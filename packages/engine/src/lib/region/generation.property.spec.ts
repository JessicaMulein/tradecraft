/**
 * Regional generation properties (multi-city task 3.5–3.7).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentSet, DifficultyPreset } from '@tradecraft/content';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
} from '@tradecraft/content';
import { generate, type GenerateInputs } from '../generate.js';
import { regionCatalog, type RegionCatalog } from './catalog.js';
import { generateRegion } from './generate.js';
import { loadRegionContent, regionSources } from './load.js';
import { regionGraphFor } from './verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, '..', '..', '..', '..', 'content', 'packs');
const FIXTURES = join(HERE, 'fixtures');
const CORE_DIR = join(PACKS, 'core');

const PRESETS = ['easy', 'standard', 'hard'] as const;

function recruitment(): ScenarioConfig['recruitment'] {
  return {
    pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
    firstContact: { a: 1, b: 1, c: 1, d: 1 },
    meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
    exposure: { k1: 1, k2: 1, k3: 1 },
    turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
  };
}

interface Pack {
  readonly content: ContentSet;
  readonly catalog: RegionCatalog;
  readonly template: string;
}

function loadPack(dirs: readonly string[], selected: string): Pack {
  const result = loadRegionContent(dirs, [selected]);
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join('\n'));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  const catalog = regionCatalog(regionSources(dirs, ids).sources);
  const template = [...catalog.templates.keys()][0];
  if (template === undefined) {
    throw new Error(`${selected} has no region template`);
  }
  return { content: result.value, catalog, template };
}

const fixture = loadPack(
  [
    join(PACKS, 'core'),
    join(PACKS, 'era-cold-war-early'),
    join(PACKS, 'lib-central-europe'),
    join(FIXTURES, 'fixture-north'),
    join(FIXTURES, 'fixture-east'),
    join(FIXTURES, 'fixture-south'),
    join(FIXTURES, 'fixture-west'),
    join(FIXTURES, 'region-fixture'),
  ],
  'region-fixture',
);

const coreRegion = loadPack(
  [
    join(PACKS, 'core'),
    join(PACKS, 'era-cold-war-early'),
    join(PACKS, 'lib-central-europe'),
    join(PACKS, 'lib-russian'),
    join(PACKS, 'lib-eastern-mediterranean'),
    join(PACKS, 'lib-western'),
    join(PACKS, 'city-vienna'),
    join(PACKS, 'city-berlin'),
    join(PACKS, 'city-trieste'),
    join(PACKS, 'region-core'),
  ],
  'region-core',
);

function difficulty(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function regional(catalog: RegionCatalog, id: string) {
  for (const value of catalog.presets.values()) {
    if (value.preset === id) {
      return value;
    }
  }
  throw new Error(`no regional preset ${id}`);
}

function scenario(template: string): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    region: { template },
    recruitment: recruitment(),
  });
}

const packs = [fixture, coreRegion] as const;

describe('regional generation properties', () => {
  it('Property 1: Regional determinism and stream independence', () => {
    // Feature: multi-city, Property 1: Regional determinism and stream independence
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.constantFrom(...PRESETS),
        fc.constantFrom(...packs),
        (seed, presetId, pack) => {
          const regionalPreset = regional(pack.catalog, presetId);
          const base = {
            seed,
            content: pack.content,
            catalog: pack.catalog,
            preset: difficulty(pack.content, presetId),
            regionalPreset,
            scenario: scenario(pack.template),
          };
          const first = generateRegion(base);
          const second = generateRegion(base);
          expect(second).toEqual(first);
          const order = first.region?.order ?? [];
          expect(order.length).toBeGreaterThanOrEqual(2);
          expect(order.length).toBeLessThanOrEqual(4);
          expect(order.length).toBeGreaterThanOrEqual(regionalPreset.cityCount.min);
          expect(order.length).toBeLessThanOrEqual(regionalPreset.cityCount.max);
          const principals = Object.values(first.npcs).filter((npc) => npc.role !== 'background');
          expect(principals.length).toBeLessThanOrEqual(48);
          for (const city of order) {
            const count = principals.filter((npc) => npc.id.includes(city.slice('city:'.length))).length;
            expect(count).toBeLessThanOrEqual(22);
          }
          const year = first.meta.setting.year;
          for (const cityId of Object.keys(pack.content.cities)) {
            const period = pack.content.cities[cityId]?.def.period;
            if (period === undefined) {
              continue;
            }
            if (first.region?.order.includes(`city:${cityId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`)) {
              expect(period.from).toBeLessThanOrEqual(year);
              expect(period.to).toBeGreaterThanOrEqual(year);
            }
          }
          const binding = first.plots?.[0]?.bindings ?? {};
          const hub = first.player.city;
          for (const [role, city] of Object.entries(binding)) {
            const constraint = pack.content.plotTemplatesV2?.get(
              [...(pack.content.plotTemplatesV2?.keys() ?? [])].find((id) => id.endsWith('/courier-line')) ?? '',
            )?.cityRoles?.[role];
            if (constraint?.not === 'hub') {
              expect(city).not.toBe(hub);
            }
          }
          const other = order[1];
          if (other === undefined) {
            return;
          }
          const shifted = generateRegion({ ...base, noiseAttempt: { [other]: 3 }, ambientAttempt: { [other]: 2 } });
          for (const city of order) {
            if (city === other) {
              expect(shifted.cityStreams?.ambient[city]).not.toEqual(first.cityStreams?.ambient[city]);
              continue;
            }
            expect(shifted.region?.cities[city]).toEqual(first.region?.cities[city]);
            expect(shifted.cityStreams?.spine[city]).toEqual(first.cityStreams?.spine[city]);
            expect(shifted.cityStreams?.ambient[city]).toEqual(first.cityStreams?.ambient[city]);
          }
          expect(shifted.cityStreams?.spine[other]).toEqual(first.cityStreams?.spine[other]);
          expect(shifted.region?.cities[other]).toEqual(first.region?.cities[other]);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it('Property 6: Regional solvability', () => {
    // Feature: multi-city, Property 6: Regional solvability
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.constantFrom(...PRESETS),
        fc.constantFrom(...packs),
        (seed, presetId, pack) => {
          const world = generateRegion({
            seed,
            content: pack.content,
            catalog: pack.catalog,
            preset: difficulty(pack.content, presetId),
            regionalPreset: regional(pack.catalog, presetId),
            scenario: scenario(pack.template),
          });
          const graph = regionGraphFor(seed);
          expect(graph).toBeDefined();
          if (graph === undefined || graph.brief === undefined) {
            return;
          }
          const held = new Set(
            (world.player.papers ?? [])
              .map((id) => world.travelDocs?.[id]?.kind)
              .filter((kind) => kind !== undefined),
          );
          expect([...graph.brief.papers].sort()).toEqual([...held].sort());
          expect(graph.brief.cities).toEqual(world.region?.order);
          for (const target of graph.targets) {
            const human = target.paths.find((path) => path.role === 'human');
            const signal = target.paths.find((path) => path.role === 'signal');
            expect(human).toBeDefined();
            expect(signal).toBeDefined();
            expect(human?.node).not.toBe(signal?.node);
            expect(human?.liaison === undefined || human.liaison !== signal?.liaison).toBe(true);
            for (const paper of human?.requiresPapers ?? []) {
              const known = new Set([...graph.papers, ...graph.obtainablePapers]);
              expect(known.has(paper)).toBe(true);
            }
          }
          const permitted =
            graph.jurisdiction.some((item) => item.permitsArrest) ||
            graph.handoffAt.length > 0 ||
            graph.abortRoutes.length > 0;
          expect(permitted).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});

describe('Property 2: Slice compatibility', () => {
  const core = loadContent([CORE_DIR], ['core']);
  if (!core.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core city data failed to load');
  }
  const standard = [...core.value.difficultyPresets.values()].find((item) => item.id === 'standard');
  if (standard === undefined) {
    throw new Error('no standard preset');
  }
  const sliceScenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: recruitment(),
  });
  const sliceInputs: GenerateInputs = {
    content: core.value,
    preset: standard,
    scenario: sliceScenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };

  it('a scenario with region unset matches the slice generator', () => {
    // Feature: multi-city, Property 2: Slice compatibility
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const first = generate(seed, sliceInputs);
        const second = generate(seed, sliceInputs);
        expect(second).toEqual(first);
        expect(first.region).toBeUndefined();
        expect(first.services).toBeUndefined();
        expect(first.locationOf).toBeUndefined();
        expect(first.cityStreams).toBeUndefined();
        expect(first.player.papers).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});
