// Feature: content-expansion, Property 4: Linter detects every seeded defect.
//
// "For any conforming pack set:
//  - the Pack Linter reports no error finding, and exits with status 0, on the
//    clean set;
//  - for any non-empty set of independently seeded defects drawn from the
//    Defect Classes of Req 13.2 (also covering role and era-requirement errors,
//    missing Tags, cross-city references, unregistered kinds, Quantity
//    shortfalls under `release`, style violations and defects in an
//    extension-registered kind), the linter reports at least one finding of each
//    seeded class, located at the seeded pack, file and path, and exits non-zero
//    if any seeded class has error severity;
//  - the output is identical across repeated runs and directory permutations."
//    (content-expansion design, Correctness Properties, Property 4.)
//
// Validates: Requirements 1.3, 1.4, 1.5, 3.1, 3.4, 3.8, 4.3, 4.4, 4.8, 10.2,
// 11.8, 12.6, 13.1, 13.2, 13.3, 13.4, 13.8, 17.2.
//
// Approach. A conforming base pack set — a `core` pack with a Tag Vocabulary, an
// Era Pack, a Library Pack and a City Pack — loads cleanly through `lint()`
// (the base fixture mirrors the loader's own `load-order-independence` property
// fixture, so it is a known-good conforming set). Each Defect Class has a
// seeding function: it mutates a fresh deep copy of the base packs to inject
// exactly one defect and declares the rule that defect belongs to and the
// pack/file/path it should be located at. A fast-check run draws a non-empty
// subset of the Defect Classes; each is seeded independently into its own copy
// and linted on its own, so a finding is attributable to the one seeded defect.
// The property asserts the matching rule fires at the seeded location, that an
// error-severity class drives a non-zero exit, and that the output is identical
// across directory permutations and repeated runs.
//
// `lint()` is exercised end-to-end (parse → load → map loader errors → run the
// generic Field-Declaration rules → suppressions → sort), so both the
// loader-backed rules (CE-SCHEMA, CE-REF, CE-DUPID, CE-SLOT, CE-TAG, CE-CONFORM,
// CE-VARIANT, CE-PROVENANCE) and the generic rules (CE-ANACH, CE-PERIOD,
// CE-DUPTEXT, CE-NEARDUP, CE-NAMEDUP, CE-REALPERSON, CE-SENSITIVE, CE-STYLE,
// CE-ALLOWLIST, CE-SOURCE) run through the same path the CLI uses. The
// extension-registered-kind case registers one extra kind through
// `LoadOptions.kinds` and seeds an anachronism in its declared `text` field, so
// Req 17.2 / 13.8 are covered too.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import type { ContentKindRegistration } from '@tradecraft/content';

import { lint, type LintOptions } from './lint.js';
import { exitCodeFor, formatJson } from './output.js';
import { RULES_BY_ID } from './rules.js';

// --- fixtures: an on-disk conforming pack set ------------------------------

type PackFiles = Record<string, unknown>;
type PackSet = Record<string, PackFiles>;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Write every pack directory under a fresh temp root; return id → dir. */
function writePacks(packs: PackSet): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'tc-defect-'));
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

/** A structural deep clone of the base pack set, so a seed never leaks across runs. */
function clonePacks(packs: PackSet): PackSet {
  return structuredClone(packs);
}

// --- reusable conforming content (mirrors load-order-independence fixture) --

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
  namePools: [{ culture: 'austrian', gender: 'male', given: ['Franz'], family: ['Huber'] }],
  backgrounds: ['A lifelong Viennese.'],
};

const descriptorsCore = {
  version: 1,
  shared: { build: ['lean'] },
  pools: { 'street-clothes': { garments: [{ text: 'a raincoat', fits: 'any' }] } },
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
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    ],
    weekdays: [
      'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
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
    // A period-correct anachronism catalogue, a Real-Person Blocklist, a
    // Sensitivity Term list and a mechanical Style Guide. The clean set never
    // trips them; the seeds below plant text that does.
    'anachronisms.yaml': [
      { term: 'the Wall', pattern: 'the wall', earliest: 1961, note: 'Berlin Wall' },
    ],
    'technology.yaml': [
      { id: 'transistor-radio', name: 'transistor radio', aliases: [], category: 'radio', introduced: 1954 },
    ],
    'blocklist.yaml': [{ name: 'Konrad Adenauer', note: 'chancellor' }],
    'sensitivity.yaml': [{ term: 'a slur', pattern: 'a slur' }],
    // A mechanical Style Guide rule on the `other` template surface — the style
    // the slice `document` kind declares for titles and bodies — so a seeded
    // exclamation in a document title trips CE-STYLE through `lint()`. The
    // clean documents carry no exclamation, so the rule stays silent on the
    // conforming set.
    'style-guide.yaml': [
      { id: 'no-bang', appliesTo: ['other'], check: 'no-exclamation', message: 'no exclamation marks' },
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
      { id: 'fur-hat', slot: 'headwear', text: 'a fur hat', climate: ['climate:temperate'] },
    ],
  };
}

function cityPack(): PackFiles {
  const cityId = 'vienna';
  const d1 = 'vienna-central';
  const d2 = 'vienna-outer';
  const cityLocale = {
    scope: { city: cityId },
    date: eraLocale.date,
    currency: { pattern: '{symbol}{amount}' },
    honorifics: { f: ['Frau'], m: ['Herr'] },
    address: '{street} {number}, {district}',
    terms: [{ term: 'Beisl', definition: 'A small tavern.' }],
    allowNames: ['Vienna'],
  };
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
      id: cityId,
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
      instantiation: { districts: [1, 2], locations: [1, 1] },
    },
    'districts.yaml': [
      { id: d1, city: cityId, name: 'Vienna Centre', description: 'The old centre.', tags: ['area:central'] },
      { id: d2, city: cityId, name: 'Vienna Outskirts', description: 'Across the canal.', tags: ['area:central'] },
    ],
    'routes.yaml': [{ a: d1, b: d2, cost: 1 }],
    'locations.yaml': [
      {
        id: 'vienna-cafe',
        name: 'Café Vienna',
        type: 'core/cafe',
        district: d1,
        public: true,
        description: 'A grand coffee house.',
        city: cityId,
        tags: ['function:meeting-spot'],
        basis: 'real-landmark',
        sources: ['vienna-src'],
      },
    ],
    'newspapers.yaml': [
      {
        id: 'vienna-paper',
        city: cityId,
        masthead: 'Vienna Kurier',
        language: 'de',
        stance: 'liberal',
        register: 'formal',
        days: ['monday', 'thursday'],
        price: 1,
        soldAt: ['function:meeting-spot'],
      },
    ],
    'local-orgs.yaml': [
      { id: 'vienna-union', city: cityId, name: 'Tramway Union', kind: 'union', tags: ['org:labour'], members: [] },
    ],
    'weather.yaml': [
      {
        city: cityId,
        months: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [String(i + 1), [{ id: 'clear', label: 'clear', weight: 1 }]]),
        ),
      },
    ],
    'streets.yaml': [{ id: 'vienna-inner', names: ['Kärntner Straße', 'Graben'] }],
    'sources.yaml': [{ id: 'vienna-src', title: 'Vienna 1950', kind: 'book' }],
    'cover-identities.yaml': [
      {
        id: 'vienna-journalist',
        title: 'Foreign correspondent',
        employerOrg: 'Vienna Kurier',
        fitLocationTypes: ['core/cafe'],
        suspicionModifiers: { atFit: -0.1, elsewhere: 0.1 },
        tags: ['cover:press'],
      },
    ],
    'locale.yaml': [cityLocale],
    'template-variants.yaml': [
      {
        id: 'vienna-cafe-variant',
        base: 'core/cafe-article',
        scope: { city: cityId },
        template: '{headline}\nTreffen im {place} {when}.',
      },
    ],
  };
}

/** The full conforming base set and its load order. */
function basePacks(): PackSet {
  return {
    core: corePack(),
    era: eraPack(),
    lib: libraryPack(),
    'city-vienna': cityPack(),
  };
}

const BASE_IDS = ['core', 'era', 'lib', 'city-vienna'] as const;

// --- an extension-registered kind (Req 17.2, 13.8) -------------------------

/**
 * One extra content kind a follow-on package would register through
 * `LoadOptions.kinds`: a `briefing` with a prose `text` field and a `years`
 * Year Range. The linter walks its Field Declarations exactly like a built-in
 * kind, so a seeded anachronism in its `text` is caught by CE-ANACH (Req 13.8)
 * and the loader accepts the kind rather than refusing it (Req 17.2).
 */
const briefingKind: ContentKindRegistration = {
  kind: 'briefing',
  dir: 'briefings',
  schema: z.object({ id: z.string(), text: z.string(), years: z.unknown().optional() }).strict(),
  roles: ['era', 'city', 'extension', 'core', 'library'],
  cityScoped: false,
  owner: '@tradecraft/test-extension',
  fields: { text: ['items[].text'], years: ['items[].years'] },
};

const EXTENSION_KINDS: readonly ContentKindRegistration[] = [briefingKind];

// --- helpers ---------------------------------------------------------------

/** Deep-set a value at a dotted/indexed path inside a plain object graph. */
function setAt(root: unknown, segments: readonly (string | number)[], value: unknown): void {
  let node = root as Record<string | number, unknown>;
  for (let i = 0; i < segments.length - 1; i += 1) {
    node = node[segments[i]] as Record<string | number, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

// --- the Defect Classes -----------------------------------------------------

/**
 * One seeded Defect Class: a human label, the rule the linter must report it
 * under, the pack and file it lands in, whether the finding is an error (so the
 * exit code must be non-zero), the `lint()` options the case needs, and the
 * mutation that injects exactly one defect into a fresh copy of the base set.
 * `expectPath`, when given, pins the located path; otherwise the case only
 * pins the pack, file and rule (used where the loader's own path is internal).
 */
interface DefectClass {
  readonly label: string;
  readonly rule: string;
  readonly pack: string;
  readonly file: string;
  readonly error: boolean;
  readonly profile?: 'draft' | 'release';
  readonly kinds?: readonly ContentKindRegistration[];
  readonly expectPath?: string;
  seed(packs: PackSet): void;
}

const DEFECT_CLASSES: readonly DefectClass[] = [
  // CE-SCHEMA — a schema violation: a required field dropped from a core item.
  {
    label: 'schema violation',
    rule: 'CE-SCHEMA',
    pack: 'core',
    file: 'archetypes.yaml',
    error: true,
    seed(packs) {
      delete (packs.core['archetypes.yaml'] as Array<Record<string, unknown>>)[0].role;
    },
  },
  // CE-SCHEMA — an unregistered content kind (Req 17.2): a file of no kind.
  {
    label: 'unregistered kind',
    rule: 'CE-SCHEMA',
    pack: 'core',
    file: 'spaceships.yaml',
    error: true,
    seed(packs) {
      packs.core['spaceships.yaml'] = [{ id: 'enterprise' }];
    },
  },
  // CE-REF — a dangling reference: a city services entry that resolves to nothing.
  {
    label: 'dangling reference',
    rule: 'CE-REF',
    pack: 'city-vienna',
    file: 'cross-reference',
    error: true,
    expectPath: 'vienna.services[1]',
    seed(packs) {
      (packs['city-vienna']['city.yaml'] as Record<string, unknown>).services = [
        'era/own-service',
        'phantom-service',
      ];
    },
  },
  // CE-REF — a cross-city reference (Req 10.2): the City Pack's `services`
  // names a service namespaced to another city, which no loaded pack owns. A
  // reference reaching into another city's content does not resolve and is
  // reported under CE-REF on the city pack's `cross-reference`.
  {
    label: 'cross-city reference',
    rule: 'CE-REF',
    pack: 'city-vienna',
    file: 'cross-reference',
    error: true,
    expectPath: 'vienna.services[1]',
    seed(packs) {
      (packs['city-vienna']['city.yaml'] as Record<string, unknown>).services = [
        'era/own-service',
        'city-berlin/local-security',
      ];
    },
  },
  // CE-DUPID — a duplicate id within a kind.
  {
    label: 'duplicate id',
    rule: 'CE-DUPID',
    pack: 'core',
    file: 'archetypes.yaml',
    error: true,
    seed(packs) {
      (packs.core['archetypes.yaml'] as Array<Record<string, unknown>>).push({
        ...archetypeCivilian,
      });
    },
  },
  // CE-SLOT — an undeclared template slot in a document section body.
  {
    label: 'undeclared slot',
    rule: 'CE-SLOT',
    pack: 'core',
    file: 'predicates.yaml',
    error: true,
    seed(packs) {
      // Add an unknown slot to a predicate render string; the predicate
      // registry's slot check refuses an unknown slot against the declared set.
      setAt(
        packs.core['predicates.yaml'],
        [0, 'render', 'third'],
        '{subject} meets {object} at {place} {when} with {stranger}.',
      );
    },
  },
  // CE-TAG — a Tag not in the Tag Vocabulary.
  {
    label: 'unknown Tag',
    rule: 'CE-TAG',
    pack: 'core',
    file: 'location-types.yaml',
    error: true,
    seed(packs) {
      (packs.core['location-types.yaml'] as Array<Record<string, unknown>>)[0].tags = [
        'function:meeting-spot',
        'function:does-not-exist',
      ];
    },
  },
  // CE-CONFORM — a Tag Conformance shortfall: a Required Query no City Pack binds.
  {
    label: 'tag conformance shortfall',
    rule: 'CE-CONFORM',
    pack: 'city-vienna',
    file: 'tag-conformance',
    error: true,
    seed(packs) {
      (packs.core['tags.yaml'] as Record<string, unknown>).requiredQueries = [
        {
          id: 'needs-safehouse',
          query: ['function:meeting-spot', 'access:public'],
          minStatic: 5,
          minInstantiated: 0,
        },
      ];
    },
  },
  // CE-ANACH — an anachronism term before its earliest year.
  {
    label: 'anachronism',
    rule: 'CE-ANACH',
    pack: 'lib',
    file: 'descriptor-fragments.yaml',
    error: true,
    seed(packs) {
      // Put the post-1961 term into a persona background text field (era 1945+).
      (packs.lib['descriptor-fragments.yaml'] as Array<Record<string, unknown>>)[0].text =
        'crossing at the Wall';
    },
  },
  // CE-PERIOD — a Year Range outside the Period Window.
  {
    label: 'out-of-period year range',
    rule: 'CE-PERIOD',
    pack: 'city-vienna',
    file: 'routes.yaml',
    error: true,
    seed(packs) {
      (packs['city-vienna']['routes.yaml'] as Array<Record<string, unknown>>)[0].years = {
        from: 1970,
        to: 1975,
      };
    },
  },
  // CE-DUPTEXT — exact duplicate text within one (kind, field).
  {
    label: 'exact duplicate text',
    rule: 'CE-DUPTEXT',
    pack: 'lib',
    file: 'descriptor-fragments.yaml',
    error: false,
    seed(packs) {
      const frags = packs.lib['descriptor-fragments.yaml'] as Array<Record<string, unknown>>;
      frags[1].slot = 'build';
      frags[1].text = 'tall and lean';
      delete frags[1].climate;
    },
  },
  // CE-NEARDUP — near-duplicate text above the Jaccard threshold.
  {
    label: 'near-duplicate text',
    rule: 'CE-NEARDUP',
    pack: 'core',
    file: 'personas.yaml',
    error: false,
    seed(packs) {
      // Two long, nearly identical persona backgrounds in the same field group.
      const long = Array.from({ length: 16 }, (_, i) => `word${i}`).join(' ');
      (packs.core['personas.yaml'] as Array<Record<string, unknown>>)[0].backgrounds = [
        long,
        long.replace('word15', 'wordX'),
      ];
    },
  },
  // CE-NAMEDUP — a repeated entry inside one Name Pool.
  {
    label: 'name-pool duplicate',
    rule: 'CE-NAMEDUP',
    pack: 'lib',
    file: 'culture-groups.yaml',
    error: true,
    seed(packs) {
      (packs.lib['culture-groups.yaml'] as Array<Record<string, unknown>>)[0].given = {
        f: ['Maria'],
        m: ['Franz', 'Franz'],
      };
    },
  },
  // CE-REALPERSON — a Real-Person Blocklist match in a text field.
  {
    label: 'real-person blocklist match',
    rule: 'CE-REALPERSON',
    pack: 'lib',
    file: 'descriptor-fragments.yaml',
    error: true,
    seed(packs) {
      (packs.lib['descriptor-fragments.yaml'] as Array<Record<string, unknown>>)[0].text =
        'a letter from Konrad Adenauer himself';
    },
  },
  // CE-SENSITIVE — a Sensitivity Term match in a text field.
  {
    label: 'sensitivity term match',
    rule: 'CE-SENSITIVE',
    pack: 'lib',
    file: 'descriptor-fragments.yaml',
    error: true,
    seed(packs) {
      (packs.lib['descriptor-fragments.yaml'] as Array<Record<string, unknown>>)[0].text =
        'he used a slur in the cable';
    },
  },
  // CE-QUANTITY — a Quantity Target shortfall; an error under `release`.
  {
    label: 'quantity shortfall',
    rule: 'CE-QUANTITY',
    pack: 'city-vienna',
    file: 'pack.yaml',
    error: true,
    profile: 'release',
    seed() {
      // The base City Pack already ships far fewer than the Req-11 target
      // counts (1 location vs 25, etc.), so no mutation is needed: the clean
      // set is a known shortfall, which is a warning in draft and an error in
      // release. Seeding is a no-op here.
    },
  },
  // CE-VARIANT — a Template Variant whose slot set differs from its base.
  {
    label: 'template-variant slot mismatch',
    rule: 'CE-VARIANT',
    pack: 'city-vienna',
    file: 'cross-reference',
    error: true,
    expectPath: 'city-vienna/vienna-cafe-variant.template',
    seed(packs) {
      (packs['city-vienna']['template-variants.yaml'] as Array<Record<string, unknown>>)[0].template =
        '{headline}\nTreffen im {place} mit {who}.';
    },
  },
  // CE-ALLOWLIST — a Locale allowlist entry equal to a distinctive entity alias.
  {
    label: 'allowlist collision',
    rule: 'CE-ALLOWLIST',
    pack: 'city-vienna',
    file: 'locale.yaml',
    error: true,
    seed(packs) {
      (packs['city-vienna']['districts.yaml'] as Array<Record<string, unknown>>)[0].aliases = [
        { text: 'The Ring', distinctive: true },
      ];
      (packs['city-vienna']['locale.yaml'] as Array<Record<string, unknown>>)[0].allowNames = [
        'Vienna',
        'The Ring',
      ];
    },
  },
  // CE-SOURCE — a real-landmark Location without a source.
  {
    label: 'missing source',
    rule: 'CE-SOURCE',
    pack: 'city-vienna',
    file: 'locations.yaml',
    error: true,
    seed(packs) {
      delete (packs['city-vienna']['locations.yaml'] as Array<Record<string, unknown>>)[0].sources;
    },
  },
  // CE-PROVENANCE — generated content missing its reviewer / review time.
  {
    label: 'missing provenance',
    rule: 'CE-PROVENANCE',
    pack: 'lib',
    file: 'descriptor-fragments.yaml',
    error: true,
    seed(packs) {
      const frags = packs.lib['descriptor-fragments.yaml'] as unknown[];
      packs.lib['descriptor-fragments.yaml'] = {
        provenance: { generated: true },
        items: frags,
      };
    },
  },
  // CE-STYLE — a mechanical Style Guide rule broken (an exclamation in a headline).
  {
    label: 'style violation',
    rule: 'CE-STYLE',
    pack: 'core',
    file: 'documents.yaml',
    error: false,
    seed(packs) {
      // A second newspaper document whose title breaks the no-exclamation
      // Style Guide rule. Kept off the variant base `cafe-article`, with a
      // distinct body, so the only defect seeded is the style one.
      (packs.core['documents.yaml'] as Array<Record<string, unknown>>).push({
        id: 'shock-article',
        kind: 'newspaper',
        titlePattern: 'A sudden shock today!',
        sections: [{ id: 'lede', body: 'A dispatch from {place} {when}.' }],
      });
    },
  },
  // Extension-registered kind (Req 17.2, 13.8): an anachronism in a kind
  // registered only through LoadOptions.kinds.
  {
    label: 'extension-kind defect',
    rule: 'CE-ANACH',
    pack: 'era',
    file: 'briefings.yaml',
    error: true,
    kinds: EXTENSION_KINDS,
    seed(packs) {
      packs.era['briefings.yaml'] = [{ id: 'brief-1', text: 'crossing at the Wall today' }];
    },
  },
];

/** Lint the seeded copy of the base set for one Defect Class. */
function lintSeeded(def: DefectClass): ReturnType<typeof lint> {
  const packs = clonePacks(basePacks());
  def.seed(packs);
  const dirOf = writePacks(packs);
  const opts: LintOptions = {};
  if (def.profile !== undefined) {
    (opts as { profile?: string }).profile = def.profile;
  }
  if (def.kinds !== undefined) {
    (opts as { kinds?: readonly ContentKindRegistration[] }).kinds = def.kinds;
  }
  return lint(
    BASE_IDS.map((id) => dirOf[id]),
    [...BASE_IDS],
    opts,
  );
}

// --- the property ----------------------------------------------------------

describe('Feature: content-expansion, Property 4: Linter detects every seeded defect', () => {
  it('reports no error finding and exits 0 on the clean conforming set', () => {
    const dirOf = writePacks(basePacks());
    const report = lint(
      BASE_IDS.map((id) => dirOf[id]),
      [...BASE_IDS],
    );
    const errors = report.findings.filter((f) => f.severity === 'error');
    expect(errors).toEqual([]);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('reports a finding of every seeded Defect Class at its seeded location', () => {
    fc.assert(
      fc.property(
        fc.subarray([...DEFECT_CLASSES.keys()], { minLength: 1 }),
        (indices) => {
          for (const i of indices) {
            const def = DEFECT_CLASSES[i];
            const report = lintSeeded(def);

            // At least one finding of the seeded class, located at the seeded
            // pack and file (and path, where the case pins it).
            const matches = report.findings.filter(
              (f) =>
                f.rule === def.rule &&
                f.pack === def.pack &&
                f.file === def.file &&
                (def.expectPath === undefined || f.path === def.expectPath),
            );
            expect(
              matches.length,
              `${def.label}: expected a ${def.rule} finding at ${def.pack}/${def.file}` +
                `${def.expectPath === undefined ? '' : ':' + def.expectPath}, got ` +
                JSON.stringify(report.findings),
            ).toBeGreaterThan(0);

            // An error-severity Defect Class drives a non-zero exit code.
            if (def.error) {
              expect(exitCodeFor(report)).toBe(1);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it('produces identical output across directory permutations and repeated runs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DEFECT_CLASSES.keys()),
        fc.shuffledSubarray([...BASE_IDS], { minLength: BASE_IDS.length, maxLength: BASE_IDS.length }),
        (i, dirOrder) => {
          const def = DEFECT_CLASSES[i];
          const packs = clonePacks(basePacks());
          def.seed(packs);
          const dirOf = writePacks(packs);
          const opts: LintOptions = {};
          if (def.profile !== undefined) (opts as { profile?: string }).profile = def.profile;
          if (def.kinds !== undefined) {
            (opts as { kinds?: readonly ContentKindRegistration[] }).kinds = def.kinds;
          }

          const baseline = lint(
            BASE_IDS.map((id) => dirOf[id]),
            [...BASE_IDS],
            opts,
          );
          const permuted = lint(
            dirOrder.map((id) => dirOf[id]),
            [...dirOrder],
            opts,
          );
          const again = lint(
            BASE_IDS.map((id) => dirOf[id]),
            [...BASE_IDS],
            opts,
          );
          expect(formatJson(permuted)).toBe(formatJson(baseline));
          expect(formatJson(again)).toBe(formatJson(baseline));
        },
      ),
      { numRuns: 60 },
    );
  }, 60_000);

  it('names a known rule for every Defect Class (the table stays in sync)', () => {
    for (const def of DEFECT_CLASSES) {
      expect(RULES_BY_ID.has(def.rule), `${def.label} → ${def.rule}`).toBe(true);
    }
  });
});
