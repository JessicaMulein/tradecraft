/**
 * Regional timings in the metrics log (multi-city task 14.1; Req 19.7).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ContentSet, DifficultyPreset } from '@tradecraft/content';
import { afterEach, describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { advanceRegion, arrive, initialRegionClock } from '../fidelity/clock.js';
import { referenceCity, referenceSimulator } from '../fidelity/reference.js';
import type { CityId } from '../fidelity/types.js';
import { createPrng, type PrngState } from '../prng/prng.js';
import { cityAmbientSeed, citySpineSeed } from './streams.js';
import { regionCatalog, type RegionCatalog } from './catalog.js';
import { generateRegion } from './generate.js';
import { loadRegionContent, regionSources } from './load.js';
import {
  flushRegionMetrics,
  setRegionMetricsSink,
  type RegionTimingRecord,
} from './metrics-log.js';

const CITIES = ['city:alpha', 'city:bravo'] as const satisfies readonly CityId[];

const PACKS = join(import.meta.dirname, '../../../../content/packs');
const FIXTURES = join(import.meta.dirname, 'fixtures');

function show(errors: readonly { pack: string; file: string; path: string; message: string }[]): string {
  return errors.map((error) => `${error.pack}/${error.file}:${error.path} ${error.message}`).join('\n');
}

function loaded(): { content: ContentSet; catalog: RegionCatalog } {
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
    throw new Error(show(result.errors));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  const sources = regionSources(dirs, ids);
  return { content: result.value, catalog: regionCatalog(sources.sources) };
}

const pack = loaded();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of pack.content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function regional(id: string) {
  for (const value of pack.catalog.presets.values()) {
    if (value.preset === id) {
      return value;
    }
  }
  throw new Error(`no regional preset ${id}`);
}

function scenario(enabled: boolean): ScenarioConfig {
  const template = [...pack.catalog.templates.keys()][0] ?? 'central-1953';
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    region: { template },
    metrics: { enabled, path: 'logs/metrics.jsonl' },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function clock() {
  const spine: Record<CityId, PrngState> = {};
  const ambientStreams: Record<CityId, PrngState> = {};
  const ambient: Record<CityId, ReturnType<typeof referenceCity>> = {};
  CITIES.forEach((city, index) => {
    spine[city] = createPrng(citySpineSeed('metrics', index)).state();
    ambientStreams[city] = createPrng(cityAmbientSeed('metrics', index)).state();
    ambient[city] = referenceCity(city);
  });
  return initialRegionClock({
    seed: 'metrics',
    order: CITIES,
    playerCity: 'city:alpha',
    ambient,
    spine,
    ambientStreams,
  });
}

afterEach(() => {
  setRegionMetricsSink(undefined);
});

describe('region metrics log', () => {
  it('records generation, coarse and full advance, and reconciliation', () => {
    const records: RegionTimingRecord[] = [];
    setRegionMetricsSink({ append: (record) => records.push(record) });
    const metrics = { enabled: true, path: 'logs/metrics.jsonl' };

    generateRegion({
      seed: 'metrics-generate',
      content: pack.content,
      catalog: pack.catalog,
      preset: preset('standard'),
      regionalPreset: regional('standard'),
      scenario: scenario(true),
    });
    const stepped = advanceRegion(clock(), referenceSimulator(), { metrics, debug: false });
    arrive(stepped, 'city:bravo', [], referenceSimulator(), { metrics, debug: false });

    const purposes = records.map((record) => record.purpose);
    expect(purposes).toContain('region-generate');
    expect(purposes).toContain('region-advance-full');
    expect(purposes).toContain('region-advance-coarse');
    expect(purposes).toContain('region-reconcile');
    expect(records.every((record) => record.role === 'region' && record.model === 'sim')).toBe(true);
    const full = records.find((record) => record.purpose === 'region-advance-full');
    const coarse = records.find((record) => record.purpose === 'region-advance-coarse');
    expect(full?.city).toBe('city:alpha');
    expect(coarse?.city).toBe('city:bravo');
  });

  it('writes nothing when metrics are disabled', () => {
    const records: RegionTimingRecord[] = [];
    setRegionMetricsSink({ append: (record) => records.push(record) });
    const metrics = { enabled: false, path: 'logs/metrics.jsonl' };
    generateRegion({
      seed: 'metrics-off',
      content: pack.content,
      catalog: pack.catalog,
      preset: preset('standard'),
      regionalPreset: regional('standard'),
      scenario: scenario(false),
    });
    advanceRegion(clock(), referenceSimulator(), { metrics, debug: false });
    arrive(clock(), 'city:alpha', [], referenceSimulator(), { metrics, debug: false });
    expect(records).toEqual([]);
  });

  it('appends a JSONL line when the metrics path is explicit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tradecraft-region-metrics-'));
    const path = join(dir, 'metrics.jsonl');
    try {
      advanceRegion(clock(), referenceSimulator(), {
        metrics: { enabled: true, path },
        debug: false,
      });
      await flushRegionMetrics();
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines.length).toBe(CITIES.length);
      const parsed = JSON.parse(lines[0] ?? '{}') as RegionTimingRecord;
      expect(parsed.role).toBe('region');
      expect(parsed.purpose === 'region-advance-full' || parsed.purpose === 'region-advance-coarse').toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
