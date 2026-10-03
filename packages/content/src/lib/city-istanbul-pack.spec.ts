/**
 * The City Pack load test for `city-istanbul` — the geography half
 * (content-expansion task 9.5).
 *
 * Loads the Istanbul City Pack from disk together with the packs it requires
 * (core, the `era-cold-war-early` Era Pack and the `lib-eastern-mediterranean`
 * Library Pack) through `loadContent`, exactly as a scenario set in Istanbul
 * would, and asserts the load succeeds with no ContentErrors. A clean load is
 * itself the strong assertion: the loader runs the Tag check and Tag
 * Conformance stages over the pack, so a successful load proves every Required
 * Query the Tag Vocabulary guarantees is bound statically in Istanbul
 * (Req 4.3–4.5), every reference (district, location type, source, service,
 * culture group) resolves, and the City-Scoped ownership holds.
 *
 * It then confirms the geography the task authored: the City Definition
 * (Mediterranean climate, the 1950–1965 period, the Turkish lira and the
 * Culture-Group weights), the six Districts spanning both shores with no
 * occupation sector, at least twenty-five Locations across all six Districts,
 * the ferry Routes across the Bosphorus and the Golden Horn, the monthly
 * weather tables, at least sixty street names and the Sources bibliography that
 * attests every real-landmark Location (Req 2.1–2.6, 3.1, 3.2, 11.2, 18.2).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadContent, type ContentSet, type LoadResult } from '../index.js';

const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
);
const CORE_DIR = join(PACKS_DIR, 'core');
const ERA_DIR = join(PACKS_DIR, 'era-cold-war-early');
const EASTMED_DIR = join(PACKS_DIR, 'lib-eastern-mediterranean');
const ISTANBUL_DIR = join(PACKS_DIR, 'city-istanbul');

const DIRS = [CORE_DIR, ERA_DIR, EASTMED_DIR, ISTANBUL_DIR];
const IDS = ['core', 'era-cold-war-early', 'lib-eastern-mediterranean', 'city-istanbul'];

/** The namespaced id the Istanbul City Bundle is keyed by in the Content Set. */
const CITY_ID = 'city-istanbul/istanbul';

/** Load the Istanbul City Pack with its dependencies, surfacing every error. */
function loadIstanbul(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(DIRS, IDS);
  if (!result.ok) {
    throw new Error(
      `city-istanbul failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('city-istanbul City Pack — geography (task 9.5)', () => {
  it('loads cleanly with core, the Era Pack and the Library Pack (no ContentErrors)', () => {
    const result = loadContent(DIRS, IDS);
    if (!result.ok) {
      throw new Error(
        result.errors
          .map((e) => `${e.pack}/${e.file} ${e.path}: ${e.message}`)
          .join('\n'),
      );
    }
    expect(result.ok).toBe(true);
  });

  it('defines the Istanbul city: Mediterranean climate, 1950–1965, Turkish lira', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    expect(bundle).toBeDefined();
    expect(bundle.def.name).toBe('Istanbul');
    expect(bundle.def.country).toBe('Turkey');
    expect(bundle.def.climate).toBe('climate:mediterranean');
    expect(bundle.def.period).toEqual({ from: 1950, to: 1965 });
    expect(bundle.def.currency.subunit).toBe('kuruş');
  });

  it('weights the Eastern-Mediterranean Culture Groups for naming', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    const groups = bundle.def.cultureWeights.map((w) => w.group);
    expect(groups).toContain('lib-eastern-mediterranean/turkish');
    expect(groups).toContain('lib-eastern-mediterranean/istanbul-greek');
    expect(groups).toContain('lib-eastern-mediterranean/sephardic');
  });

  it('references the shared Era services (local-security service is the institutions half)', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    expect(bundle.def.services).toContain('era-cold-war-early/own-service');
    expect(bundle.def.services.length).toBeGreaterThanOrEqual(1);
  });

  it('spans six Districts across both shores with no occupation sector', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    expect(bundle.districts.map((d) => d.id).sort()).toEqual(
      ['beyoglu', 'eminonu', 'galata', 'kadikoy', 'sirkeci', 'uskudar'].sort(),
    );
    for (const d of bundle.districts) {
      expect(d.sector, `${d.id} should carry no sector`).toBeUndefined();
      expect(d.tags.length, `${d.id} must carry a tag`).toBeGreaterThanOrEqual(1);
    }
  });

  it('places at least 25 Locations across all six Districts (Req 11.2 quantity)', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    expect(bundle.locations.length).toBeGreaterThanOrEqual(25);
    const districtsUsed = new Set(bundle.locations.map((l) => l.district));
    expect(districtsUsed.size).toBeGreaterThanOrEqual(6);
  });

  it('lays ferry Routes across the Bosphorus and the Golden Horn, keeping the graph connected', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    const edges = bundle.routes.map((r) => [r.a, r.b].sort().join('~'));
    // The Golden Horn crossing (Galata ~ Eminönü) and a Bosphorus crossing
    // (Eminönü ~ Kadıköy) must both be present.
    expect(edges).toContain(['galata', 'eminonu'].sort().join('~'));
    expect(edges).toContain(['eminonu', 'kadikoy'].sort().join('~'));

    // Every District is reachable from every other (connected graph).
    const adjacency = new Map<string, Set<string>>();
    for (const d of bundle.districts) adjacency.set(d.id, new Set());
    for (const r of bundle.routes) {
      adjacency.get(r.a)?.add(r.b);
      adjacency.get(r.b)?.add(r.a);
    }
    const seen = new Set<string>(['beyoglu']);
    const queue = ['beyoglu'];
    while (queue.length > 0) {
      const node = queue.shift() as string;
      for (const next of adjacency.get(node) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(bundle.districts.length);
  });

  it('every real-landmark Location cites a Source in the bibliography', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    const sourceIds = new Set(bundle.sources.map((s) => s.id));
    expect(sourceIds.size).toBeGreaterThanOrEqual(1);
    for (const loc of bundle.locations) {
      if (loc.basis === 'real-landmark') {
        expect(
          (loc.sources ?? []).length,
          `${loc.id} is a real landmark and must cite a source`,
        ).toBeGreaterThanOrEqual(1);
        for (const ref of loc.sources ?? []) {
          const bare = ref.includes('/') ? ref.split('/').pop() : ref;
          expect(
            sourceIds.has(ref) || sourceIds.has(bare as string),
            `${loc.id} cites unknown source ${ref}`,
          ).toBe(true);
        }
      }
    }
  });

  it('supplies monthly weather for all twelve months and at least 60 street names', () => {
    const bundle = loadIstanbul().cities[CITY_ID];
    for (let m = 1; m <= 12; m += 1) {
      const table = bundle.weather.months[String(m) as keyof typeof bundle.weather.months];
      expect(table.length, `month ${m}`).toBeGreaterThanOrEqual(1);
    }
    expect(bundle.streets.length).toBeGreaterThanOrEqual(60);
  });
});
