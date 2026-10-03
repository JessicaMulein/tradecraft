/**
 * The City kinds (content-expansion task 1.4).
 *
 * These tests pin the schemas and Field Declarations the City Pack kinds carry:
 * `CityDefinition` (with `services` and `instantiation`), `District`,
 * `CityLocation`, `CityRoute`, `Newspaper`, `LocalOrg`, `WeatherTables`,
 * `Source` and `streets`. They check the required fields, the closed enums and
 * bounds the design fixes, that every month of the weather table is present,
 * and that each registration is City-Scoped with the Field Declarations the
 * loader and Pack Linter read (Requirements 2.1–2.8, 3.1, 3.2, 3.5).
 */

import { describe, expect, it } from 'vitest';

import {
  CITY_KINDS,
  CityDefinitionSchema,
  CityLocationSchema,
  CityRouteSchema,
  DistrictSchema,
  LocalOrgSchema,
  NewspaperSchema,
  SourceSchema,
  StreetsPoolSchema,
  WeatherTablesSchema,
  cityKind,
  locationKind,
  weatherKind,
} from '../index.js';

// --- fixtures --------------------------------------------------------------

const cityDef = {
  id: 'vienna',
  name: 'Vienna',
  country: 'Austria',
  climate: 'climate:temperate',
  period: { from: 1945, to: 1955 },
  startDates: { from: '1948-01-01', to: '1950-12-31' },
  currency: {
    name: 'Schilling',
    symbol: 'S',
    subunit: 'Groschen',
    format: '{symbol}{amount}',
    rounding: 0.1,
    budgetScale: 1,
  },
  languages: [{ id: 'de', name: 'German', share: 0.9 }],
  cultureWeights: [{ group: 'lib-central-europe/austrian-german', weight: 3 }],
  services: ['era-cold-war-early/own-service', 'vienna/stapo'],
  instantiation: { districts: [4, 8], locations: [12, 30] },
};

const weatherMonth = [{ id: 'clear', label: 'clear skies', weight: 3 }];

const weatherTables = {
  city: 'vienna/vienna',
  months: {
    '1': weatherMonth,
    '2': weatherMonth,
    '3': weatherMonth,
    '4': weatherMonth,
    '5': weatherMonth,
    '6': weatherMonth,
    '7': weatherMonth,
    '8': weatherMonth,
    '9': weatherMonth,
    '10': weatherMonth,
    '11': weatherMonth,
    '12': weatherMonth,
  },
};

// --- CityDefinition --------------------------------------------------------

describe('CityDefinitionSchema (Req 2.1, 3.5)', () => {
  it('accepts a full city definition with services and instantiation', () => {
    const parsed = CityDefinitionSchema.parse(cityDef);
    expect(parsed.services).toContain('vienna/stapo');
    expect(parsed.instantiation?.districts).toEqual([4, 8]);
  });

  it('defaults nothing but accepts a definition with no instantiation bounds', () => {
    const withoutBounds: Record<string, unknown> = { ...cityDef };
    delete withoutBounds.instantiation;
    expect(CityDefinitionSchema.parse(withoutBounds).instantiation).toBeUndefined();
  });

  it('requires at least one service', () => {
    expect(() =>
      CityDefinitionSchema.parse({ ...cityDef, services: [] }),
    ).toThrow();
  });

  it('rejects a start-date window whose from is after its to', () => {
    expect(() =>
      CityDefinitionSchema.parse({
        ...cityDef,
        startDates: { from: '1950-01-01', to: '1948-01-01' },
      }),
    ).toThrow();
  });

  it('rejects an inverted instantiation bound', () => {
    expect(() =>
      CityDefinitionSchema.parse({
        ...cityDef,
        instantiation: { locations: [30, 12] },
      }),
    ).toThrow();
  });

  it('rejects a malformed climate tag', () => {
    expect(() =>
      CityDefinitionSchema.parse({ ...cityDef, climate: 'temperate' }),
    ).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() =>
      CityDefinitionSchema.parse({ ...cityDef, population: 1_600_000 }),
    ).toThrow();
  });
});

// --- District --------------------------------------------------------------

describe('DistrictSchema (Req 2.2)', () => {
  const district = {
    id: 'innere-stadt',
    city: 'vienna/vienna',
    name: 'Innere Stadt',
    description: 'The old inner city.',
  };

  it('defaults aliases, atmosphere and tags to empty', () => {
    const parsed = DistrictSchema.parse(district);
    expect(parsed.aliases).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.sector).toBeUndefined();
  });

  it('accepts an optional sector with a year range', () => {
    const parsed = DistrictSchema.parse({
      ...district,
      sector: { power: 'international', years: { from: 1945, to: 1955 } },
    });
    expect(parsed.sector?.power).toBe('international');
  });

  it('rejects a sector with no year range', () => {
    expect(() =>
      DistrictSchema.parse({ ...district, sector: { power: 'soviet' } }),
    ).toThrow();
  });
});

// --- CityLocation ----------------------------------------------------------

describe('CityLocationSchema (Req 2.3, 3.1)', () => {
  const location = {
    id: 'cafe-central',
    name: 'Café Central',
    type: 'core/kaffeehaus',
    district: 'vienna/innere-stadt',
    public: true,
    description: 'A grand coffee house.',
    city: 'vienna/vienna',
    basis: 'real-landmark',
    tags: ['function:social'],
    sources: ['vienna/baedeker-1950'],
    weight: 2,
  };

  it('accepts a location that extends the slice location fields', () => {
    const parsed = CityLocationSchema.parse(location);
    expect(parsed.basis).toBe('real-landmark');
    expect(parsed.weight).toBe(2);
    expect(parsed.atmosphere).toEqual([]);
  });

  it('rejects an unknown basis', () => {
    expect(() =>
      CityLocationSchema.parse({ ...location, basis: 'imaginary' }),
    ).toThrow();
  });

  it('rejects a non-positive weight', () => {
    expect(() =>
      CityLocationSchema.parse({ ...location, weight: 0 }),
    ).toThrow();
  });
});

// --- CityRoute -------------------------------------------------------------

describe('CityRouteSchema (Req 2.4)', () => {
  it('accepts a cost-1 route with checkpoint tags and a year range', () => {
    const parsed = CityRouteSchema.parse({
      a: 'vienna/innere-stadt',
      b: 'vienna/leopoldstadt',
      cost: 1,
      tags: ['checkpoint:sector-line'],
      years: { from: 1945, to: 1955 },
    });
    expect(parsed.cost).toBe(1);
  });

  it('rejects a cost other than 0 or 1', () => {
    expect(() =>
      CityRouteSchema.parse({ a: 'vienna/a', b: 'vienna/b', cost: 2 }),
    ).toThrow();
  });
});

// --- Newspaper -------------------------------------------------------------

describe('NewspaperSchema (Req 2.7)', () => {
  const paper = {
    id: 'wiener-bote',
    city: 'vienna/vienna',
    masthead: 'Wiener Bote',
    language: 'de',
    stance: 'liberal',
    register: 'formal',
    days: ['monday', 'thursday'],
    price: 0.5,
    soldAt: ['function:newsstand'],
  };

  it('accepts a newspaper with a soldAt tag query', () => {
    expect(NewspaperSchema.parse(paper).days).toEqual(['monday', 'thursday']);
  });

  it('rejects a soldAt query longer than three tags', () => {
    expect(() =>
      NewspaperSchema.parse({
        ...paper,
        soldAt: ['function:a', 'function:b', 'function:c', 'function:d'],
      }),
    ).toThrow();
  });

  it('requires at least one print weekday', () => {
    expect(() => NewspaperSchema.parse({ ...paper, days: [] })).toThrow();
  });
});

// --- LocalOrg --------------------------------------------------------------

describe('LocalOrgSchema (Req 2.8)', () => {
  it('accepts an org with member tag queries', () => {
    const parsed = LocalOrgSchema.parse({
      id: 'city-tram-authority',
      city: 'vienna/vienna',
      name: 'City Tram Authority',
      kind: 'public-body',
      tags: ['sector:transport'],
      members: [['role:conductor'], ['role:clerk']],
    });
    expect(parsed.members).toHaveLength(2);
  });
});

// --- WeatherTables ---------------------------------------------------------

describe('WeatherTablesSchema (Req 2.6)', () => {
  it('accepts a table with all twelve months in the slice format', () => {
    const parsed = WeatherTablesSchema.parse(weatherTables);
    expect(parsed.months['6']).toEqual(weatherMonth);
  });

  it('refuses a table missing a month', () => {
    const withoutJuly: Record<string, unknown> = { ...weatherTables.months };
    delete withoutJuly['7'];
    expect(() =>
      WeatherTablesSchema.parse({ city: 'vienna/vienna', months: withoutJuly }),
    ).toThrow();
  });

  it('refuses a month with an empty condition table', () => {
    expect(() =>
      WeatherTablesSchema.parse({
        ...weatherTables,
        months: { ...weatherTables.months, '3': [] },
      }),
    ).toThrow();
  });
});

// --- Source and streets ----------------------------------------------------

describe('SourceSchema (Req 3.1)', () => {
  it('accepts a bibliographic source with optional fields', () => {
    const parsed = SourceSchema.parse({
      id: 'baedeker-1950',
      title: "Baedeker's Austria",
      author: 'Karl Baedeker',
      year: 1950,
      kind: 'guide',
    });
    expect(parsed.kind).toBe('guide');
  });

  it('rejects an unknown source kind', () => {
    expect(() =>
      SourceSchema.parse({ id: 's', title: 'T', kind: 'podcast' }),
    ).toThrow();
  });
});

describe('StreetsPoolSchema (Req 2.5)', () => {
  it('accepts a named street pool', () => {
    const parsed = StreetsPoolSchema.parse({
      id: 'inner-city',
      names: ['Kärntner Straße', 'Graben'],
    });
    expect(parsed.names).toHaveLength(2);
  });

  it('rejects an empty pool', () => {
    expect(() => StreetsPoolSchema.parse({ id: 'x', names: [] })).toThrow();
  });
});

// --- registrations ---------------------------------------------------------

describe('City kind registrations (Req 2.1, 17.1)', () => {
  it('registers nine City kinds, all City-Scoped under the city role', () => {
    expect(CITY_KINDS).toHaveLength(9);
    for (const reg of CITY_KINDS) {
      expect(reg.cityScoped).toBe(true);
      expect(reg.roles).toEqual(['city']);
      expect(reg.owner).toContain('content');
    }
    expect(CITY_KINDS.map((r) => r.kind).sort()).toEqual(
      [
        'city',
        'district',
        'local-org',
        'location',
        'newspaper',
        'route',
        'sources',
        'streets',
        'weather',
      ].sort(),
    );
  });

  it('declares the city reference and tag fields the loader resolves', () => {
    expect(cityKind.fields.refs).toEqual(
      expect.arrayContaining([
        { path: 'items[].services[]', kind: 'service' },
        { path: 'items[].cultureWeights[].group', kind: 'culture-group' },
      ]),
    );
    expect(cityKind.fields.tags).toContain('items[].climate');
  });

  it('declares the location references including sources and location type', () => {
    expect(locationKind.fields.refs).toEqual(
      expect.arrayContaining([
        { path: 'items[].type', kind: 'location-type' },
        { path: 'items[].district', kind: 'district' },
        { path: 'items[].sources[]', kind: 'sources' },
      ]),
    );
  });

  it('points the weather kind at its city reference', () => {
    expect(weatherKind.fields.refs).toEqual([
      { path: 'items[].city', kind: 'city' },
    ]);
  });
});
