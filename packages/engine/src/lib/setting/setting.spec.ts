/**
 * Tests for the setting-step core (content-expansion task 3.2): `drawSetting`
 * and `yearFilter`.
 *
 * These exercise the two pure functions with hand-built minimal
 * {@link ContentSetV2} fixtures. The slice-side registries the functions do not
 * read are left empty (cast through `unknown`), so the fixtures carry only the
 * city, era, Culture-Group and Descriptor-Fragment content the setting step
 * touches. The checks pin:
 *
 * - the Start Date lands inside the city `startDates` window intersected with
 *   the era Period Window (Req 9.2), and a fixed Start Date is honoured;
 * - the draw is deterministic in the setting stream (Req 9.8);
 * - `yearFilter` keeps exactly the items whose Effective Year Range contains the
 *   Game Year and drops the rest (Req 9.3), across every year-ranged kind;
 * - `yearFilter` does not mutate its input (Req 9.11).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type {
  CityDefinition,
  CityLocation,
  CityRoute,
  CultureGroup,
  DescriptorFragment,
  District,
  LocalOrg,
  Newspaper,
  WeatherTables,
} from '@tradecraft/content';
import {
  daysFromEpoch,
  parseIsoDate,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { settingStreamSeed } from './stream.js';
import type { CityBundle, ContentSetV2, EraBundle } from './content-set-v2.js';
import { drawSetting, yearFilter, SettingError } from './setting.js';

// --- fixtures --------------------------------------------------------------

const ERA: EraBundle = {
  id: 'era/cold-war-early',
  period: { from: 1945, to: 1965 },
};

/** A minimal weather table (one condition per month) — unused by the setting step. */
function weatherTables(city: string): WeatherTables {
  const months = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      String(i + 1),
      [{ id: 'clear', label: 'Clear', weight: 1 }],
    ]),
  ) as WeatherTables['months'];
  return { city, months };
}

function location(
  id: string,
  city: string,
  years?: { from: number; to: number },
): CityLocation {
  return {
    id,
    name: id,
    aliases: [],
    type: 'cafe',
    district: 'd1',
    public: true,
    description: 'a place',
    atmosphere: [],
    city,
    tags: ['venue:cafe'],
    basis: 'fictional',
    ...(years ? { years } : {}),
  };
}

function cityDefinition(
  id: string,
  overrides: Partial<CityDefinition> = {},
): CityDefinition {
  return {
    id,
    name: 'Testville',
    country: 'Nowhere',
    climate: 'climate:temperate',
    period: { from: 1948, to: 1960 },
    startDates: { from: '1949-01-01', to: '1955-12-31' },
    currency: {
      name: 'Mark',
      symbol: 'M',
      subunit: 'pfennig',
      format: '{amount} {symbol}',
      rounding: 1,
      budgetScale: 1,
    },
    languages: [{ id: 'de', name: 'German', share: 1 }],
    cultureWeights: [{ group: 'g-main', weight: 1 }],
    services: ['svc-own'],
    ...overrides,
  };
}

function district(id: string, sector?: District['sector']): District {
  return {
    id,
    city: 'city/one',
    name: id,
    aliases: [],
    description: 'a district',
    atmosphere: [],
    tags: ['setting:urban'],
    ...(sector ? { sector } : {}),
  };
}

function cultureGroup(id: string, backgroundYears?: number[]): CultureGroup {
  return {
    id,
    name: id,
    languages: ['de'],
    naming: { display: '{given} {family}', formal: '{honorific} {family}' },
    given: { f: ['Anna'], m: ['Hans'] },
    family: ['Müller'],
    voiceTraits: [],
    mannerisms: [],
    backgrounds: (backgroundYears ?? []).map((y, i) => ({
      text: `background ${i}`,
      tags: [],
      years: { from: y, to: y },
    })),
  };
}

function descriptor(
  id: string,
  years?: { from: number; to: number },
): DescriptorFragment {
  return {
    id,
    slot: 'clothing',
    text: id,
    ...(years ? { years } : {}),
  };
}

/**
 * Build a minimal {@link ContentSetV2} carrying only the fields the setting
 * step reads; the slice registries are empty maps, filled through `unknown`
 * since `drawSetting`/`yearFilter` never touch them.
 */
function makeSet(parts: {
  cities?: Record<string, CityBundle>;
  era?: EraBundle;
  cultureGroups?: Record<string, CultureGroup>;
  descriptorFragments?: DescriptorFragment[];
}): ContentSetV2 {
  const base = {
    predicates: {},
    archetypes: new Map(),
    locationTypes: new Map(),
    plotTemplates: new Map(),
    sideThreadTemplates: new Map(),
    documentTemplates: new Map(),
    personaLibraries: new Map(),
    coverIdentities: new Map(),
    rumourTemplates: new Map(),
    hints: new Map(),
    glossary: new Map(),
    difficultyPresets: new Map(),
    services: new Map(),
    templateVariantDefs: new Map(),
    templateVariants: {},
    manifest: {},
  } as unknown as ContentSetV2;
  return {
    ...base,
    cities: parts.cities ?? {},
    era: parts.era,
    cultureGroups: parts.cultureGroups ?? {},
    descriptorFragments: parts.descriptorFragments ?? [],
    cityScopeOwner: {},
  };
}

function cityBundle(
  def: CityDefinition,
  parts: Partial<Omit<CityBundle, 'def'>> = {},
): CityBundle {
  return {
    def,
    districts: parts.districts ?? [],
    locations: parts.locations ?? [],
    routes: parts.routes ?? [],
    locationTypes: parts.locationTypes ?? [],
    newspapers: parts.newspapers ?? [],
    orgs: parts.orgs ?? [],
    weather: parts.weather ?? weatherTables(def.id),
    covers: parts.covers ?? [],
    streets: parts.streets ?? [],
    locale:
      parts.locale ??
      ({
        scope: { city: def.id },
        date: {
          long: '{day} {month} {year}',
          short: '{day}/{month}/{year}',
          months: Array.from({ length: 12 }, (_, i) => `M${i + 1}`),
          weekdays: Array.from({ length: 7 }, (_, i) => `W${i + 1}`),
        },
        currency: { pattern: '{amount} {symbol}' },
        honorifics: { f: ['Frau'], m: ['Herr'] },
        address: '{street} {number}, {district}',
        terms: [],
        allowNames: [],
      } as CityBundle['locale']),
    variants: parts.variants ?? [],
    sources: parts.sources ?? [],
  };
}

// --- drawSetting -----------------------------------------------------------

describe('drawSetting (Req 9.2, 9.8)', () => {
  const def = cityDefinition('city/one');
  const set = makeSet({
    era: ERA,
    cities: { 'city/one': cityBundle(def) },
  });

  it('draws a Start Date inside the city startDates ∩ era window', () => {
    // city startDates 1949–1955, era 1945–1965 ⇒ window 1949-01-01..1955-12-31.
    const lo = daysFromEpoch({ year: 1949, month: 1, day: 1 });
    const hi = daysFromEpoch({ year: 1955, month: 12, day: 31 });
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const rng = createPrng(settingStreamSeed(seed, 0));
        const sel = drawSetting(set, { city: 'city/one' }, rng, 0);
        const parsed = parseIsoDate(sel.startDate);
        expect(parsed).toBeDefined();
        const day = daysFromEpoch(parsed!);
        expect(day).toBeGreaterThanOrEqual(lo);
        expect(day).toBeLessThanOrEqual(hi);
        expect(sel.year).toBe(parsed!.year);
        expect(sel.city).toBe('city/one');
        expect(sel.attempt).toBe(0);
      }),
    );
  });

  it('restricts the window to the era when the era is tighter than startDates', () => {
    const tightEra: EraBundle = { id: 'e', period: { from: 1952, to: 1953 } };
    const tightSet = makeSet({
      era: tightEra,
      cities: { 'city/one': cityBundle(def) },
    });
    const lo = daysFromEpoch({ year: 1952, month: 1, day: 1 });
    const hi = daysFromEpoch({ year: 1953, month: 12, day: 31 });
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const rng = createPrng(settingStreamSeed(seed, 0));
        const sel = drawSetting(tightSet, { city: 'city/one' }, rng);
        const day = daysFromEpoch(parseIsoDate(sel.startDate)!);
        expect(day).toBeGreaterThanOrEqual(lo);
        expect(day).toBeLessThanOrEqual(hi);
      }),
    );
  });

  it('is deterministic in the setting stream', () => {
    const a = drawSetting(set, { city: 'city/one' }, createPrng(settingStreamSeed('s', 0)));
    const b = drawSetting(set, { city: 'city/one' }, createPrng(settingStreamSeed('s', 0)));
    expect(a).toEqual(b);
  });

  it('honours a fixed in-window Start Date without drawing', () => {
    const sel = drawSetting(
      set,
      { city: 'city/one', startDate: '1951-06-15' },
      createPrng(settingStreamSeed('s', 0)),
    );
    expect(sel.startDate).toBe('1951-06-15');
    expect(sel.year).toBe(1951);
  });

  it('rejects a fixed Start Date outside the city ∩ era window', () => {
    expect(() =>
      drawSetting(
        set,
        { city: 'city/one', startDate: '1947-01-01' },
        createPrng(settingStreamSeed('s', 0)),
      ),
    ).toThrow(SettingError);
  });

  it('throws when the city and era windows are disjoint', () => {
    const disjointEra: EraBundle = { id: 'e', period: { from: 1900, to: 1910 } };
    const disjointSet = makeSet({
      era: disjointEra,
      cities: { 'city/one': cityBundle(def) },
    });
    expect(() =>
      drawSetting(disjointSet, { city: 'city/one' }, createPrng(settingStreamSeed('s', 0))),
    ).toThrow(SettingError);
  });

  it('throws when the named city is not loaded', () => {
    expect(() =>
      drawSetting(set, { city: 'city/missing' }, createPrng(settingStreamSeed('s', 0))),
    ).toThrow(SettingError);
  });

  describe('Core City path', () => {
    it('draws within the era window when an era is loaded', () => {
      const coreSet = makeSet({ era: ERA });
      const lo = daysFromEpoch({ year: 1945, month: 1, day: 1 });
      const hi = daysFromEpoch({ year: 1965, month: 12, day: 31 });
      fc.assert(
        fc.property(fc.string(), (seed) => {
          const rng = createPrng(settingStreamSeed(seed, 0));
          const sel = drawSetting(coreSet, { city: 'core' }, rng);
          expect(sel.city).toBe('core');
          const day = daysFromEpoch(parseIsoDate(sel.startDate)!);
          expect(day).toBeGreaterThanOrEqual(lo);
          expect(day).toBeLessThanOrEqual(hi);
        }),
      );
    });

    it('uses the fixed default date when no era is loaded', () => {
      const coreSet = makeSet({});
      const sel = drawSetting(coreSet, { city: 'core' }, createPrng(settingStreamSeed('s', 0)));
      expect(sel.startDate).toBe('1950-01-01');
      expect(sel.year).toBe(1950);
    });

    it('honours a fixed Core City Start Date even with no era', () => {
      const coreSet = makeSet({});
      const sel = drawSetting(
        coreSet,
        { city: 'core', startDate: '1958-03-04' },
        createPrng(settingStreamSeed('s', 0)),
      );
      expect(sel.startDate).toBe('1958-03-04');
      expect(sel.year).toBe(1958);
    });

    it('records the attempt index it was called with', () => {
      const coreSet = makeSet({ era: ERA });
      const sel = drawSetting(coreSet, { city: 'core' }, createPrng(settingStreamSeed('s', 3)), 3);
      expect(sel.attempt).toBe(3);
    });
  });
});

// --- yearFilter ------------------------------------------------------------

describe('yearFilter (Req 9.3)', () => {
  it('keeps only items whose Effective Year Range contains the Game Year', () => {
    const def = cityDefinition('city/one', { period: { from: 1945, to: 1965 } });
    const bundle = cityBundle(def, {
      locations: [
        location('loc:always', 'city/one'),
        location('loc:early', 'city/one', { from: 1945, to: 1950 }),
        location('loc:late', 'city/one', { from: 1958, to: 1965 }),
      ],
      routes: [
        { a: 'd1', b: 'd2', cost: 1 } as CityRoute,
        { a: 'd1', b: 'd3', cost: 0, years: { from: 1958, to: 1965 } } as CityRoute,
      ],
      newspapers: [
        { id: 'np-a', city: 'city/one', masthead: 'A', language: 'de', stance: 's', register: 'r', days: ['monday'], price: 1, soldAt: ['venue:cafe'] } as Newspaper,
        { id: 'np-b', city: 'city/one', masthead: 'B', language: 'de', stance: 's', register: 'r', days: ['monday'], price: 1, soldAt: ['venue:cafe'], years: { from: 1960, to: 1965 } } as Newspaper,
      ],
      orgs: [
        { id: 'org-a', city: 'city/one', name: 'A', aliases: [], kind: 'bank', tags: ['org:bank'], members: [] } as LocalOrg,
        { id: 'org-b', city: 'city/one', name: 'B', aliases: [], kind: 'bank', tags: ['org:bank'], members: [], years: { from: 1946, to: 1949 } } as LocalOrg,
      ],
      districts: [
        district('d1', { power: 'us', years: { from: 1945, to: 1955 } }),
        district('d2'),
      ],
    });
    const set = makeSet({
      era: ERA,
      cities: { 'city/one': bundle },
      cultureGroups: { g: cultureGroup('g', [1946, 1952, 1962]) },
      descriptorFragments: [
        descriptor('f-always'),
        descriptor('f-early', { from: 1945, to: 1950 }),
        descriptor('f-late', { from: 1960, to: 1965 }),
      ],
    });

    const filtered = yearFilter(set, 1952, 'city/one');
    const fb = filtered.cities['city/one'];

    // At game year 1952 only the undated location survives: loc:early (1945–50)
    // and loc:late (1958–65) both exclude 1952.
    expect(fb.locations.map((l: CityLocation) => l.id).sort()).toEqual(['loc:always']);
    expect(fb.routes.filter((r: CityRoute) => r.years !== undefined)).toHaveLength(0);
    expect(fb.routes).toHaveLength(1); // the undated route stays
    expect(fb.newspapers.map((n: Newspaper) => n.id)).toEqual(['np-a']);
    expect(fb.orgs.map((o: LocalOrg) => o.id)).toEqual(['org-a']);
    // d1's sector (1945–1955) covers 1952 and is kept; a sector outside range
    // would be cleared while the district stays.
    expect(fb.districts.find((d: District) => d.id === 'd1')?.sector).toBeDefined();

    // Culture-Group persona backgrounds: only the 1952 one survives.
    expect(filtered.cultureGroups['g'].backgrounds).toHaveLength(1);

    // Descriptor Fragments at game year 1952: the undated one is kept; the
    // 1945–1950 and 1960–1965 fragments both exclude 1952 and are dropped.
    expect(filtered.descriptorFragments.map((f: DescriptorFragment) => f.id)).toEqual([
      'f-always',
    ]);
  });

  it('clears a District sector whose Year Range excludes the Game Year, keeping the District', () => {
    const def = cityDefinition('city/one', { period: { from: 1945, to: 1965 } });
    const bundle = cityBundle(def, {
      districts: [district('d1', { power: 'us', years: { from: 1945, to: 1949 } })],
    });
    const set = makeSet({ era: ERA, cities: { 'city/one': bundle } });
    const filtered = yearFilter(set, 1952, 'city/one');
    const d1 = filtered.cities['city/one'].districts[0];
    expect(d1.id).toBe('d1');
    expect(d1.sector).toBeUndefined();
  });

  it('prunes the City Definition culture weights to the entries in range', () => {
    const def = cityDefinition('city/one', {
      period: { from: 1945, to: 1965 },
      cultureWeights: [
        { group: 'g-always', weight: 1 },
        { group: 'g-early', weight: 1, years: { from: 1945, to: 1950 } },
        { group: 'g-late', weight: 1, years: { from: 1958, to: 1965 } },
      ],
    });
    const set = makeSet({ era: ERA, cities: { 'city/one': cityBundle(def) } });
    const filtered = yearFilter(set, 1952, 'city/one');
    expect(
      filtered.cities['city/one'].def.cultureWeights
        .map((w: CityDefinition['cultureWeights'][number]) => w.group)
        .sort(),
    ).toEqual(['g-always']);
  });

  it('bounds items by the era Period Window as well as the city window', () => {
    // City period 1945–1965 but era 1950–1955: a 1948 game year is outside the
    // era, so an undated item is dropped even though it is inside the city.
    const narrowEra: EraBundle = { id: 'e', period: { from: 1950, to: 1955 } };
    const def = cityDefinition('city/one', { period: { from: 1945, to: 1965 } });
    const bundle = cityBundle(def, { locations: [location('loc:x', 'city/one')] });
    const set = makeSet({ era: narrowEra, cities: { 'city/one': bundle } });
    const filtered = yearFilter(set, 1948, 'city/one');
    expect(filtered.cities['city/one'].locations).toHaveLength(0);
  });

  it('does not mutate its input', () => {
    const def = cityDefinition('city/one', { period: { from: 1945, to: 1965 } });
    const bundle = cityBundle(def, {
      locations: [location('loc:early', 'city/one', { from: 1945, to: 1950 })],
    });
    const set = makeSet({
      era: ERA,
      cities: { 'city/one': bundle },
      descriptorFragments: [descriptor('f-early', { from: 1945, to: 1950 })],
    });
    const beforeLoc = set.cities['city/one'].locations.length;
    const beforeFrag = set.descriptorFragments.length;
    yearFilter(set, 1960, 'city/one');
    expect(set.cities['city/one'].locations).toHaveLength(beforeLoc);
    expect(set.descriptorFragments).toHaveLength(beforeFrag);
  });
});
