/**
 * Regional cross-reference checks (multi-city task 1.2; Req 16.2, 16.4).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkRegionContent, type RegionRefs, type RegionSource } from './check.js';
import { loadRegionContent } from './load.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, '..', '..', '..', '..', 'content', 'packs');
const FIXTURE = join(HERE, 'fixtures', 'region-ok');

const DIRS = [
  join(PACKS, 'core'),
  join(PACKS, 'era-cold-war-early'),
  join(PACKS, 'lib-central-europe'),
  join(PACKS, 'lib-russian'),
  join(PACKS, 'city-vienna'),
  FIXTURE,
];

const era = { from: 1948, to: 1961 };

function source(kind: string, items: readonly unknown[]): RegionSource {
  return { pack: 'region-fixture', file: `${kind}.yaml`, list: true, kind, items };
}

function refs(extra: Partial<RegionRefs> = {}): RegionRefs {
  return {
    cities: new Set(['city-vienna/vienna']),
    districts: new Set(['city-vienna/vienna', 'city-vienna/innere-stadt']),
    locations: new Set(['city-vienna/cafe-mohnblume']),
    locationTypes: new Set(['city-vienna/kaffeehaus']),
    services: new Set(['city-vienna/city-security-directorate']),
    ...extra,
  };
}

describe('regional cross-references', () => {
  it('reports a dangling city, terminal, service, jurisdiction place and hook role', () => {
    const known = refs();
    const template = source('region-template', [
      {
        id: 'central-1953',
        era,
        eraDate: '1953-06-01',
        cities: [
          { city: 'city-missing/missing', hub: true },
          { city: 'city-vienna/vienna' },
        ],
        countries: ['Austria'],
        jurisdiction: [{ place: 'city-missing/nowhere', service: 'city-vienna/city-security-directorate' }],
      },
    ]);
    const route = source('intercity-route-template', [
      {
        id: 'westbahn',
        era,
        mode: 'rail',
        terminals: ['city-vienna/kaffeehaus', 'loc:nowhere'],
        timetable: 'morning',
        duration: 4,
        fare: 12,
      },
    ]);
    const post = source('border-post', [
      {
        id: 'westbahnhof-post',
        era,
        border: 'frontier',
        service: 'city-missing/police',
        strictness: 0.4,
      },
    ]);
    const hook = source('cross-city-stage-hook', [
      {
        id: 'deliver',
        era,
        city: 'C',
        cityRoles: { A: { not: 'hub' }, B: {} },
      },
    ]);
    const errors = checkRegionContent([template, route, post, hook], known);
    expect(errors.map((error) => error.path)).toEqual([
      '[0].cities[0].city',
      '[0].jurisdiction[0].place',
      '[0].terminals[1]',
      '[0].service',
      '[0].city',
    ]);
    expect(errors.every((error) => error.pack === 'region-fixture')).toBe(true);
    expect(errors[0]?.message).toContain('city-missing/missing');
    expect(errors[4]?.message).toContain('not declared in cityRoles');
  });

  it('reports a hook role whose travel mode has no route', () => {
    const route = source('intercity-route-template', [
      {
        id: 'westbahn',
        era,
        mode: 'rail',
        terminals: ['city-vienna/kaffeehaus', 'city-vienna/cafe-mohnblume'],
        timetable: 'morning',
        duration: 4,
        fare: 12,
      },
    ]);
    const hook = source('cross-city-stage-hook', [
      {
        id: 'deliver',
        era,
        city: 'B',
        handoff: { from: 'acquire', carrier: 'courier-line', modes: ['air'] },
        cityRoles: { A: { not: 'hub' }, B: {} },
      },
    ]);
    const errors = checkRegionContent([route, hook], refs());
    expect(errors.map((error) => error.path)).toEqual(['[0].handoff.modes']);
    expect(errors[0]?.message).toContain('no intercity route');
    expect(errors[0]?.file).toBe('cross-city-stage-hook.yaml');
  });

  it('loads a region pack into the content manifest when every reference resolves', () => {
    const loaded = loadRegionContent(DIRS, ['region-fixture']);
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 8))).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const pack = loaded.value.manifest.packs.find((entry) => entry.id === 'region-fixture');
    expect(pack?.version).toBe('1.0.0');
    expect(pack?.hash.length).toBeGreaterThan(0);
    expect(loaded.value.manifest.packs.some((entry) => entry.id === 'city-vienna')).toBe(true);
  });
});
