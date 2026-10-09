/**
 * Regional play wiring: the turn clock draws city spines and the service day
 * only when a world has a region, and authored sector lines bind onto cities.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCityData, type ContentSet, type DifficultyPreset } from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { advanceWorld } from '../clock/advance-world.js';
import { buildWorldHooks } from '../clock/world-hooks.js';
import type { AdvanceWorldDeps } from '../clock/world-types.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { regionCatalog, type RegionCatalog } from './catalog.js';
import { generateRegion } from './generate.js';
import { loadRegionContent, regionSources } from './load.js';
import { foldRegionNotices, stepRegionPhase } from './play-clock.js';
import { regionTruth } from './mystery.js';
import { revealTruth } from '../model/core.js';
import { createPrng } from '../prng/prng.js';
import { TruthStore } from '../truth/truth.js';

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

function loaded(dirs: readonly string[], id: string): { content: ContentSet; catalog: RegionCatalog } {
  const result = loadRegionContent(dirs, [id]);
  if (!result.ok) {
    throw new Error(show(result.errors));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  const sources = regionSources(dirs, ids);
  if (sources.errors.length > 0) {
    throw new Error(show(sources.errors));
  }
  return { content: result.value, catalog: regionCatalog(sources.sources) };
}

function preset(content: ContentSet, id: string): DifficultyPreset {
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
    region: { template, stationModel: 'regional' },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

const fixture = loaded(FIXTURE_DIRS, 'region-fixture');
const templateId = [...fixture.catalog.templates.keys()][0] ?? 'central-1953';

function regionWorld(seed: string) {
  return generateRegion({
    seed,
    content: fixture.content,
    catalog: fixture.catalog,
    preset: preset(fixture.content, 'standard'),
    regionalPreset: regional(fixture.catalog, 'standard'),
    scenario: scenario(templateId),
  });
}

describe('regional turn clock', () => {
  it('leaves a slice world and its events alone', () => {
    const world = regionWorld('slice-guard');
    const slice = { ...world, region: undefined, cityStreams: undefined, services: undefined };
    const events = [
      {
        id: 'evt:keep' as const,
        at: { day: 0, phase: 0 },
        visibility: 'player' as const,
        kind: 'public-announcement' as const,
        text: 'still here',
      },
    ];
    const stepped = stepRegionPhase(slice, { day: 1, phase: 0 }, true);
    expect(stepped.state).toBe(slice);
    expect(stepped.events).toEqual([]);
    const folded = foldRegionNotices(slice, events);
    expect(folded.state).toBe(slice);
    expect(folded.events).toEqual(events);
  });

  it('draws every city spine and runs the service day when a region is set', () => {
    const world = regionWorld('play-clock');
    const before = world.cityStreams?.spine;
    const stepped = stepRegionPhase(world, { day: 1, phase: 0 }, true);
    expect(stepped.state.cityStreams?.spine).not.toEqual(before);
    expect(stepped.state.services).toBeDefined();
    expect(stepped.state.player.city).toBe(world.player.city);
  });

  it('advances a regional world one phase without dropping the region', () => {
    const world = regionWorld('advance-region');
    const cityData = loadCityData(join(PACKS, 'core'));
    if (!cityData.ok) {
      throw new Error('core city data failed to load');
    }
    const truth = TruthStore.create(fixture.content.predicates.evaluators);
    const deps: AdvanceWorldDeps = {
      content: fixture.content,
      cityData: cityData.value,
      hooks: buildWorldHooks(),
      objectives: () => () => false,
      cipherKeys: worldCipherKeyLookup(world.meta.seed, world.documents),
      truth,
    };
    const before = world.cityStreams?.spine;
    const result = advanceWorld(world, 1, createPrng('runtime'), deps);
    expect(result.state.region?.order).toEqual(world.region?.order);
    expect(result.state.cityStreams?.spine).not.toEqual(before);
    expect(result.phasesSpent).toBe(1);
  });

  it('runs ambient life for the player city when the scenario enables it', () => {
    const world = generateRegion({
      seed: 'ambient-region',
      content: fixture.content,
      catalog: fixture.catalog,
      preset: preset(fixture.content, 'standard'),
      regionalPreset: regional(fixture.catalog, 'standard'),
      scenario: { ...scenario(templateId), ambient: { enabled: true, density: 'standard' } },
    });
    expect(world.ambient?.enabled).toBe(true);
    const cities = world.region?.order ?? [];
    expect(cities.every((city) => world.region?.cities[city]?.ambient !== undefined)).toBe(true);
    const stepped = stepRegionPhase(world, { day: 0, phase: 1 }, false);
    expect(stepped.state.ambient?.cityId).toBe(world.player.city);
  });
});

const REGION_DIRS = [
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
];

describe('central-1953 play content', () => {
  it('binds sector lines onto the cities that contain both sectors', () => {
    const central = loaded(REGION_DIRS, 'region-core');
    const world = generateRegion({
      seed: 'central-play',
      content: central.content,
      catalog: central.catalog,
      preset: preset(central.content, 'standard'),
      regionalPreset: regional(central.catalog, 'standard'),
      scenario: scenario('central-1953'),
    });
    const lines = Object.values(world.region?.cities ?? {}).flatMap((city) => city.sectorLines);
    expect(lines.length).toBeGreaterThan(0);
    const air = Object.values(world.region?.intercity ?? {}).find((route) => route.timetable === 'listed');
    expect(air?.departures?.length).toBe(3);
    expect(air?.departures?.every((slot) => slot.phase === 1)).toBe(true);
  });

  it('opens a lead the case can follow and keeps the leader plan in truth', () => {
    const central = loaded(REGION_DIRS, 'region-core');
    const world = generateRegion({
      seed: 'central-mystery',
      content: central.content,
      catalog: central.catalog,
      preset: preset(central.content, 'standard'),
      regionalPreset: regional(central.catalog, 'standard'),
      scenario: scenario('central-1953'),
    });
    const brief = world.documents['doc:cable/brief'];
    expect(brief?.asserts).toHaveLength(2);
    expect(brief?.asserts.includes('prop:region/plans')).toBe(false);
    const note = world.documents['doc:note/cell-note'];
    const orders = world.documents['doc:note/orders'];
    expect(note?.asserts.includes('prop:region/plans')).toBe(true);
    expect(orders?.asserts.includes('prop:region/plans')).toBe(true);
    expect(note?.obtainableAt?.[0]).not.toBe(orders?.obtainableAt?.[0]);
    const cell = Object.values(world.npcs).find((npc) => npc.role === 'cell');
    expect(cell?.schedule.entries).toHaveLength(28);
    expect(Object.keys(world.deadDrops).length).toBeGreaterThan(0);
    const truth = regionTruth(central.content, world);
    const leader = revealTruth(world.plot.leader);
    expect(
      truth.holds(
        {
          id: 'prop:region/plans',
          subject: leader,
          predicate: 'PLANS',
          object: { kind: 'text', value: 'the operation' },
        },
        world.time,
      ),
    ).toBe(true);
  });
});
