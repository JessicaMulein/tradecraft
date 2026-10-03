/**
 * The City Pack load test for `city-berlin` (content-expansion task 9.3).
 *
 * Loads the shipped `city-berlin` City Pack together with the packs it requires
 * - the core pack (the Tag Vocabulary and slice kinds), the `era-cold-war-early`
 * Era Pack, and the `lib-central-europe` and `lib-russian` Library Packs its
 * Culture Weights draw on - from disk through `loadContent`, exactly as a
 * scenario set in Berlin would, and asserts the load succeeds with no
 * ContentErrors.
 *
 * A clean load means the geography authored by task 9.3 passed every loader
 * stage that touches it: the role rules and one-Era-Pack rule, the City-Scoped
 * ownership checks, the `services` cross-reference, the Tag check (every
 * District, Location and Route Tag is in the vocabulary and applies to its
 * kind) and Tag Conformance (every Required Query the vocabulary guarantees has
 * at least its `minStatic` static binders among Berlin's Locations). The test
 * then confirms the merged Content Set carries the Berlin CityBundle and that
 * the geography meets task 9.3's targets:
 *
 *   * the city window is 1948-1961 with a `climate:*` Tag drawn from the
 *     vocabulary (Req 2.5);
 *   * at least six Districts, each carrying an occupation `sector`, spread
 *     across all four occupying powers (Req 2.1, 2.2);
 *   * at least 25 Locations across at least six Districts (Req 11.2);
 *   * U-Bahn and S-Bahn transit-hub Location Types are present and stamped
 *     (Req 2.3);
 *   * sector-crossing Routes carry checkpoint Tags and Year Ranges that close
 *     the open crossings by 1961 (Req 2.4);
 *   * the street pool carries at least 60 names and the weather tables cover
 *     all twelve months (Req 2.6).
 *
 * The institutions half (newspapers, local orgs, the local-security service,
 * cover identities, the Locale and Template Variants) arrives with task 9.4 and
 * is not asserted here.
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
const CENTRAL_DIR = join(PACKS_DIR, 'lib-central-europe');
const RUSSIAN_DIR = join(PACKS_DIR, 'lib-russian');
const BERLIN_DIR = join(PACKS_DIR, 'city-berlin');

const DIRS = [CORE_DIR, ERA_DIR, CENTRAL_DIR, RUSSIAN_DIR, BERLIN_DIR];
const IDS = [
  'core',
  'era-cold-war-early',
  'lib-central-europe',
  'lib-russian',
  'city-berlin',
];

const CITY_ID = 'city-berlin/berlin';

/** Load the Berlin pack and its dependencies, surfacing every ContentError. */
function loadBerlin(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(DIRS, IDS);
  if (!result.ok) {
    throw new Error(
      `city-berlin failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('city-berlin City Pack (geography, task 9.3)', () => {
  it('loads cleanly with core, the Era Pack and the Library Packs (no ContentErrors)', () => {
    const result = loadContent(DIRS, IDS);
    expect(result.ok).toBe(true);
  });

  it('carries the Berlin city with a 1948-1961 window and a vocabulary climate Tag', () => {
    const set = loadBerlin();
    const bundle = set.cities[CITY_ID];
    expect(bundle, 'missing Berlin CityBundle').toBeDefined();
    const def = bundle.def;
    expect(def.name).toBe('Berlin');
    expect(def.period).toEqual({ from: 1948, to: 1961 });
    // The climate Tag must be a real vocabulary Tag on the `climate` facet.
    const climateTags = new Set(
      set.tagVocabulary.tags
        .map((t) => t.id)
        .filter((id) => id.startsWith('climate:')),
    );
    expect(
      climateTags.has(def.climate),
      `climate Tag ${def.climate} not in vocabulary`,
    ).toBe(true);
  });

  it('has at least six Districts, each in an occupation sector across all four powers', () => {
    const bundle = loadBerlin().cities[CITY_ID];
    const districts = bundle.districts;
    expect(districts.length).toBeGreaterThanOrEqual(6);
    for (const d of districts) {
      expect(d.sector, `district ${d.id} has no sector`).toBeDefined();
      expect(d.sector!.years.from).toBeLessThanOrEqual(1948);
      expect(d.sector!.years.to).toBeGreaterThanOrEqual(1961);
    }
    const powers = new Set(districts.map((d) => d.sector!.power));
    for (const power of ['American', 'British', 'French', 'Soviet']) {
      expect(powers.has(power), `no district in the ${power} sector`).toBe(true);
    }
  });

  it('ships at least 25 Locations across at least six Districts (Req 11.2)', () => {
    const bundle = loadBerlin().cities[CITY_ID];
    expect(bundle.locations.length).toBeGreaterThanOrEqual(25);
    const districts = new Set(bundle.locations.map((l) => l.district));
    expect(districts.size).toBeGreaterThanOrEqual(6);
  });

  it('stamps U-Bahn and S-Bahn transit hubs (Req 2.3)', () => {
    const bundle = loadBerlin().cities[CITY_ID];
    const typeIds = new Set(bundle.locationTypes.map((t) => t.id));
    expect(typeIds.has('u-bahn-station')).toBe(true);
    expect(typeIds.has('s-bahn-station')).toBe(true);
    expect(bundle.locations.some((l) => l.type === 'u-bahn-station')).toBe(true);
    expect(bundle.locations.some((l) => l.type === 's-bahn-station')).toBe(true);
  });

  it('carries sector-crossing Routes with checkpoint Tags and Year Ranges closing by 1961 (Req 2.4)', () => {
    const bundle = loadBerlin().cities[CITY_ID];
    const crossings = bundle.routes.filter((r) =>
      (r.tags ?? []).includes('access:checkpoint'),
    );
    expect(crossings.length).toBeGreaterThan(0);
    for (const c of crossings) {
      expect(c.years, 'a sector crossing must carry a Year Range').toBeDefined();
      expect(c.years!.to).toBeLessThanOrEqual(1961);
    }
  });

  it('ships at least 60 street names and weather tables for all twelve months (Req 2.6)', () => {
    const bundle = loadBerlin().cities[CITY_ID];
    expect(bundle.streets.length).toBeGreaterThanOrEqual(60);

    const months = Object.keys(bundle.weather.months)
      .map(Number)
      .sort((a, b) => a - b);
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
