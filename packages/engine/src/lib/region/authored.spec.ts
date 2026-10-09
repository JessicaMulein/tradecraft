/**
 * Authored regional packs (multi-city task 1.3; Req 16.3, 16.6).
 *
 * The fixture is one extension pack plus four city packs, because a city pack
 * holds exactly one city.yaml. region-core is the playable template: Vienna
 * hub, Berlin, Trieste, era date 1953-06-01 inside each city's period.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import type { ContentError, ContentSet } from '@tradecraft/content';

import { loadRegionContent } from './load.js';

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

const CORE_DIRS = [
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

function show(errors: readonly ContentError[]): string {
  return errors.map((error) => `${error.pack}/${error.file}:${error.path} ${error.message}`).join('\n');
}

function loaded(dirs: readonly string[], selected: string): ContentSet {
  const result = loadRegionContent(dirs, [selected]);
  if (!result.ok) {
    throw new Error(show(result.errors));
  }
  return result.value;
}

function readList(file: string): readonly Record<string, unknown>[] {
  const parsed = parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not a list`);
  }
  return parsed as Record<string, unknown>[];
}

describe('regional fixture pack (Req 16.3)', () => {
  it('loads four synthetic cities, four travel modes, every service kind, a rivalry and a cross-city plot', () => {
    const set = loaded(FIXTURE_DIRS, 'region-fixture');
    const ids = set.manifest.packs.map((pack) => pack.id);
    expect(ids).toContain('region-fixture');
    expect(ids).toEqual(
      expect.arrayContaining([
        'fixture-north',
        'fixture-east',
        'fixture-south',
        'fixture-west',
      ]),
    );

    const cityIds = ['fixture-north/north', 'fixture-east/east', 'fixture-south/south', 'fixture-west/west'];
    expect(Object.keys(set.cities).sort()).toEqual([...cityIds].sort());
    for (const id of cityIds) {
      const period = set.cities[id]?.def.period;
      expect(period).toBeDefined();
      if (period === undefined) {
        continue;
      }
      expect(period.from).toBeLessThanOrEqual(1953);
      expect(period.to).toBeGreaterThanOrEqual(1953);
    }

    const template = readList(
      join(FIXTURES, 'region-fixture', 'region-templates', 'central.yaml'),
    )[0];
    expect(template?.id).toBe('central-1953');
    expect(template?.eraDate).toBe('1953-06-01');
    expect(template?.sectorLines).toEqual([
      { id: 'north-line', a: 'Northland', b: 'Eastland' },
      { id: 'south-line', a: 'Southland', b: 'Westland' },
    ]);

    const modes = readList(join(FIXTURES, 'region-fixture', 'intercity-routes', 'routes.yaml')).map(
      (route) => route.mode,
    );
    expect(modes.sort()).toEqual(['air', 'rail', 'road', 'sea']);

    const kinds = ['own-desk', 'hostile-desk', 'local-desk', 'liaison-desk'].map(
      (id) => set.services.get(`region-fixture/${id}`)?.kind,
    );
    expect(kinds.sort()).toEqual(['hostile', 'liaison', 'local-security', 'own']);

    const rivalry = readList(join(FIXTURES, 'region-fixture', 'rivalry-tables', 'rivalry.yaml'))[0];
    expect(Array.isArray(rivalry?.edges)).toBe(true);
    expect((rivalry?.edges as unknown[]).length).toBeGreaterThan(0);

    const plot = set.plotTemplatesV2?.get('region-fixture/courier-line');
    expect(plot?.cityRoles).toEqual({ A: { not: 'hub' }, B: {} });
    const hook = readList(join(FIXTURES, 'region-fixture', 'cross-city-hooks', 'courier.yaml'))[0];
    expect(hook?.id).toBe('courier-line');
    expect(hook?.city).toBe('B');
  });
});

describe('region-core central-1953 (Req 16.3, 16.6)', () => {
  it('loads Vienna, Berlin and Trieste with era date 1953 inside each period window', () => {
    const set = loaded(CORE_DIRS, 'region-core');
    const ids = set.manifest.packs.map((pack) => pack.id);
    expect(ids).toContain('region-core');
    expect(ids).toEqual(expect.arrayContaining(['city-vienna', 'city-berlin', 'city-trieste']));

    const windows = [
      { id: 'city-vienna/vienna', from: 1945, to: 1955 },
      { id: 'city-berlin/berlin', from: 1948, to: 1961 },
      { id: 'city-trieste/trieste', from: 1947, to: 1954 },
    ];
    for (const window of windows) {
      const period = set.cities[window.id]?.def.period;
      expect(period).toEqual({ from: window.from, to: window.to });
      expect(window.from).toBeLessThanOrEqual(1953);
      expect(window.to).toBeGreaterThanOrEqual(1953);
    }

    const template = readList(join(PACKS, 'region-core', 'region-templates', 'central.yaml'))[0];
    expect(template?.id).toBe('central-1953');
    expect(template?.eraDate).toBe('1953-06-01');
    const slots = template?.cities as readonly { city: string; hub: boolean }[];
    expect(slots).toEqual([
      { city: 'city-vienna/vienna', hub: true },
      { city: 'city-berlin/berlin', hub: false },
      { city: 'city-trieste/trieste', hub: false },
    ]);

    const modes = readList(join(PACKS, 'region-core', 'intercity-routes', 'routes.yaml')).map(
      (route) => route.mode,
    );
    expect(modes.sort()).toEqual(['air', 'rail', 'road', 'sea']);

    const extensions = readList(join(PACKS, 'region-core', 'service-extensions', 'extensions.yaml'));
    const services = extensions.map((row) => row.service);
    expect(services).toEqual(
      expect.arrayContaining([
        'era-cold-war-early/own-service',
        'era-cold-war-early/hostile-foreign-directorate',
        'era-cold-war-early/liaison-atlantic-agency',
        'city-vienna/city-security-directorate',
        'city-berlin/city-public-order-office',
        'city-trieste/zone-security-office',
      ]),
    );

    expect(readList(join(PACKS, 'region-core', 'borders', 'borders.yaml')).length).toBeGreaterThan(0);
    expect(readList(join(PACKS, 'region-core', 'travel-documents', 'documents.yaml')).map((row) => row.id)).toEqual([
      'passport',
      'laissez-passer',
      'service-pass',
    ]);
    expect(readList(join(PACKS, 'region-core', 'regional-presets', 'presets.yaml')).map((row) => row.preset)).toEqual([
      'easy',
      'standard',
      'hard',
    ]);

    const plot = set.plotTemplatesV2?.get('region-core/courier-line');
    expect(plot?.cityRoles?.A).toEqual({ not: 'hub' });
    expect(readList(join(PACKS, 'region-core', 'cross-city-hooks', 'courier.yaml'))[0]?.id).toBe('courier-line');
  }, 30_000);
});
