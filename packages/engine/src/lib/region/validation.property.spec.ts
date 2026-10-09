/**
 * Property 23, extended to regional kinds (multi-city task 1.4).
 *
 * A generated valid region pack loads, and every cross-reference resolves.
 * One corruption — a dangling City, an unknown Terminal, a hook role with no
 * route, or a Regional Preset missing a field — fails the load with a
 * ContentError that names the pack, file and path.
 *
 * **Validates: Requirements 16.1, 16.2, 16.4**
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import type { ContentError } from '@tradecraft/content';

import { TRAVEL_MODES } from './content.js';
import { loadRegionContent } from './load.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, '..', '..', '..', '..', 'content', 'packs', 'core');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

interface Spec {
  readonly n: number;
  readonly mode: (typeof TRAVEL_MODES)[number];
  readonly detentionPhases: number;
  readonly verifierAttemptLimit: number;
  readonly rivalryIntensity: number;
}

interface CitySlot {
  city: string;
  hub: boolean;
}

interface TemplateRow {
  id: string;
  era: { from: number; to: number };
  eraDate: string;
  cities: CitySlot[];
  countries: string[];
}

interface RouteRow {
  id: string;
  era: { from: number; to: number };
  mode: string;
  terminals: string[];
  timetable: string;
  duration: number;
  fare: number;
}

interface HookRow {
  id: string;
  era: { from: number; to: number };
  city: string;
  handoff: { from: string; carrier: 'courier-line'; modes: string[] };
  cityRoles: { A: { not: 'hub' }; B: Record<string, never> };
}

interface PresetRow {
  id: string;
  era: { from: number; to: number };
  preset: string;
  cityCount: { min: number; max: number };
  borderStrictness: { min: number; max: number };
  watchListSensitivity: number;
  detentionPhases: number;
  contrabandCashThreshold: number;
  papersDelay: number;
  papersCost: number;
  communicationLatency: { sameCountry: number; crossBorder: number; acrossCurtain: number };
  liaisonReliability: { min: number; max: number };
  liaisonTrustThreshold: number;
  penetrationProbability: number;
  rivalryIntensity: number;
  verifierAttemptLimit?: number;
}

interface Built {
  readonly cityId: string;
  readonly regionId: string;
  readonly cityKey: string;
  readonly cityFiles: Record<string, unknown>;
  readonly regionFiles: {
    template: TemplateRow[];
    routes: RouteRow[];
    hook: HookRow[];
    preset: PresetRow[];
  };
}

interface Corruption {
  readonly label: string;
  readonly file: string;
  apply(built: Built): void;
  pathMatches(path: string): boolean;
}

const PLACES: readonly { id: string; pub: boolean; district: string; tags: string[] }[] = [
  { id: 'station', pub: false, district: 'old-town', tags: ['venue:station-office', 'function:station', 'access:private', 'setting:institutional', 'function:materiel-store'] },
  { id: 'safehouse', pub: false, district: 'old-town', tags: ['function:safehouse', 'access:private', 'function:dead-drop-site'] },
  { id: 'warehouse', pub: false, district: 'fringe', tags: ['function:warehouse', 'access:private', 'function:materiel-store', 'function:dead-drop-site'] },
  { id: 'embassy', pub: false, district: 'old-town', tags: ['function:embassy', 'setting:diplomatic', 'access:private'] },
  { id: 'cafe', pub: true, district: 'old-town', tags: ['function:cafe', 'function:meeting-spot', 'access:public', 'function:newspaper-outlet'] },
  { id: 'park', pub: true, district: 'old-town', tags: ['function:park', 'function:meeting-spot', 'access:public', 'function:dead-drop-site'] },
  { id: 'hotel', pub: true, district: 'old-town', tags: ['function:hotel-bar', 'function:meeting-spot', 'access:public', 'function:newspaper-outlet'] },
  { id: 'kiosk', pub: true, district: 'old-town', tags: ['function:kiosk', 'function:meeting-spot', 'access:public', 'function:newspaper-outlet', 'function:public-text-source'] },
  { id: 'bookshop', pub: true, district: 'old-town', tags: ['function:bookshop', 'function:meeting-spot', 'access:public', 'function:public-text-source', 'function:dead-drop-site'] },
  { id: 'library', pub: true, district: 'old-town', tags: ['function:library', 'function:meeting-spot', 'access:public', 'function:public-text-source'] },
  { id: 'cinema', pub: true, district: 'fringe', tags: ['function:cinema', 'function:dead-drop-site', 'access:public'] },
  { id: 'port', pub: true, district: 'fringe', tags: ['function:port', 'function:transit', 'function:transit-hub', 'access:public'] },
  { id: 'halt', pub: true, district: 'fringe', tags: ['function:transit', 'function:transit-hub', 'access:public'] },
];

const specArb: fc.Arbitrary<Spec> = fc.record({
  n: fc.integer({ min: 0, max: 9999 }),
  mode: fc.constantFrom(...TRAVEL_MODES),
  detentionPhases: fc.integer({ min: 0, max: 8 }),
  verifierAttemptLimit: fc.integer({ min: 1, max: 6 }),
  rivalryIntensity: fc.integer({ min: 0, max: 100 }).map((value) => value / 100),
});

const corruptionArb: fc.Arbitrary<Corruption> = fc.constantFrom<Corruption>(
  {
    label: 'dangling-city',
    file: 'region-templates/central.yaml',
    apply: (built) => {
      const slot = built.regionFiles.template[0]?.cities[0];
      if (slot !== undefined) {
        slot.city = 'city-missing/missing';
      }
    },
    pathMatches: (path) => path === '[0].cities[0].city',
  },
  {
    label: 'unknown-terminal',
    file: 'intercity-routes/routes.yaml',
    apply: (built) => {
      const route = built.regionFiles.routes[0];
      if (route !== undefined) {
        route.terminals[0] = 'missing/nowhere';
      }
    },
    pathMatches: (path) => path === '[0].terminals[0]',
  },
  {
    label: 'hook-without-route',
    file: 'cross-city-hooks/courier.yaml',
    apply: (built) => {
      const hook = built.regionFiles.hook[0];
      const unused = TRAVEL_MODES.find((mode) => mode !== built.regionFiles.routes[0]?.mode);
      if (hook !== undefined && unused !== undefined) {
        hook.handoff.modes = [unused];
      }
    },
    pathMatches: (path) => path === '[0].handoff.modes',
  },
  {
    label: 'missing-preset-field',
    file: 'regional-presets/presets.yaml',
    apply: (built) => {
      const preset = built.regionFiles.preset[0];
      if (preset !== undefined) {
        delete preset.verifierAttemptLimit;
      }
    },
    pathMatches: (path) => path.includes('verifierAttemptLimit'),
  },
);

function build(spec: Spec): Built {
  const cityId = `city-${spec.n}`;
  const regionId = `region-${spec.n}`;
  const local = `port-${spec.n}`;
  const cityKey = `${cityId}/${local}`;
  const era = { from: 1948, to: 1961 };
  const terminal = `${cityId}/halt`;

  const cityFiles: Record<string, unknown> = {
    'pack.yaml': {
      id: cityId,
      version: '1.0.0',
      contentSchema: 2,
      role: 'city',
      requires: [{ id: 'core', range: '^1.0.0' }],
      overrides: [],
    },
    'city.yaml': {
      id: local,
      name: 'Port',
      country: 'Northland',
      climate: 'climate:temperate',
      period: era,
      startDates: { from: '1948-01-01', to: '1953-12-31' },
      currency: {
        name: 'mark',
        symbol: 'M',
        subunit: 'pfennig',
        format: '{symbol}{major}',
        rounding: 1,
        budgetScale: 1,
      },
      languages: [{ id: 'de', name: 'German', share: 1 }],
      cultureWeights: [{ group: 'austrian', weight: 1 }],
      services: ['watch'],
    },
    'services/services.yaml': [
      {
        id: 'watch',
        name: 'the watch',
        kind: 'local-security',
        country: 'Northland',
        years: era,
      },
    ],
    'districts/districts.yaml': [
      {
        id: 'old-town',
        city: local,
        name: 'Old Town',
        description: 'The old town.',
        tags: ['setting:commercial', 'sector:british'],
        sector: { power: 'British', years: era },
      },
      {
        id: 'fringe',
        city: local,
        name: 'The Fringe',
        description: 'The fringe.',
        tags: ['setting:industrial', 'sector:soviet'],
        sector: { power: 'Soviet', years: era },
      },
    ],
    'locations/places.yaml': PLACES.map((place) => ({
      id: place.id,
      name: place.id,
      type: 'halt',
      district: place.district,
      public: place.pub,
      description: `A ${place.id}.`,
      city: local,
      tags: place.tags,
      basis: 'fictional',
    })),
    'location-types/halt.yaml': [
      {
        id: 'halt',
        public: true,
        allowedActions: ['travel', 'talk', 'wait'],
        baseRisk: 0.2,
        allowsDeadDrops: true,
        namePatterns: ['the halt'],
        descriptionPool: ['A halt.'],
        atmosphereTags: ['public'],
        tags: ['access:public', 'function:transit-hub'],
      },
    ],
    'routes/routes.yaml': [
      { a: 'old-town', b: 'fringe', cost: 1, tags: ['access:checkpoint'], years: era },
    ],
  };

  return {
    cityId,
    regionId,
    cityKey,
    cityFiles,
    regionFiles: {
      template: [
        {
          id: 'central',
          era,
          eraDate: '1953-06-01',
          cities: [
            { city: cityKey, hub: true },
            { city: cityKey, hub: false },
          ],
          countries: ['Northland'],
        },
      ],
      routes: [
        {
          id: 'line',
          era,
          mode: spec.mode,
          terminals: [terminal, terminal],
          timetable: 'morning',
          duration: 4,
          fare: 10,
        },
      ],
      hook: [
        {
          id: 'courier-line',
          era,
          city: 'B',
          handoff: { from: 'collect', carrier: 'courier-line', modes: [spec.mode] },
          cityRoles: { A: { not: 'hub' }, B: {} },
        },
      ],
      preset: [
        {
          id: 'generated',
          era,
          preset: 'easy',
          cityCount: { min: 2, max: 4 },
          borderStrictness: { min: 0.2, max: 0.5 },
          watchListSensitivity: 0.3,
          detentionPhases: spec.detentionPhases,
          contrabandCashThreshold: 40,
          papersDelay: 1,
          papersCost: 5,
          communicationLatency: { sameCountry: 1, crossBorder: 2, acrossCurtain: 3 },
          liaisonReliability: { min: 0.4, max: 0.8 },
          liaisonTrustThreshold: 0.4,
          penetrationProbability: 0.2,
          rivalryIntensity: spec.rivalryIntensity,
          verifierAttemptLimit: spec.verifierAttemptLimit,
        },
      ],
    },
  };
}

function writeTree(dir: string, files: Record<string, unknown>): void {
  for (const [rel, value] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, toYaml(value), 'utf8');
  }
}

function materialise(built: Built): { readonly cityDir: string; readonly regionDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'tc-region-'));
  tempRoots.push(root);
  const cityDir = join(root, built.cityId);
  const regionDir = join(root, built.regionId);
  writeTree(cityDir, built.cityFiles);
  writeTree(regionDir, {
    'pack.yaml': {
      id: built.regionId,
      version: '1.0.0',
      contentSchema: 2,
      role: 'extension',
      requires: [{ id: built.cityId, range: '^1.0.0' }],
      overrides: [],
    },
    'region-templates/central.yaml': built.regionFiles.template,
    'intercity-routes/routes.yaml': built.regionFiles.routes,
    'cross-city-hooks/courier.yaml': built.regionFiles.hook,
    'regional-presets/presets.yaml': built.regionFiles.preset,
  });
  return { cityDir, regionDir };
}

function show(errors: readonly ContentError[]): string {
  return errors
    .slice(0, 8)
    .map((error) => `${error.pack}/${error.file}:${error.path} ${error.message}`)
    .join('\n');
}

describe('Property 23: Content validation', () => {
  it('loads any generated valid region pack and resolves every cross-reference', () => {
    // Feature: multi-city, Property 23: Content validation
    fc.assert(
      fc.property(specArb, (spec) => {
        const built = build(spec);
        const dirs = materialise(built);
        const result = loadRegionContent([CORE, dirs.cityDir, dirs.regionDir], [built.regionId]);
        if (!result.ok) {
          throw new Error(`expected a valid region to load, got:\n${show(result.errors)}`);
        }
        expect(result.value.manifest.packs.some((pack) => pack.id === built.regionId)).toBe(true);
        expect(result.value.cities[built.cityKey]?.def.period).toEqual({ from: 1948, to: 1961 });
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it('rejects one regional corruption with a located ContentError', () => {
    // Feature: multi-city, Property 23: Content validation
    fc.assert(
      fc.property(specArb, corruptionArb, (spec, corruption) => {
        const built = build(spec);
        corruption.apply(built);
        const dirs = materialise(built);
        const result = loadRegionContent([CORE, dirs.cityDir, dirs.regionDir], [built.regionId]);
        if (result.ok) {
          throw new Error(`expected corruption "${corruption.label}" to fail the load`);
        }
        const located = result.errors.find(
          (error) =>
            error.pack === built.regionId &&
            error.file === corruption.file &&
            corruption.pathMatches(error.path),
        );
        if (located === undefined) {
          throw new Error(
            `corruption "${corruption.label}" produced no located error.\n${show(result.errors)}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
