/**
 * Tests for the `city.yaml` loader (task 5.1 support): the core pack's
 * `city.yaml` validates and loads, and representative bad shapes are rejected
 * with a located error (Requirements 21.1, 21.6).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CityDataSchema, loadCityData, parseCityData } from './city-data.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

describe('loadCityData', () => {
  it('loads the core pack city.yaml cleanly', () => {
    const result = loadCityData(CORE_DIR);
    if (!result.ok) {
      throw new Error(
        `city.yaml failed to load:\n${result.errors
          .map((e) => `  ${e.file} ${e.path}: ${e.message}`)
          .join('\n')}`,
      );
    }
    expect(result.value.displayName).toBe('Vienna');
    expect(result.value.districts.length).toBeGreaterThanOrEqual(4);
    // Every district names a sector that exists in the sector list.
    const sectorIds = new Set(result.value.sectors.map((s) => s.id));
    for (const d of result.value.districts) {
      expect(sectorIds.has(d.sector)).toBe(true);
    }
  });

  it('carries weather seasons that cover every calendar month', () => {
    const result = loadCityData(CORE_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const covered = new Set<number>();
    for (const season of Object.values(result.value.weather.seasons)) {
      for (const month of season.months) {
        covered.add(month);
      }
    }
    for (let m = 1; m <= 12; m += 1) {
      expect(covered.has(m)).toBe(true);
    }
  });

  it('exposes the name pools Location Type patterns draw from', () => {
    const result = loadCityData(CORE_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.namePools['cafe-names']?.length).toBeGreaterThan(0);
    expect(result.value.streets['waterfront']?.length).toBeGreaterThan(0);
  });

  it('returns a located error for a missing file', () => {
    const result = loadCityData(join(CORE_DIR, 'does-not-exist'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].file).toBe('city.yaml');
  });
});

describe('CityDataSchema / parseCityData', () => {
  const minimal = {
    id: 'test-city',
    displayName: 'Testville',
    districts: [{ id: 'd1', name: 'First', sector: 's1' }],
    weather: {
      seasons: {
        all: { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], conditions: [{ id: 'clear', label: 'clear', weight: 1 }] },
      },
      tags: ['clear'],
    },
  };

  it('accepts a minimal valid city', () => {
    const parsed = parseCityData(minimal);
    expect(parsed.id).toBe('test-city');
    // Defaulted empty pools.
    expect(parsed.streets).toEqual({});
    expect(parsed.namePools).toEqual({});
  });

  it('rejects a city with no districts', () => {
    const bad = { ...minimal, districts: [] };
    expect(CityDataSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a weather condition with a non-positive weight', () => {
    const bad = {
      ...minimal,
      weather: {
        seasons: { all: { months: [1], conditions: [{ id: 'x', label: 'x', weight: 0 }] } },
        tags: [],
      },
    };
    expect(CityDataSchema.safeParse(bad).success).toBe(false);
  });

  it('tolerates extra authored keys on districts and sectors', () => {
    const withExtra = {
      ...minimal,
      sectors: [{ id: 's1', power: 'four-power', label: 'Zone', note: 'texture' }],
      districts: [{ id: 'd1', number: 1, name: 'First', sector: 's1', character: 'prose' }],
    };
    expect(CityDataSchema.safeParse(withExtra).success).toBe(true);
  });
});
