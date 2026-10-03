/**
 * The City Pack load test for `city-trieste` (content-expansion task 9.9).
 *
 * Loads the shipped Trieste City Pack together with the core pack, the Era Pack
 * and the Library Packs its Culture Weights draw on, exactly as a scenario set
 * in the Free Territory of Trieste would, and asserts the load succeeds with no
 * ContentErrors — which means the Tag check and Tag Conformance passed, every
 * reference resolved, and the city-scope rules held.
 *
 * It then confirms the merged City Bundle carries the geography this task
 * authored: the city definition (period 1947–1954, Mediterranean climate, lira
 * currency), at least six Districts split across the two zones (Zone A under an
 * Allied military government and Zone B under a Yugoslav military government)
 * with each District's `sector` naming its zone and carrying a Year Range, at
 * least twenty-five Locations across the Districts, the zone-line checkpoint
 * Routes carrying checkpoint Tags and a Year Range, the twelve monthly weather
 * tables, at least sixty streets and the Sources bibliography (Req 2.1–2.6,
 * 3.1, 3.2, 11.1, 11.2, 18.2).
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

/** The packs Trieste loads with, in dependency order. */
const PACK_IDS = [
  'core',
  'era-cold-war-early',
  'lib-central-europe',
  'lib-eastern-mediterranean',
  'lib-western',
  'lib-russian',
  'city-trieste',
] as const;

const PACK_DIRS = PACK_IDS.map((id) => join(PACKS_DIR, id));

const CITY_ID = 'city-trieste/trieste';

/** Load the Trieste pack set, surfacing every ContentError in the message. */
function loadTrieste(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(PACK_DIRS, [...PACK_IDS]);
  if (!result.ok) {
    throw new Error(
      `city-trieste failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('city-trieste City Pack (content-expansion task 9.9)', () => {
  it('loads cleanly with core, the Era Pack and the Library Packs (no ContentErrors)', () => {
    const result = loadContent(PACK_DIRS, [...PACK_IDS]);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.errors, null, 2)).toBe(
      true,
    );
  });

  it('exposes the Trieste City Bundle with its 1947–1954 definition', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    expect(bundle, `missing city bundle ${CITY_ID}`).toBeDefined();
    expect(bundle.def.name).toBe('Trieste');
    expect(bundle.def.climate).toBe('climate:mediterranean');
    expect(bundle.def.period).toEqual({ from: 1947, to: 1954 });
    expect(bundle.def.currency.name).toBe('lira');
  });

  it('ships at least six Districts, each carrying a zone sector with a Year Range (Req 2.2)', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    expect(bundle.districts.length).toBeGreaterThanOrEqual(6);
    for (const d of bundle.districts) {
      expect(d.sector, `district ${d.id} has no sector`).toBeDefined();
      expect(d.sector?.power.length).toBeGreaterThan(0);
      expect(d.sector?.years).toEqual({ from: 1947, to: 1954 });
    }
  });

  it('splits the Districts across Zone A (Allied) and Zone B (Yugoslav)', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    const zoneA = bundle.districts.filter((d) => d.tags.includes('sector:allied'));
    const zoneB = bundle.districts.filter((d) => d.tags.includes('sector:yugoslav'));
    expect(zoneA.length).toBeGreaterThanOrEqual(5);
    expect(zoneB.length).toBeGreaterThanOrEqual(1);
  });

  it('ships at least twenty-five Locations spread across at least six Districts (Req 11.2)', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    expect(bundle.locations.length).toBeGreaterThanOrEqual(25);
    const districtsUsed = new Set(bundle.locations.map((l) => l.district));
    expect(districtsUsed.size).toBeGreaterThanOrEqual(6);
  });

  it('names the Trieste landmarks the task calls for', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    const names = bundle.locations.map((l) => l.name);
    expect(names).toContain('the Molo Audace');
    expect(names).toContain('the Stazione Centrale');
    expect(names.some((n) => n.includes('Opicina'))).toBe(true);
  });

  it('carries zone-line checkpoint Routes with checkpoint Tags and a Year Range (Req 2.5)', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    const checkpoints = bundle.routes.filter((r) =>
      (r.tags ?? []).includes('access:checkpoint'),
    );
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    for (const r of checkpoints) {
      expect(r.tags).toContain('sector:yugoslav');
      expect(r.years).toEqual({ from: 1947, to: 1954 });
    }
  });

  it('every real-landmark Location cites at least one Source (Req 3.1)', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    const sourceIds = new Set(bundle.sources.map((s) => s.id));
    for (const loc of bundle.locations) {
      if (loc.basis === 'real-landmark') {
        expect(loc.sources?.length, `${loc.id} has no sources`).toBeGreaterThanOrEqual(
          1,
        );
        for (const ref of loc.sources ?? []) {
          const bare = ref.includes('/') ? ref.split('/').pop()! : ref;
          expect(sourceIds.has(bare), `${loc.id} cites unknown source ${ref}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('ships twelve monthly weather tables and at least sixty streets (Req 2.6, 11.2)', () => {
    const bundle = loadTrieste().cities[CITY_ID];
    expect(Object.keys(bundle.weather.months)).toHaveLength(12);
    expect(bundle.streets.length).toBeGreaterThanOrEqual(60);
  });
});
