/**
 * Regional golden replay (multi-city task 14.3; Req 18.3, 1.6).
 *
 * One checked-in session per starter region in the fixture pack. The slice
 * loader only treats a directory with `session.json` as a slice golden, so
 * these sessions are not replayed through `createGame`. Slice goldens stay
 * on the slice generator.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ContentSet, DifficultyPreset } from '@tradecraft/content';
import {
  ScenarioConfigSchema,
  createPrng,
  generateRegion,
  loadRegionContent,
  regionCatalog,
  regionSources,
  resolve,
  type RegionCatalog,
  type WorldState,
} from '@tradecraft/engine';

import { REPLAYS_DIR } from './fixtures.js';

const PACKS = join(import.meta.dirname, '../../../../content/packs');
const FIXTURES = join(import.meta.dirname, '../../../../engine/src/lib/region/fixtures');

export interface RegionalGolden {
  readonly id: string;
  readonly seed: string;
  readonly template: string;
  readonly waits: number;
  readonly stateHash: string;
}

export interface RegionalReplay {
  readonly id: string;
  readonly stateHash: string;
  readonly cities: readonly string[];
}

let cached: { content: ContentSet; catalog: RegionCatalog } | undefined;

export function starterRegionCount(): number {
  return fixturePack().catalog.templates.size;
}

/** Directories under `replays/` that are regional goldens, not slice sessions. */
export function listRegionalGoldenIds(root: string = REPLAYS_DIR): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => existsSync(join(root, name, 'expected.json')))
    .filter((name) => !existsSync(join(root, name, 'session.json')))
    .sort();
}

export function loadRegionalGolden(id: string, root: string = REPLAYS_DIR): RegionalGolden {
  const parsed = JSON.parse(readFileSync(join(root, id, 'expected.json'), 'utf8')) as RegionalGolden;
  return parsed;
}

export function replayRegionalGolden(golden: Pick<RegionalGolden, 'seed' | 'template' | 'waits'>): RegionalReplay {
  const { content, catalog } = fixturePack();
  let world = generateRegion({
    seed: golden.seed,
    content,
    catalog,
    preset: difficulty(content, 'standard'),
    regionalPreset: standardPreset(catalog),
    scenario: scenario(golden.template),
  });
  const rng = createPrng(world.rng);
  for (let step = 0; step < golden.waits; step += 1) {
    const resolved = resolve(world, { kind: 'wait', phases: 1 }, rng, { content });
    world = { ...resolved.next, rng: rng.state() };
    world = tickHubSpine(world);
  }
  return {
    id: golden.template,
    stateHash: hashWorld(world),
    cities: world.region?.order ?? [],
  };
}

function tickHubSpine(world: WorldState): WorldState {
  const city = world.region?.order[0];
  const streams = world.cityStreams;
  if (city === undefined || streams === undefined) {
    return world;
  }
  const saved = streams.spine[city];
  if (saved === undefined) {
    return world;
  }
  const spine = createPrng(saved);
  spine.next();
  return {
    ...world,
    cityStreams: {
      spine: { ...streams.spine, [city]: spine.state() },
      ambient: streams.ambient,
    },
  };
}

function hashWorld(world: WorldState): string {
  return createHash('sha256').update(canonicalJson(world)).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      sorted[key] = sortValue(item);
    }
    return sorted;
  }
  return value;
}

function fixturePack(): { content: ContentSet; catalog: RegionCatalog } {
  if (cached !== undefined) {
    return cached;
  }
  const dirs = [
    join(PACKS, 'core'),
    join(PACKS, 'era-cold-war-early'),
    join(PACKS, 'lib-central-europe'),
    join(FIXTURES, 'fixture-north'),
    join(FIXTURES, 'fixture-east'),
    join(FIXTURES, 'fixture-south'),
    join(FIXTURES, 'fixture-west'),
    join(FIXTURES, 'region-fixture'),
  ];
  const result = loadRegionContent(dirs, ['region-fixture']);
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join('\n'));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  cached = {
    content: result.value,
    catalog: regionCatalog(regionSources(dirs, ids).sources),
  };
  return cached;
}

function difficulty(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function standardPreset(catalog: RegionCatalog) {
  for (const value of catalog.presets.values()) {
    if (value.preset === 'standard') {
      return value;
    }
  }
  throw new Error('no standard regional preset');
}

function scenario(template: string) {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    region: { template },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}
