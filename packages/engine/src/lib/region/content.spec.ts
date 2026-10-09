/**
 * Regional content schemas (multi-city task 1.1).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContent } from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import {
  REGION_KINDS,
  BorderSchema,
  CrossCityStageHookSchema,
  RegionalPresetSchema,
  RegionTemplateSchema,
  regionJsonSchema,
} from './content.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs');

const era = { from: 1948, to: 1961 };

const preset = {
  id: 'standard-region',
  era,
  preset: 'standard',
  cityCount: { min: 2, max: 4 },
  borderStrictness: { min: 0.2, max: 0.8 },
  watchListSensitivity: 1,
  detentionPhases: 4,
  contrabandCashThreshold: 500,
  papersDelay: 2,
  papersCost: 40,
  communicationLatency: { sameCountry: 1, crossBorder: 2, acrossCurtain: 4 },
  liaisonReliability: { min: 0.4, max: 0.9 },
  liaisonTrustThreshold: 0.6,
  penetrationProbability: 0.1,
  rivalryIntensity: 0.5,
  verifierAttemptLimit: 8,
};

describe('regional content kinds', () => {
  it('accepts a regional preset and rejects one that omits a Req 20.2 field', () => {
    expect(RegionalPresetSchema.safeParse(preset).success).toBe(true);
    const { verifierAttemptLimit, ...missing } = preset;
    void verifierAttemptLimit;
    expect(RegionalPresetSchema.safeParse(missing).success).toBe(false);
    expect(RegionalPresetSchema.safeParse({ ...preset, cityCount: { min: 4, max: 2 } }).success).toBe(false);
  });

  it('requires an era range on a region template and exactly one hub', () => {
    const template = {
      id: 'central-1953',
      era,
      eraDate: '1953-06-01',
      cities: [
        { city: 'city-vienna/vienna', hub: true },
        { city: 'city-berlin/berlin' },
      ],
      countries: ['Austria', 'Germany'],
    };
    expect(RegionTemplateSchema.safeParse(template).success).toBe(true);
    const { era: _era, ...noEra } = template;
    void _era;
    expect(RegionTemplateSchema.safeParse(noEra).success).toBe(false);
    expect(
      RegionTemplateSchema.safeParse({
        ...template,
        cities: [
          { city: 'city-vienna/vienna', hub: true },
          { city: 'city-berlin/berlin', hub: true },
        ],
      }).success,
    ).toBe(false);
    expect(RegionTemplateSchema.safeParse({ ...template, era: { from: 1962, to: 1948 } }).success).toBe(false);
  });

  it('accepts a country border and a sector-line border', () => {
    expect(
      BorderSchema.safeParse({
        id: 'austrian-frontier',
        era,
        between: { kind: 'countries', a: 'Austria', b: 'Hungary' },
      }).success,
    ).toBe(true);
    expect(
      BorderSchema.safeParse({
        id: 'sector-line',
        era,
        between: { kind: 'sector-line', line: 'international' },
      }).success,
    ).toBe(true);
  });

  it('accepts a cross-city hook with an optional fallback', () => {
    const hook = {
      id: 'deliver',
      era,
      city: 'B',
      handoff: { from: 'acquire', carrier: 'courier-line', modes: ['rail', 'road'] },
      cityRoles: { A: { not: 'hub' }, B: {} },
    };
    expect(CrossCityStageHookSchema.safeParse(hook).success).toBe(true);
    expect(CrossCityStageHookSchema.safeParse({ ...hook, fallback: 'deliver-local' }).success).toBe(true);
    expect(
      CrossCityStageHookSchema.safeParse({
        ...hook,
        handoff: { ...hook.handoff, carrier: 'pigeon' },
      }).success,
    ).toBe(false);
  });

  it('registers every regional kind with an era range and a JSON Schema', () => {
    const names = REGION_KINDS.map((item) => item.kind);
    expect(names).toEqual([
      'region-template',
      'intercity-route-template',
      'border',
      'border-post',
      'travel-document-kind',
      'service-extension',
      'rivalry-table',
      'regional-preset',
      'cross-city-stage-hook',
    ]);
    for (const item of REGION_KINDS) {
      expect(item.owner).toBe('@tradecraft/engine');
      expect(item.cityScoped).toBe(false);
      expect(item.roles).toEqual(['extension']);
      expect(item.fields.years).toEqual(['items[].era']);
      const schema = regionJsonSchema(item.kind);
      expect(schema).toBeTypeOf('object');
    }
    expect(() => regionJsonSchema('city')).toThrow(/no regional kind/);
  });

  it('loads through the content kind registry', () => {
    const loaded = loadContent([join(PACKS, 'core')], ['core'], { kinds: [...REGION_KINDS] });
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 4))).toBe(true);
  });
});
