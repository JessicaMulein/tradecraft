/**
 * Street-data tooling (task 13). Fixtures stand in for a fetch. The commands
 * do not call the network in these tests.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileStreetGraph } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import {
  applyOverrides,
  attributionLines,
  buildAccepted,
  buildGraph,
  fetchStreetSource,
  fidelityFor,
  fidelityWarning,
  loadStreetSources,
  osmMapToOverpassJson,
  periodPass,
  readWays,
  requestUrl,
  resolvePeriodName,
  reviewTiles,
  sourceByName,
  wikiAskToRecords,
  writeBuiltPack,
  writeReviewSheets,
  type PeriodRecord,
} from './street.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const OSM = {
  name: 'openstreetmap',
  kind: 'geometry' as const,
  method: 'overpass',
  url: 'https://overpass-api.de/api/interpreter',
  query: 'way({south},{west},{north},{east})',
  licence: 'ODbL-1.0',
  licenceText: 'Open Database License',
  attribution: '© OpenStreetMap contributors',
};

const WAYS = JSON.stringify({
  features: [
    {
      properties: { id: 'high', name: 'High Street', highway: 'residential', oneway: 'no' },
      geometry: { type: 'LineString', coordinates: [[16.37, 48.208], [16.371, 48.208], [16.372, 48.208]] },
    },
    {
      properties: { id: 'side', name: 'Side Lane', highway: 'residential', oneway: 'yes' },
      geometry: { type: 'LineString', coordinates: [[16.371, 48.208], [16.371, 48.209]] },
    },
    {
      properties: { id: 'service', name: '', highway: 'service' },
      geometry: { type: 'LineString', coordinates: [[16.372, 48.208], [16.373, 48.208]] },
    },
    {
      properties: { id: 'spur', name: 'Spur', highway: 'residential', oneway: 'no' },
      geometry: { type: 'LineString', coordinates: [[16.372, 48.208], [16.375, 48.208]] },
    },
  ],
});

const RING: PeriodRecord[] = [
  { id: 'uni', name: 'Universitätsring', fromYear: 2012, predecessors: ['lueger', 'november'] },
  { id: 'lueger', name: 'Dr.-Karl-Lueger-Ring', fromYear: 1934, toYear: 2012, predecessors: ['franzens'] },
  { id: 'november', name: 'Ring des 12. November', fromYear: 1919, toYear: 1956, predecessors: ['franzens'] },
  { id: 'franzens', name: 'Franzensring', fromYear: 1870, toYear: 1919, predecessors: [] },
];

describe('osm and wiki readers', () => {
  it('keeps a named street from an OpenStreetMap map and reverses a backward one-way', () => {
    const xml = [
      '<osm>',
      '<node id="1" lat="48.210" lon="16.360"/>',
      '<node id="2" lat="48.211" lon="16.361"/>',
      '<way id="9"><nd ref="1"/><nd ref="2"/>',
      '<tag k="highway" v="residential"/><tag k="name" v="Court Lane"/><tag k="oneway" v="-1"/>',
      '</way>',
      '<way id="8"><nd ref="1"/><nd ref="2"/>',
      '<tag k="highway" v="service"/><tag k="name" v="Yard"/>',
      '</way>',
      '</osm>',
    ].join('');
    const ways = readWays(osmMapToOverpassJson(xml));
    expect(ways.map((way) => way.name)).toEqual(['Court Lane']);
    expect(ways[0]?.oneway).toBe(true);
    expect(ways[0]?.points[0]).toEqual({ lon: 16.361, lat: 48.211 });
  });

  it('stores wiki names, years and predecessor links and drops the article', () => {
    const json = JSON.stringify({
      query: {
        results: {
          Universitätsring: {
            fulltext: 'Universitätsring',
            printouts: {
              'Datum von': [{ raw: '1/2012/6/5' }],
              'Datum bis': [],
              'Frühere Bezeichnung': ['[[Dr.-Karl-Lueger-Ring (1)|Dr.-Karl-Lueger-Ring]]'],
              Koordinaten: [{ lat: 48.211, lon: 16.361 }],
            },
            fullurl: 'https://example.test/should-not-matter',
          },
        },
      },
    });
    expect(wikiAskToRecords(json)).toEqual([
      {
        id: 'Universitätsring',
        name: 'Universitätsring',
        fromYear: 2012,
        predecessors: ['Dr.-Karl-Lueger-Ring (1)'],
        lat: 48.211,
        lon: 16.361,
      },
    ]);
  });
});

describe('street sources and fetch', () => {
  it('refuses a fetch that does not accept the named licence', async () => {
    let calls = 0;
    const refused = await fetchStreetSource({
      source: OSM,
      city: 'vienna',
      area: '48.2,16.36,48.21,16.38',
      acceptLicence: undefined,
      outDir: tmpdir(),
      now: '2026-10-09',
      get: () => {
        calls += 1;
        return '{}';
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.notice).toContain('ODbL-1.0');
    expect(calls).toBe(0);
  });

  it('asks the Vienna WMS for a period layer and keeps an exception off disk', async () => {
    const url = requestUrl(
      {
        name: 'wien-plan-1912',
        kind: 'imagery',
        method: 'wms',
        url: 'https://data.wien.gv.at/daten/wms',
        layer: 'GENLPLAN1912OGD',
        licence: 'CC-BY-4.0',
        licenceText: 'CC BY 4.0',
        attribution: 'Datenquelle: Stadt Wien – data.wien.gv.at',
      },
      { south: 48.207, west: 16.369, north: 48.21, east: 16.373 },
    );
    expect(url).toContain('https://data.wien.gv.at/daten/wms');
    expect(url).toContain('version=1.1.1');
    expect(url).toContain('layers=GENLPLAN1912OGD');
    const rejected = await fetchStreetSource({
      source: {
        name: 'wien-bombenschaden',
        kind: 'imagery',
        method: 'wms',
        url: 'https://data.wien.gv.at/daten/wms',
        layer: 'BOMBENSCHADENOGD',
        licence: 'CC-BY-4.0',
        licenceText: 'CC BY 4.0',
        attribution: 'Datenquelle: Stadt Wien – data.wien.gv.at',
      },
      city: 'vienna',
      area: '48.207,16.369,48.21,16.373',
      acceptLicence: 'wien-bombenschaden',
      outDir: tmpdir(),
      now: '2026-10-09',
      get: () => '<ServiceException>LayerNotDefined</ServiceException>',
    });
    expect(rejected.ok).toBe(false);
  });

  it('records the acceptance and does not invent a second source name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'street-src-'));
    const fetched = await fetchStreetSource({
      source: OSM,
      city: 'vienna',
      area: '48.2,16.36,48.21,16.38',
      acceptLicence: 'openstreetmap',
      outDir: dir,
      now: '2026-10-09',
      get: (url) => {
        expect(url).toContain('overpass-api.de');
        return WAYS;
      },
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const text = readFileSync(join(fetched.dir, 'acceptance.yaml'), 'utf8');
    expect(text).toContain('openstreetmap');
    expect(text).toContain('2026-10-09');
    const listed = loadStreetSources(readFileSync(join(ROOT, 'config/street-sources.yaml'), 'utf8'));
    expect(sourceByName(listed, 'openstreetmap')?.licence).toBe('ODbL-1.0');
    expect(sourceByName(listed, 'wien-geschichte')?.stores).toEqual(['name', 'from', 'to', 'predecessors', 'coordinates']);
    expect(listed.filter((source) => source.kind === 'imagery').map((source) => source.name).sort()).toEqual([
      'wien-aerial-1938',
      'wien-aerial-1956',
      'wien-bombenschaden',
      'wien-plan-1912',
    ]);
  });
});

describe('street graph builder', () => {
  const area = [[[16.369, 48.207], [16.373, 48.207], [16.373, 48.21], [16.369, 48.21]]] as const;
  const acceptance = {
    source: 'openstreetmap',
    area: 'box',
    accepted: '2026-10-09',
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
  };

  it('builds the same graph twice and leaves an unaccepted dataset alone', () => {
    const ways = readWays(WAYS);
    const once = buildGraph({
      city: 'city-vienna/vienna',
      ways,
      locations: [{ id: 'cafe', lon: 16.3705, lat: 48.208 }],
      verifiedArea: area,
      acceptance,
    });
    const twice = buildGraph({
      city: 'city-vienna/vienna',
      ways,
      locations: [{ id: 'cafe', lon: 16.3705, lat: 48.208 }],
      verifiedArea: area,
      acceptance,
    });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
    expect(once.segments.find((segment) => segment.street === 'Side Lane')?.oneWay).toBe(true);
    expect(once.segments.find((segment) => segment.street === 'Spur')?.mapped).toBe(false);
    expect(once.frontages.map((frontage) => frontage.location)).toEqual(['cafe']);
    expect(once.segments.some((segment) => segment.street === '')).toBe(false);
    const written = writeBuiltPack(once, mkdtempSync(join(tmpdir(), 'street-pack-')));
    const again = writeBuiltPack(twice, mkdtempSync(join(tmpdir(), 'street-pack-')));
    expect(written.hash).toBe(again.hash);
    expect(readFileSync(written.attributionPath, 'utf8')).toContain('© OpenStreetMap contributors');
    expect(attributionLines(once)).toEqual(['© OpenStreetMap contributors (ODbL-1.0)']);
    const empty = mkdtempSync(join(tmpdir(), 'street-none-'));
    expect(buildAccepted({ dataDir: empty, city: 'vienna', body: WAYS, locations: [], verifiedArea: area }).ok).toBe(false);
  });

  it('rejects an override whose target is missing and closes a street that exists', () => {
    const ways = readWays(WAYS);
    const built = buildGraph({
      city: 'vienna',
      ways,
      locations: [],
      verifiedArea: area,
      acceptance: { source: 'openstreetmap', area: 'box', accepted: '2026-10-09', licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
    });
    const missing = applyOverrides(built, [{ op: 'rename', street: 'No Such Lane', name: 'Old', source: 'record:1', confidence: 'certain' }]);
    expect(missing.errors).toEqual(['rename target does not exist']);
    const closed = applyOverrides(built, [{ op: 'close', street: 'Side Lane', source: 'imagery:tile-0-0', confidence: 'likely' }]);
    expect(closed.errors).toEqual([]);
    expect(closed.graph.segments.find((segment) => segment.street === 'Side Lane')?.closed).toBe(true);
    const compiled = compileStreetGraph(closed.graph as never);
    const side = closed.graph.segments.find((segment) => segment.street === 'Side Lane');
    const arrival = side === undefined ? undefined : { segment: side.id, dir: 'fwd' as const };
    if (arrival !== undefined) {
      expect(compiled.turnOptions(arrival, 'morning', { slow: 5, normal: 10, fast: 16 }).some((option) => option.to.segment === side?.id)).toBe(false);
    }
  });
});

describe('period names', () => {
  it('reports the Universitätsring overlap in 1952 and does not guess', () => {
    expect(resolvePeriodName(RING, 'Universitätsring', 1952)).toEqual({
      status: 'overlap',
      names: ['Dr.-Karl-Lueger-Ring', 'Ring des 12. November'],
    });
    expect(resolvePeriodName(RING, 'Universitätsring', 1960)).toMatchObject({ status: 'rename', name: 'Dr.-Karl-Lueger-Ring' });
    expect(resolvePeriodName(RING, 'Universitätsring', 1900)).toMatchObject({ status: 'rename', name: 'Franzensring' });
    expect(resolvePeriodName(RING, 'Universitätsring', 1860).status).toBe('not-yet-built');
    expect(resolvePeriodName(RING, 'Unknown Lane', 1952).status).toBe('no-record');
    const gap = resolvePeriodName(
      [
        { id: 'late', name: 'Gap Street', fromYear: 1920, toYear: 1930, predecessors: ['early'] },
        { id: 'early', name: 'Old Gap', fromYear: 1900, toYear: 1910, predecessors: [] },
      ],
      'Gap Street',
      1915,
    );
    expect(gap.status).toBe('gap');
  });

  it('keeps period-checked withheld while a verified street is unchecked', () => {
    const built = buildGraph({
      city: 'vienna',
      ways: readWays(WAYS),
      locations: [],
      verifiedArea: [[[16.369, 48.207], [16.373, 48.207], [16.373, 48.21], [16.369, 48.21]]],
      acceptance: { source: 'openstreetmap', area: 'box', accepted: '2026-10-09', licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
    });
    const named = {
      ...built,
      segments: built.segments.map((segment) => (segment.street === 'High Street' ? { ...segment, street: 'Universitätsring' } : segment)),
    };
    const report = periodPass(named, RING, 1952);
    expect(report.open.some((item) => item.street === 'Universitätsring' && item.reason === 'overlap')).toBe(true);
    expect(fidelityFor(report, 0, 1)).toBe('modern-base');
    const clear = { ...report, open: [], unchecked: 0 };
    expect(fidelityFor(clear, 1, 1)).toBe('period-checked');
    expect(fidelityWarning({ fidelity: 'modern-base', sources: [{ retrieved: '2026-10-09' }] }, 1965)).toContain('hand overrides');
    expect(fidelityWarning({ fidelity: 'period-authored' }, 1965)).toBeUndefined();
    const tiles = reviewTiles(built, ['BOMBENSCHADENOGD', 'lb1956']);
    expect(tiles.some((tile) => tile.segments.includes('High Street'))).toBe(true);
    expect(tiles.some((tile) => tile.segments.includes('Spur'))).toBe(false);
    const sheets = writeReviewSheets(tiles, mkdtempSync(join(tmpdir(), 'street-sheets-')));
    const sheet = readFileSync(sheets[0] ?? '', 'utf8');
    expect(sheet).toContain('BOMBENSCHADENOGD');
    expect(sheet).toContain('<svg');
    expect(sheet).toContain('<rect');
    const imageAt = sheet.indexOf('<text');
    const lineAt = sheet.indexOf('<line');
    expect(lineAt).toBeGreaterThan(imageAt);
    const imagery = mkdtempSync(join(tmpdir(), 'street-imagery-'));
    writeFileSync(join(imagery, 'lb1956-16-1-1.jpeg'), 'tile');
    const overlaid = writeReviewSheets(tiles, mkdtempSync(join(tmpdir(), 'street-over-')), imagery);
    const drawn = readFileSync(overlaid[0] ?? '', 'utf8');
    const photo = drawn.indexOf('<image');
    expect(photo).toBeGreaterThan(-1);
    expect(drawn.indexOf('<line', photo)).toBeGreaterThan(photo);
    expect(drawn).toContain('lb1956-16-1-1.jpeg');
  });
});
