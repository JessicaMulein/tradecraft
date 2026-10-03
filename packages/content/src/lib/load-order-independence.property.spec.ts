// Feature: content-expansion, Property 2: Load-order independence for any conforming subset.
//
// "For any set of conforming packs of any roles closed under `requires`,
// loading from any permutation of input directories yields an identical
// Content Set and Content Manifest." (content-expansion design, Correctness
// Properties, Property 2.) Validates: Requirements 1.6, 10.1.
//
// The slice already proves order independence for the slice content kinds
// (`loader-order.spec.ts`, slice Property 24). This content-expansion property
// extends that guarantee to the new Pack Roles (`core`, `era`, `library`,
// `city`) and the new ContentSet fields the loader builds from them: `cities`
// (the per-city CityBundle), `era`, `cultureGroups`, `descriptorFragments`,
// `tagVocabulary`, `cityScopeOwner`, `services` and the Template Variants.
//
// Req 10.1 (several City Packs load side by side) is covered by loading two
// City Packs together: the generated set carries both `city-vienna` and
// `city-berlin`, each requiring the one Era Pack, and the property asserts the
// merged Content Set is identical no matter the order the directories and the
// selected ids are given in. The loader fixes the load order itself (packs are
// topologically ordered with ties broken by id), so neither input order may
// change the merge, the per-pack hashes or the manifest.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent, type ContentSet } from '../index.js';

// --- fixture helpers (mirrors content-set-build.spec.ts) -------------------

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

function writePacks(packs: Record<string, PackFiles>): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'tc-lo2-'));
  tempRoots.push(root);
  const dirs: Record<string, string> = {};
  for (const [name, files] of Object.entries(packs)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const [rel, value] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof value === 'string' ? value : toYaml(value), 'utf8');
    }
    dirs[name] = dir;
  }
  return dirs;
}

function loadOk(dirs: readonly string[], selected: readonly string[]): ContentSet {
  const result = loadContent(dirs, selected);
  if (!result.ok) {
    throw new Error(
      `expected load to succeed, got errors:\n${JSON.stringify(result.errors, null, 2)}`,
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

function corePack(): PackFiles {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2, role: 'core' },
    'predicates.yaml': [predicateMeetsAt],
    'personas.yaml': [personaAustrian],
    'descriptors.yaml': descriptorsCore,
    'tags.yaml': tagVocabulary,
    'archetypes.yaml': [archetypeCivilian],
    'location-types.yaml': [locationTypeCafe],
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

/**
 * A City Pack parameterised by its pack id and city id, so the fixture can
 * carry several conforming City Packs side by side (Req 10.1). Each requires
 * the one shared Era Pack. The internal City-Scoped ids (districts, locations,
 * …) are prefixed with the city so two cities' content never collides.
 */
function cityPack(packId: string, cityId: string, cityName: string): PackFiles {
  const cityLocale = {
    scope: { city: cityId },
    date: eraLocale.date,
    currency: { pattern: '{symbol}{amount}' },
    honorifics: { f: ['Frau'], m: ['Herr'] },
    address: '{street} {number}, {district}',
    terms: [{ term: 'Beisl', definition: 'A small tavern.' }],
    allowNames: [cityName],
  };

  const d1 = `${cityId}-central`;
  const d2 = `${cityId}-outer`;

  return {
    'pack.yaml': {
      id: packId,
      version: '1.0.0',
      contentSchema: 2,
      role: 'city',
      requires: [
        { id: 'core', range: '^1.0.0' },
        { id: 'era', range: '^1.0.0' },
      ],
    },
    'city.yaml': {
      id: cityId,
      name: cityName,
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
        id: d1,
        city: cityId,
        name: `${cityName} Centre`,
        description: 'The old centre.',
        tags: ['area:central'],
      },
      {
        id: d2,
        city: cityId,
        name: `${cityName} Outskirts`,
        description: 'Across the canal.',
        tags: ['area:central'],
      },
    ],
    'routes.yaml': [{ a: d1, b: d2, cost: 1 }],
    'locations.yaml': [
      {
        id: `${cityId}-cafe`,
        name: `Café ${cityName}`,
        type: 'core/cafe',
        district: d1,
        public: true,
        description: 'A grand coffee house.',
        city: cityId,
        tags: ['function:meeting-spot'],
        basis: 'real-landmark',
        sources: [`${cityId}-src`],
      },
    ],
    'newspapers.yaml': [
      {
        id: `${cityId}-paper`,
        city: cityId,
        masthead: `${cityName} Kurier`,
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
        id: `${cityId}-union`,
        city: cityId,
        name: 'Tramway Union',
        kind: 'union',
        tags: ['org:labour'],
        members: [],
      },
    ],
    'weather.yaml': [
      {
        city: cityId,
        months: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [
            String(i + 1),
            [{ id: 'clear', label: 'clear', weight: 1 }],
          ]),
        ),
      },
    ],
    'streets.yaml': [{ id: `${cityId}-inner`, names: ['Kärntner Straße', 'Graben'] }],
    'sources.yaml': [{ id: `${cityId}-src`, title: `${cityName} 1950`, kind: 'book' }],
    'cover-identities.yaml': [
      {
        id: `${cityId}-journalist`,
        title: 'Foreign correspondent',
        employerOrg: `${cityName} Kurier`,
        fitLocationTypes: ['core/cafe'],
        suspicionModifiers: { atFit: -0.1, elsewhere: 0.1 },
        tags: ['cover:press'],
      },
    ],
    'locale.yaml': [cityLocale],
    'template-variants.yaml': [
      {
        id: `${cityId}-cafe`,
        base: 'core/cafe-article',
        scope: { city: cityId },
        template: '{headline}\nTreffen im {place} {when}.',
      },
    ],
  };
}

// --- comparable projection -------------------------------------------------

/**
 * Project a {@link ContentSet} into a plain, order-independent value for deep
 * equality. The slice registries are `Map`s whose iteration order follows the
 * merge; sorting their entries by key removes any dependence on the order packs
 * were loaded. The content-expansion fields (`cities`, `cultureGroups`,
 * `cityScopeOwner`) are plain records, so their keys are sorted too, and the
 * `descriptorFragments` and `services` lists are sorted by id. The Template
 * Variants are compared both as their authored data (`templateVariantDefs`) and
 * as the sorted key sets of the compiled index, which captures how resolution
 * is wired without deep-comparing compiled ASTs. The manifest is kept as-is: it
 * is an array in the loader's fixed order, so a reordering would still be
 * caught.
 */
function comparable(set: ContentSet): unknown {
  const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sortedEntries = (map: ReadonlyMap<string, unknown>): [string, unknown][] =>
    [...map.entries()].sort((x, y) => byKey(x[0], y[0]));
  const sortedRecord = (rec: Readonly<Record<string, unknown>>): [string, unknown][] =>
    Object.entries(rec).sort((x, y) => byKey(x[0], y[0]));

  return {
    manifest: set.manifest,
    // Slice kinds that the new packs still populate.
    archetypes: sortedEntries(set.archetypes),
    locationTypes: sortedEntries(set.locationTypes),
    personaLibraries: sortedEntries(set.personaLibraries),
    coverIdentities: sortedEntries(set.coverIdentities),
    documentTemplates: sortedEntries(set.documentTemplates),
    predicates: set.predicates.predicates
      .map((p) => ({ id: p.id, fieldCode: p.fieldCode, evaluator: p.evaluator }))
      .sort((x, y) => byKey(x.id, y.id)),
    // Content-expansion additions (the new Pack Roles and ContentSet fields).
    services: sortedEntries(set.services),
    cities: sortedRecord(set.cities),
    era: set.era,
    cultureGroups: sortedRecord(set.cultureGroups),
    descriptorFragments: [...set.descriptorFragments].sort((x, y) =>
      byKey(x.id, y.id),
    ),
    tagVocabulary: {
      facets: [...set.tagVocabulary.facets].sort((x, y) => byKey(x.id, y.id)),
      tags: [...set.tagVocabulary.tags].sort((x, y) => byKey(x.id, y.id)),
      requiredQueries: set.tagVocabulary.requiredQueries,
    },
    cityScopeOwner: sortedRecord(set.cityScopeOwner),
    registry: [...set.registry].map((r) => r.kind).sort(byKey),
    templateVariantDefs: sortedEntries(set.templateVariantDefs),
    templateVariantIndex: {
      bases: [...set.templateVariants.bases.keys()].sort(byKey),
      cityVariants: [...set.templateVariants.cityVariants.keys()].sort(byKey),
      eraVariants: [...set.templateVariants.eraVariants.keys()].sort(byKey),
    },
  };
}

// --- generators ------------------------------------------------------------

/** All pack ids in the full conforming fixture, in dependency order. */
const ALL_IDS = ['core', 'era', 'lib', 'city-vienna', 'city-berlin'] as const;

/** A permutation of the given array, as an arbitrary. */
function permutationArb<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], {
    minLength: items.length,
    maxLength: items.length,
  });
}

/**
 * A conforming subset closed under `requires`: `core` always, optionally the
 * Era Pack and Library Pack, and 0–2 City Packs. A City Pack is only offered
 * when the Era Pack is present (every City Pack requires exactly one Era Pack),
 * so every generated subset is loadable. This exercises Property 2 over the
 * roles the slice loader-order test does not reach, and the two-city case
 * covers side-by-side loading (Req 10.1).
 */
const subsetArb: fc.Arbitrary<string[]> = fc
  .record({
    era: fc.boolean(),
    lib: fc.boolean(),
    cities: fc.subarray(['city-vienna', 'city-berlin'], { minLength: 0 }),
  })
  .map(({ era, lib, cities }) => {
    const ids = ['core'];
    // City Packs require the Era Pack, so include it whenever a city is chosen.
    const withEra = era || cities.length > 0;
    if (withEra) ids.push('era');
    if (lib) ids.push('lib');
    ids.push(...cities);
    return ids;
  });

// --- the property ----------------------------------------------------------

describe('Property 2: load-order independence for conforming pack sets', () => {
  it('yields an identical Content Set and Manifest for any input permutation', () => {
    fc.assert(
      fc.property(
        subsetArb.chain((ids) =>
          fc.record({
            ids: fc.constant(ids),
            dirOrder: permutationArb(ids),
            selectedOrder: permutationArb(ids),
          }),
        ),
        ({ ids, dirOrder, selectedOrder }) => {
          const allPacks: Record<string, PackFiles> = {
            core: corePack(),
            era: eraPack(),
            lib: libraryPack(),
            'city-vienna': cityPack('city-vienna', 'vienna', 'Vienna'),
            'city-berlin': cityPack('city-berlin', 'berlin', 'Berlin'),
          };
          // Only lay out the packs this subset uses.
          const packs = Object.fromEntries(
            Object.entries(allPacks).filter(([id]) => ids.includes(id)),
          );
          const dirOf = writePacks(packs);

          // Baseline: dirs and selected in dependency order.
          const baseline = loadOk(
            ids.map((id) => dirOf[id]),
            ids,
          );

          // Permuted: the same packs, dirs and selected ids shuffled.
          const permuted = loadOk(
            dirOrder.map((id) => dirOf[id]),
            selectedOrder,
          );

          expect(comparable(permuted)).toEqual(comparable(baseline));
          // The manifest's pack order is fixed by the loader, not the inputs.
          expect(permuted.manifest).toEqual(baseline.manifest);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it('loads two City Packs side by side with an identical set in any order', () => {
    // A direct Req 10.1 check: both City Packs, every input order shuffled.
    fc.assert(
      fc.property(
        fc.record({
          dirOrder: permutationArb(ALL_IDS),
          selectedOrder: permutationArb(ALL_IDS),
        }),
        ({ dirOrder, selectedOrder }) => {
          const dirOf = writePacks({
            core: corePack(),
            era: eraPack(),
            lib: libraryPack(),
            'city-vienna': cityPack('city-vienna', 'vienna', 'Vienna'),
            'city-berlin': cityPack('city-berlin', 'berlin', 'Berlin'),
          });

          const baseline = loadOk(
            ALL_IDS.map((id) => dirOf[id]),
            [...ALL_IDS],
          );
          const permuted = loadOk(
            dirOrder.map((id) => dirOf[id]),
            selectedOrder,
          );

          // Both cities are present and side-by-side loading succeeds.
          expect(Object.keys(baseline.cities).sort()).toEqual([
            'city-berlin/berlin',
            'city-vienna/vienna',
          ]);
          expect(comparable(permuted)).toEqual(comparable(baseline));
          expect(permuted.manifest).toEqual(baseline.manifest);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
