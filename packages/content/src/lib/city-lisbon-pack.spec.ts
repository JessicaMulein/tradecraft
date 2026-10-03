/**
 * The City Pack load test for `city-lisbon` — the geography half (content-
 * expansion task 9.7).
 *
 * Loads the Lisbon City Pack together with the core pack, the one Era Pack and
 * the Library Packs its Culture Weights draw on, exactly as a scenario set in
 * Lisbon would, and asserts the load succeeds with no ContentErrors. A clean
 * load means more than schema validity: the loader has run the role rules (one
 * Era Pack per City Pack), the City-Scoped ownership and cross-reference checks
 * and — crucially for a City Pack — the Tag check and Tag Conformance stage,
 * which refuses the pack unless every Required Query in the core Tag Vocabulary
 * clears its per-city static minimum of binders (own Tags together with each
 * Location's Location Type Tags) within the city's 1945–1965 Period Window.
 *
 * It then confirms the geography the task authored is present and meets the
 * release Quantity Targets (Req 11.2): at least 25 Locations across at least 6
 * Districts, at least 60 street names, all twelve monthly weather tables, and a
 * Source for every real-landmark Location. It checks the Lisbon-specific
 * texture the task calls for — the Baixa, Chiado, Alfama and Cais do Sodré
 * among the Districts; trams, funiculars (the Elevador da Glória), the port and
 * the airport as transit; émigré hotels as meeting grounds; and the
 * consulates/legations as diplomatic settings — and that the city carries no
 * occupation sector (neutral Portugal was never divided).
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

/** The pack dirs and ids this test loads (core, era, the libraries, then the city). */
const IDS = [
  'core',
  'era-cold-war-early',
  'lib-iberian',
  'lib-western',
  'lib-central-europe',
  'lib-russian',
  'lib-eastern-mediterranean',
  'city-lisbon',
] as const;
const DIRS = IDS.map((id) => join(PACKS_DIR, id));

/** The namespaced City id the Lisbon bundle is keyed by in the Content Set. */
const LISBON = 'city-lisbon/lisbon';

/** Load the whole set, surfacing every ContentError in the thrown message. */
function loadLisbon(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent([...DIRS], [...IDS]);
  if (!result.ok) {
    throw new Error(
      `city-lisbon failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('city-lisbon City Pack — geography (task 9.7)', () => {
  it('loads cleanly with core, the era and the library packs (no ContentErrors)', () => {
    const result = loadContent([...DIRS], [...IDS]);
    if (!result.ok) {
      throw new Error(
        result.errors
          .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
          .join('\n'),
      );
    }
    expect(result.ok).toBe(true);
  });

  it('registers the Lisbon city with its Mediterranean climate, escudo currency and 1945–1965 period', () => {
    const set = loadLisbon();
    const city = set.cities[LISBON];
    expect(city, 'missing Lisbon city bundle').toBeDefined();
    expect(city.def.name).toBe('Lisbon');
    expect(city.def.country).toBe('Portugal');
    expect(city.def.climate).toBe('climate:mediterranean');
    expect(city.def.currency.name).toBe('escudo');
    expect(city.def.period).toEqual({ from: 1945, to: 1965 });
  });

  it('meets the release Quantity Target: >=25 locations across >=6 districts', () => {
    const set = loadLisbon();
    const city = set.cities[LISBON];
    expect(city.locations.length, 'locations').toBeGreaterThanOrEqual(25);
    expect(city.districts.length, 'districts').toBeGreaterThanOrEqual(6);
    const districtsUsed = new Set(city.locations.map((l) => l.district));
    expect(districtsUsed.size, 'districts with at least one location').toBeGreaterThanOrEqual(6);
  });

  it('carries at least 60 street names and all twelve monthly weather tables', () => {
    const set = loadLisbon();
    const city = set.cities[LISBON];
    expect(new Set(city.streets).size, 'distinct street names').toBeGreaterThanOrEqual(60);
    for (let m = 1 as number; m <= 12; m += 1) {
      const table = (city.weather.months as Record<string, unknown[]>)[String(m)];
      expect(table, `weather month ${m}`).toBeDefined();
      expect(table.length, `weather month ${m} conditions`).toBeGreaterThanOrEqual(1);
    }
  });

  it('has no occupation sector on any district (neutral Portugal was never divided)', () => {
    const set = loadLisbon();
    for (const district of set.cities[LISBON].districts) {
      expect(district.sector, `district ${district.id} sector`).toBeUndefined();
    }
  });

  it('names the Baixa, Chiado, Alfama and Cais do Sodré among its districts', () => {
    const set = loadLisbon();
    const names = new Set(set.cities[LISBON].districts.map((d) => d.name));
    for (const expected of ['Baixa', 'Chiado', 'Alfama', 'Cais do Sodré']) {
      expect(names.has(expected), `district ${expected}`).toBe(true);
    }
  });

  it('cites a Source for every real-landmark location', () => {
    const set = loadLisbon();
    const city = set.cities[LISBON];
    const sourceIds = new Set(city.sources.map((s) => `${LISBON.split('/')[0]}/${s.id}`));
    const bareSourceIds = new Set(city.sources.map((s) => s.id));
    for (const loc of city.locations) {
      if (loc.basis !== 'real-landmark') continue;
      expect(loc.sources, `landmark ${loc.id} sources`).toBeDefined();
      for (const ref of loc.sources ?? []) {
        const bare = ref.includes('/') ? ref.split('/').slice(1).join('/') : ref;
        expect(
          sourceIds.has(ref) || bareSourceIds.has(bare),
          `landmark ${loc.id} cites unknown source ${ref}`,
        ).toBe(true);
      }
    }
  });

  it('provides transit (trams, funiculars, the port and the airport) and diplomatic settings through its location types', () => {
    const set = loadLisbon();
    const city = set.cities[LISBON];

    // The city ships its own Location Types for the distinctive places.
    const typeIds = new Set(city.locationTypes.map((t) => t.id));
    for (const t of ['elevador', 'electrico-stop', 'doca', 'aerodromo', 'hotel-bar', 'legacao']) {
      expect(typeIds.has(t), `location type ${t}`).toBe(true);
    }

    // Effective Tags = a Location's own Tags plus its Location Type's Tags.
    const typeTags = new Map(city.locationTypes.map((t) => [t.id, new Set(t.tags)]));
    const effective = (locType: string, own: readonly string[]): Set<string> => {
      const bare = locType.includes('/') ? locType.split('/').slice(1).join('/') : locType;
      return new Set([...(typeTags.get(bare) ?? []), ...own]);
    };
    const anyLocationHas = (...tags: string[]): boolean =>
      city.locations.some((l) => {
        const eff = effective(l.type, l.tags);
        return tags.every((t) => eff.has(t));
      });

    expect(anyLocationHas('function:transit-hub'), 'a transit hub').toBe(true);
    expect(anyLocationHas('function:port'), 'the port').toBe(true);
    expect(anyLocationHas('function:hotel-bar'), 'an émigré hotel bar').toBe(true);
    expect(anyLocationHas('setting:diplomatic'), 'a diplomatic setting').toBe(true);
  });

  it('weights the Portuguese culture group above the émigré groups', () => {
    const set = loadLisbon();
    const weights = set.cities[LISBON].def.cultureWeights;
    const portuguese = weights.find((w) => w.group === 'lib-iberian/portuguese');
    expect(portuguese, 'portuguese culture weight').toBeDefined();
    const maxOther = Math.max(
      ...weights.filter((w) => w.group !== 'lib-iberian/portuguese').map((w) => w.weight),
    );
    expect(portuguese!.weight).toBeGreaterThan(maxOther);
  });
});
