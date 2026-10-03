import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent, type ContentSet } from '../index.js';

// --- fixture helpers (mirrors loader.spec.ts) ------------------------------

type PackFiles = Record<string, unknown>;

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function writePacks(packs: Record<string, PackFiles>): string[] {
  const root = mkdtempSync(join(tmpdir(), 'tc-csb-'));
  tempRoots.push(root);
  const dirs: string[] = [];
  for (const [name, files] of Object.entries(packs)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const [rel, value] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof value === 'string' ? value : toYaml(value), 'utf8');
    }
    dirs.push(dir);
  }
  return dirs;
}

function expectOk(result: ReturnType<typeof loadContent>): ContentSet {
  if (!result.ok) {
    throw new Error(
      `expected load to succeed, got:\n${JSON.stringify(result.errors, null, 2)}`,
    );
  }
  return result.value;
}

// --- reusable content ------------------------------------------------------

const predicateMeetsAt = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

const personaAustrian = {
  id: 'austrian',
  namePools: [
    { culture: 'austrian', gender: 'male', given: ['Franz'], family: ['Huber'] },
  ],
  backgrounds: ['A lifelong Viennese.'],
};

const descriptorsCore = {
  version: 1,
  shared: { build: ['lean'] },
  pools: {
    'street-clothes': { garments: [{ text: 'a raincoat', fits: 'any' }] },
  },
};

const archetypeCivilian = {
  id: 'local-civilian',
  role: 'civilian',
  allowedAllegiances: ['neutral'],
  mice: {
    money: { min: 0, max: 1 },
    ideology: { min: 0, max: 1 },
    coercion: { min: 0, max: 1 },
    ego: { min: 0, max: 1 },
  },
  wariness: { min: 0, max: 1 },
  personaPools: ['austrian'],
  descriptorPools: ['street-clothes'],
  schedule: [],
  tags: ['role:civilian'],
};

const locationTypeCafe = {
  id: 'cafe',
  public: true,
  allowedActions: ['talk'],
  baseRisk: 0.1,
  allowsDeadDrops: false,
  namePatterns: ['Café {pick:names}'],
  descriptionPool: ['A warm coffee house.'],
  atmosphereTags: ['smoky'],
  tags: ['function:meeting-spot', 'access:public'],
};

const tagVocabulary = {
  facets: [
    { id: 'function', appliesTo: ['location', 'location-type'] },
    { id: 'access', appliesTo: ['location', 'location-type'] },
    { id: 'role', appliesTo: ['archetype'] },
    { id: 'climate', appliesTo: ['city', 'descriptor-fragment'] },
    { id: 'org', appliesTo: ['local-org'] },
    { id: 'cover', appliesTo: ['cover-identity'] },
    { id: 'area', appliesTo: ['district'] },
  ],
  tags: [
    { id: 'function:meeting-spot', description: 'A place to meet.' },
    { id: 'access:public', description: 'Open to the public.' },
    { id: 'role:civilian', description: 'An ordinary civilian.' },
    { id: 'climate:temperate', description: 'A temperate city.' },
    { id: 'org:labour', description: 'A labour organisation.' },
    { id: 'cover:press', description: 'A press cover.' },
    { id: 'area:central', description: 'A central district.' },
  ],
  requiredQueries: [],
};

/** A core pack with the Tag Vocabulary and one tagged archetype + Location Type. */
function corePack(): PackFiles {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2, role: 'core' },
    'predicates.yaml': [predicateMeetsAt],
    'personas.yaml': [personaAustrian],
    'descriptors.yaml': descriptorsCore,
    'tags.yaml': tagVocabulary,
    'archetypes.yaml': [archetypeCivilian],
    'location-types.yaml': [locationTypeCafe],
    // A base Document template so a city Template Variant can target it.
    'documents.yaml': [
      {
        id: 'cafe-article',
        kind: 'newspaper',
        titlePattern: '{headline}',
        sections: [{ id: 'lede', body: 'A meeting at {place} {when}.' }],
      },
    ],
  };
}

const eraLocale = {
  scope: { era: 'cold-war' },
  date: {
    long: '{weekday}, {day} {month} {year}',
    short: '{day}.{month}.{year}',
    months: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    weekdays: [
      'Sonntag',
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
    ],
  },
  currency: { pattern: '{amount} {symbol}' },
  honorifics: { f: ['Frau'], m: ['Herr'] },
  address: '{street} {number}, {district}',
  terms: [],
  allowNames: [],
};

/** An Era Pack: an era record plus an era-scoped Locale. */
function eraPack(): PackFiles {
  return {
    'pack.yaml': {
      id: 'era',
      version: '1.0.0',
      contentSchema: 2,
      role: 'era',
      requires: [{ id: 'core', range: '^1.0.0' }],
    },
    'era.yaml': [{ id: 'cold-war', period: { from: 1945, to: 1965 } }],
    'locale.yaml': [eraLocale],
    'services.yaml': [
      { id: 'own-service', name: 'The Firm', kind: 'own', country: 'United Kingdom' },
    ],
  };
}

/** A Library Pack with one Culture Group and two Descriptor Fragments. */
function libraryPack(): PackFiles {
  return {
    'pack.yaml': {
      id: 'lib',
      version: '1.0.0',
      contentSchema: 2,
      role: 'library',
      requires: [{ id: 'core', range: '^1.0.0' }],
    },
    'culture-groups.yaml': [
      {
        id: 'austrian-german',
        name: 'Austrian German',
        languages: ['de'],
        naming: { display: '{given} {family}', formal: '{honorific} {family}' },
        given: { f: ['Maria'], m: ['Franz'] },
        family: ['Huber'],
      },
    ],
    'descriptor-fragments.yaml': [
      { id: 'tall', slot: 'build', text: 'tall and lean' },
      {
        id: 'fur-hat',
        slot: 'headwear',
        text: 'a fur hat',
        climate: ['climate:temperate'],
      },
    ],
  };
}

const cityLocale = {
  scope: { city: 'vienna' },
  date: eraLocale.date,
  currency: { pattern: '{symbol}{amount}' },
  honorifics: { f: ['Frau'], m: ['Herr'] },
  address: '{street} {number}, {district}',
  terms: [{ term: 'Beisl', definition: 'A small tavern.' }],
  allowNames: ['Prater'],
};

/** A City Pack with a city.yaml and the full span of City-Scoped content. */
function cityPack(): PackFiles {
  return {
    'pack.yaml': {
      id: 'city-vienna',
      version: '1.0.0',
      contentSchema: 2,
      role: 'city',
      requires: [
        { id: 'core', range: '^1.0.0' },
        { id: 'era', range: '^1.0.0' },
      ],
    },
    'city.yaml': {
      id: 'vienna',
      name: 'Vienna',
      country: 'Austria',
      climate: 'climate:temperate',
      period: { from: 1945, to: 1955 },
      startDates: { from: '1948-01-01', to: '1948-12-31' },
      currency: {
        name: 'Schilling',
        symbol: 'S',
        subunit: 'Groschen',
        format: '{symbol}{amount}',
        rounding: 1,
        budgetScale: 1,
      },
      languages: [{ id: 'de', name: 'German', share: 1 }],
      cultureWeights: [{ group: 'lib/austrian-german', weight: 1 }],
      services: ['era/own-service'],
    },
    'districts.yaml': [
      {
        id: 'innere-stadt',
        city: 'vienna',
        name: 'Innere Stadt',
        description: 'The old centre.',
        tags: ['area:central'],
      },
      {
        id: 'leopoldstadt',
        city: 'vienna',
        name: 'Leopoldstadt',
        description: 'Across the canal.',
        tags: ['area:central'],
      },
    ],
    'routes.yaml': [{ a: 'innere-stadt', b: 'leopoldstadt', cost: 1 }],
    'locations.yaml': [
      {
        id: 'cafe-central',
        name: 'Café Central',
        type: 'core/cafe',
        district: 'innere-stadt',
        public: true,
        description: 'A grand coffee house.',
        city: 'vienna',
        tags: ['function:meeting-spot'],
        basis: 'real-landmark',
        sources: ['central-src'],
      },
    ],
    'newspapers.yaml': [
      {
        id: 'kurier',
        city: 'vienna',
        masthead: 'Wiener Kurier',
        language: 'de',
        stance: 'liberal',
        register: 'formal',
        days: ['monday', 'thursday'],
        price: 1,
        soldAt: ['function:meeting-spot'],
      },
    ],
    'local-orgs.yaml': [
      {
        id: 'tram-union',
        city: 'vienna',
        name: 'Tramway Union',
        kind: 'union',
        tags: ['org:labour'],
        members: [],
      },
    ],
    'weather.yaml': [
      {
        city: 'vienna',
        months: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [
            String(i + 1),
            [{ id: 'clear', label: 'clear', weight: 1 }],
          ]),
        ),
      },
    ],
    'streets.yaml': [{ id: 'inner', names: ['Kärntner Straße', 'Graben'] }],
    'sources.yaml': [{ id: 'central-src', title: 'Vienna 1950', kind: 'book' }],
    'cover-identities.yaml': [
      {
        id: 'journalist',
        title: 'Foreign correspondent',
        employerOrg: 'Wiener Kurier',
        fitLocationTypes: ['core/cafe'],
        suspicionModifiers: { atFit: -0.1, elsewhere: 0.1 },
        tags: ['cover:press'],
      },
    ],
    'locale.yaml': [cityLocale],
    'template-variants.yaml': [
      {
        id: 'vienna-cafe',
        base: 'core/cafe-article',
        scope: { city: 'vienna' },
        template: '{headline}\nTreffen im {place} {when}.',
      },
    ],
  };
}

// --- tests -----------------------------------------------------------------

describe('ContentSet additions (content-expansion task 2.4)', () => {
  function loadFull(): ContentSet {
    const dirs = writePacks({
      core: corePack(),
      era: eraPack(),
      lib: libraryPack(),
      'city-vienna': cityPack(),
    });
    return expectOk(loadContent(dirs, ['core', 'era', 'lib', 'city-vienna']));
  }

  it('exposes the effective registry on the Content Set', () => {
    const set = loadFull();
    const kinds = set.registry.map((r) => r.kind);
    expect(kinds).toContain('city');
    expect(kinds).toContain('culture-group');
    expect(kinds).toContain('era');
  });

  it('merges the Tag Vocabulary (facets, tags, required queries)', () => {
    const set = loadFull();
    expect(set.tagVocabulary.tags.map((t) => t.id)).toContain('function:meeting-spot');
    expect(set.tagVocabulary.facets.map((f) => f.id)).toContain('climate');
  });

  it('builds the Era Bundle with its period and era Locale', () => {
    const set = loadFull();
    expect(set.era?.id).toBe('era/cold-war');
    expect(set.era?.period).toEqual({ from: 1945, to: 1965 });
    expect(set.era?.locale?.honorifics.m).toContain('Herr');
  });

  it('collects Culture Groups and Descriptor Fragments from the Library Pack', () => {
    const set = loadFull();
    expect(set.cultureGroups['lib/austrian-german']?.name).toBe('Austrian German');
    expect(set.descriptorFragments.map((d) => d.id).sort()).toEqual([
      'fur-hat',
      'tall',
    ]);
  });

  it('builds a City Bundle grouping all of the city pack content', () => {
    const set = loadFull();
    const bundle = set.cities['city-vienna/vienna'];
    expect(bundle).toBeDefined();
    expect(bundle.def.name).toBe('Vienna');
    expect(bundle.districts.map((d) => d.id).sort()).toEqual([
      'innere-stadt',
      'leopoldstadt',
    ]);
    expect(bundle.routes).toHaveLength(1);
    expect(bundle.locations.map((l) => l.id)).toEqual(['cafe-central']);
    expect(bundle.newspapers.map((n) => n.id)).toEqual(['kurier']);
    expect(bundle.orgs.map((o) => o.id)).toEqual(['tram-union']);
    expect(bundle.covers.map((c) => c.id)).toEqual(['journalist']);
    expect(bundle.sources.map((s) => s.id)).toEqual(['central-src']);
    expect(bundle.streets).toEqual(['Kärntner Straße', 'Graben']);
    expect(bundle.weather.months['1'][0].id).toBe('clear');
    expect(bundle.variants.map((v) => v.id)).toEqual(['vienna-cafe']);
  });

  it('uses the city Locale when the city defines one', () => {
    const set = loadFull();
    const bundle = set.cities['city-vienna/vienna'];
    expect('city' in bundle.locale.scope).toBe(true);
    expect(bundle.locale.currency.pattern).toBe('{symbol}{amount}');
    expect(bundle.locale.terms[0].term).toBe('Beisl');
  });

  it('records city-scope ownership for the city definition and its scoped items', () => {
    const set = loadFull();
    // city.yaml and the city-scoped service are owned by the city.
    expect(set.cityScopeOwner['city-vienna/vienna']).toBe('city-vienna/vienna');
    // A shared, non-scoped item (a core Location Type) is not recorded.
    expect(set.cityScopeOwner['core/cafe']).toBeUndefined();
  });

  it('leaves cities empty and era undefined for a core-only load', () => {
    const dirs = writePacks({ core: corePack() });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(Object.keys(set.cities)).toEqual([]);
    expect(set.era).toBeUndefined();
    expect(set.cultureGroups).toEqual({});
    expect(set.descriptorFragments).toEqual([]);
  });
});
