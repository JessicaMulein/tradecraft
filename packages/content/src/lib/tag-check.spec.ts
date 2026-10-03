/**
 * The Tag check and Tag Conformance loader stages (content-expansion task 2.3).
 *
 * These tests pin the two loader stages the design's pipeline adds (steps 7 and
 * 9): the Tag check that validates every `tags`/`tagQueries` field against the
 * loaded Tag Vocabulary and facet applicability and requires a Tag on the kinds
 * of Req 4.3 (Req 4.3, 4.4, 4.8); and Tag Conformance, which refuses a City
 * Pack whose Required Queries lack their minimum static Binders (Req 4.5), with
 * extension-pack Required Queries checked against every City Pack (Req 4.7).
 *
 * The unit-level path extraction, facet indexing and binder counting are
 * exercised through `loadContent` so the stages are tested as the loader wires
 * them, with a couple of direct tests of the pure helpers.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent, type ContentError } from '../index.js';
import { resolveFieldPath, buildTagVocabulary } from './tag-check.js';

// --- fixture helpers -------------------------------------------------------

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

/** Write a set of named packs to a fresh temp dir; return each pack's dir. */
function writePacks(packs: Record<string, PackFiles>): string[] {
  const root = mkdtempSync(join(tmpdir(), 'tc-tagcheck-'));
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

function expectErrors(result: ReturnType<typeof loadContent>): readonly ContentError[] {
  if (result.ok) {
    throw new Error('expected load to fail');
  }
  return result.errors;
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
    { culture: 'austrian', gender: 'female', given: ['Maria'], family: ['Gruber'] },
  ],
  backgrounds: ['A lifelong Viennese.'],
};

const descriptorsCore = {
  version: 1,
  shared: { build: ['lean'], grooming: ['clean-shaven'] },
  pools: {
    'street-clothes': {
      garments: [{ text: 'a raincoat', fits: 'any' }],
      accessories: ['a felt hat'],
    },
  },
};

/** A Location Type carrying one `function:meeting-spot` Tag. */
function locationType(id: string, tags: string[]): PackFiles[string] {
  return {
    id,
    public: true,
    allowedActions: ['talk'],
    baseRisk: 0.1,
    allowsDeadDrops: false,
    namePatterns: [`Café {pick:names}`],
    descriptionPool: ['A warm coffee house.'],
    atmosphereTags: ['smoky'],
    tags,
  };
}

/** A civilian archetype with its Tags and an optional schedule. */
function archetype(
  id: string,
  tags: string[],
  schedule: { weekday: string; phase: string; at: string[] }[] = [],
): PackFiles[string] {
  return {
    id,
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
    schedule,
    tags,
  };
}

/**
 * A Tag Vocabulary with the facets and Tags these tests use, plus a list of
 * Required Queries the caller supplies.
 */
function vocabulary(requiredQueries: unknown[]): PackFiles[string] {
  return {
    facets: [
      { id: 'function', appliesTo: ['location', 'location-type'] },
      { id: 'access', appliesTo: ['location', 'location-type'] },
      { id: 'role', appliesTo: ['archetype'] },
      { id: 'climate', appliesTo: ['city', 'descriptor-fragment'] },
    ],
    tags: [
      { id: 'function:meeting-spot', description: 'A place to meet.' },
      { id: 'function:dead-drop-site', description: 'A concealment spot.' },
      { id: 'access:public', description: 'Open to the public.' },
      { id: 'role:civilian', description: 'An ordinary civilian.' },
      { id: 'climate:temperate', description: 'A temperate city.' },
    ],
    requiredQueries,
  };
}

/**
 * A core pack carrying a Tag Vocabulary, one tagged archetype and one tagged
 * Location Type. `overrides` replaces or adds files.
 */
function corePack(requiredQueries: unknown[], overrides: PackFiles = {}): PackFiles {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2, role: 'core' },
    'predicates.yaml': [predicateMeetsAt],
    'personas.yaml': [personaAustrian],
    'descriptors.yaml': descriptorsCore,
    'tags.yaml': vocabulary(requiredQueries),
    'archetypes.yaml': [archetype('local-civilian', ['role:civilian'])],
    'location-types.yaml': [
      locationType('cafe', ['function:meeting-spot', 'access:public']),
    ],
    ...overrides,
  };
}

/** The Vienna City Pack body: a city.yaml plus `count` tagged meeting-spot locations. */
function cityPack(args: {
  readonly meetingSpots: number;
  readonly deadDrops?: number;
  readonly extraLocations?: unknown[];
}): PackFiles {
  const locations: unknown[] = [];
  for (let i = 0; i < args.meetingSpots; i += 1) {
    locations.push({
      id: `cafe-${i}`,
      name: `Café ${i}`,
      type: 'core/cafe', // Effective Tags come from the Location Type
      district: 'innere-stadt',
      public: true,
      description: 'A coffee house.',
      city: 'vienna',
      tags: ['function:meeting-spot'],
      basis: 'fictional',
    });
  }
  for (let i = 0; i < (args.deadDrops ?? 0); i += 1) {
    locations.push({
      id: `drop-${i}`,
      name: `Drop ${i}`,
      type: 'core/cafe',
      district: 'innere-stadt',
      public: false,
      description: 'A quiet corner.',
      city: 'vienna',
      tags: ['function:dead-drop-site'],
      basis: 'fictional',
    });
  }
  if (args.extraLocations !== undefined) {
    locations.push(...args.extraLocations);
  }
  return {
    'pack.yaml': {
      id: 'city-vienna',
      version: '1.0.0',
      contentSchema: 2,
      role: 'city',
      requires: [{ id: 'core', range: '^1.0.0' }],
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
        format: '{symbol}{major}',
        rounding: 1,
        budgetScale: 1,
      },
      languages: [{ id: 'de', name: 'German', share: 1 }],
      cultureWeights: [{ group: 'austrian', weight: 1 }],
      services: ['own-service'],
    },
    'services.yaml': [
      {
        id: 'own-service',
        name: 'The Firm',
        aliases: [],
        kind: 'own',
        country: 'Austria',
        doctrineBase: {},
      },
    ],
    'locations.yaml': locations,
  };
}

// --- Tag check (step 7) ----------------------------------------------------

describe('Tag check — vocabulary and facet applicability (Req 4.4, 4.8)', () => {
  it('loads a pack whose Tags are all in the vocabulary and applicable', () => {
    const result = loadContent(
      writePacks({ core: corePack([]) }),
      ['core'],
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a Tag that is not in the Tag Vocabulary', () => {
    const result = loadContent(
      writePacks({
        core: corePack([], {
          'location-types.yaml': [locationType('cafe', ['function:no-such-tag'])],
        }),
      }),
      ['core'],
    );
    const err = expectErrors(result).find((e) => e.file === 'location-types.yaml');
    expect(err?.message).toContain('not in the Tag Vocabulary');
    expect(err?.path).toContain('tags');
  });

  it('refuses a Tag whose facet does not apply to the kind it is used on', () => {
    // `role:civilian` is a `role`-facet Tag that applies only to archetypes.
    const result = loadContent(
      writePacks({
        core: corePack([], {
          'location-types.yaml': [locationType('cafe', ['role:civilian'])],
        }),
      }),
      ['core'],
    );
    const err = expectErrors(result).find((e) => e.file === 'location-types.yaml');
    expect(err?.message).toContain('does not apply to kind "location-type"');
  });

  it('refuses an unknown Tag named inside a Tag Query field (Req 4.8)', () => {
    // A Required Query's `query` is itself a Tag Query field on the
    // tag-vocabulary kind, so it is validated against the vocabulary.
    const result = loadContent(
      writePacks({
        core: corePack([
          { id: 'rq-x', query: ['function:ghost'], minStatic: 0, minInstantiated: 0 },
        ]),
      }),
      ['core'],
    );
    const err = expectErrors(result).find((e) => e.file === 'tags.yaml');
    expect(err?.message).toContain('not in the Tag Vocabulary');
  });
});

describe('Tag check — every item carries a Tag (Req 4.3)', () => {
  it('refuses an archetype that carries no Tag', () => {
    const result = loadContent(
      writePacks({
        core: corePack([], { 'archetypes.yaml': [archetype('untagged', [])] }),
      }),
      ['core'],
    );
    const err = expectErrors(result).find((e) => e.file === 'archetypes.yaml');
    expect(err?.message).toContain('must carry at least one tag');
  });

  it('refuses a Location Type that carries no Tag', () => {
    const result = loadContent(
      writePacks({
        core: corePack([], { 'location-types.yaml': [locationType('cafe', [])] }),
      }),
      ['core'],
    );
    const err = expectErrors(result).find((e) => e.file === 'location-types.yaml');
    expect(err?.message).toContain('must carry at least one tag');
  });

  it('does not run the Tag check when no vocabulary is loaded (slice packs)', () => {
    // A schema-1 slice pack with no `tags.yaml` loads unchanged (Req 1.2).
    const result = loadContent(
      writePacks({
        core: {
          'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
          'predicates.yaml': [predicateMeetsAt],
          'personas.yaml': [personaAustrian],
          'descriptors.yaml': descriptorsCore,
          'archetypes.yaml': [archetype('untagged', [])],
          'location-types.yaml': [locationType('cafe', [])],
        },
      }),
      ['core'],
    );
    expect(result.ok).toBe(true);
  });
});

// --- Tag Conformance (step 9) ----------------------------------------------

describe('Tag Conformance — static Binders per City Pack (Req 4.5)', () => {
  it('loads a City Pack that meets every Required Query minimum', () => {
    const result = loadContent(
      writePacks({
        core: corePack([
          {
            id: 'rq-public-meet',
            query: ['function:meeting-spot'],
            minStatic: 3,
            minInstantiated: 1,
          },
        ]),
        'city-vienna': cityPack({ meetingSpots: 3 }),
      }),
      ['city-vienna'],
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a City Pack short of a Required Query minimum, reporting the shortfall', () => {
    const result = loadContent(
      writePacks({
        core: corePack([
          {
            id: 'rq-public-meet',
            query: ['function:meeting-spot'],
            minStatic: 5,
            minInstantiated: 1,
          },
        ]),
        'city-vienna': cityPack({ meetingSpots: 2 }),
      }),
      ['city-vienna'],
    );
    const err = expectErrors(result).find((e) => e.file === 'tag-conformance');
    expect(err?.pack).toBe('city-vienna');
    expect(err?.path).toBe('requiredQueries[rq-public-meet]');
    expect(err?.message).toBe('city vienna: 2 binders, minimum 5');
  });

  it('counts a Location Type Tag toward a Location Effective Tags', () => {
    // The `function:meeting-spot` on the `core/cafe` Location Type binds the
    // query even for a Location whose own Tags omit it.
    const bareLocation = {
      id: 'bare-cafe',
      name: 'Bare Café',
      type: 'core/cafe',
      district: 'innere-stadt',
      public: true,
      description: 'A coffee house.',
      city: 'vienna',
      tags: ['access:public'],
      basis: 'fictional',
    };
    const result = loadContent(
      writePacks({
        core: corePack([
          {
            id: 'rq-public-meet',
            query: ['function:meeting-spot'],
            minStatic: 1,
            minInstantiated: 1,
          },
        ]),
        'city-vienna': cityPack({ meetingSpots: 0, extraLocations: [bareLocation] }),
      }),
      ['city-vienna'],
    );
    expect(result.ok).toBe(true);
  });

  it('counts a matching archetype toward an archetype Required Query', () => {
    // `rq-civilian` is satisfied by the core pack's `role:civilian` archetype,
    // which has no schedule and so binds in every city.
    const result = loadContent(
      writePacks({
        core: corePack([
          { id: 'rq-civilian', query: ['role:civilian'], minStatic: 1, minInstantiated: 0 },
        ]),
        'city-vienna': cityPack({ meetingSpots: 1 }),
      }),
      ['city-vienna'],
    );
    expect(result.ok).toBe(true);
  });

  it('excludes an archetype whose schedule query binds nowhere in the city', () => {
    // The archetype needs a `function:dead-drop-site` Binder to count, but the
    // city has none, so it is excluded and the role query falls short.
    const scheduled = archetype('courier', ['role:civilian'], [
      { weekday: 'monday', phase: 'morning', at: ['function:dead-drop-site'] },
    ]);
    const result = loadContent(
      writePacks({
        core: corePack(
          [{ id: 'rq-civilian', query: ['role:civilian'], minStatic: 1, minInstantiated: 0 }],
          { 'archetypes.yaml': [scheduled] },
        ),
        'city-vienna': cityPack({ meetingSpots: 1, deadDrops: 0 }),
      }),
      ['city-vienna'],
    );
    const err = expectErrors(result).find((e) => e.file === 'tag-conformance');
    expect(err?.path).toBe('requiredQueries[rq-civilian]');
  });

  it('counts a scheduled archetype once its schedule query binds in the city', () => {
    const scheduled = archetype('courier', ['role:civilian'], [
      { weekday: 'monday', phase: 'morning', at: ['function:dead-drop-site'] },
    ]);
    const result = loadContent(
      writePacks({
        core: corePack(
          [{ id: 'rq-civilian', query: ['role:civilian'], minStatic: 1, minInstantiated: 0 }],
          { 'archetypes.yaml': [scheduled] },
        ),
        'city-vienna': cityPack({ meetingSpots: 1, deadDrops: 1 }),
      }),
      ['city-vienna'],
    );
    expect(result.ok).toBe(true);
  });

  it('excludes a Location outside the city Period Window from static Binders', () => {
    const outOfPeriod = {
      id: 'future-cafe',
      name: 'Future Café',
      type: 'core/cafe',
      district: 'innere-stadt',
      public: true,
      description: 'A coffee house.',
      city: 'vienna',
      tags: ['function:meeting-spot'],
      basis: 'fictional',
      years: { from: 1970, to: 1980 }, // outside the city period 1945–1955
    };
    const result = loadContent(
      writePacks({
        core: corePack([
          {
            id: 'rq-public-meet',
            query: ['function:meeting-spot'],
            minStatic: 2,
            minInstantiated: 1,
          },
        ]),
        'city-vienna': cityPack({ meetingSpots: 1, extraLocations: [outOfPeriod] }),
      }),
      ['city-vienna'],
    );
    const err = expectErrors(result).find((e) => e.file === 'tag-conformance');
    expect(err?.message).toBe('city vienna: 1 binders, minimum 2');
  });
});

describe('Tag Conformance — extension-pack Required Queries (Req 4.7)', () => {
  it('checks a Required Query added by an extension pack against every City Pack', () => {
    const extension: PackFiles = {
      'pack.yaml': {
        id: 'ext-plots',
        version: '1.0.0',
        contentSchema: 2,
        role: 'extension',
        requires: [{ id: 'core', range: '^1.0.0' }],
      },
      // The extension adds a Required Query the city cannot satisfy.
      'tags.yaml': {
        facets: [{ id: 'function', appliesTo: ['location', 'location-type'] }],
        tags: [{ id: 'function:dead-drop-site', description: 'A concealment spot.' }],
        requiredQueries: [
          {
            id: 'rq-ext-drop',
            query: ['function:dead-drop-site'],
            minStatic: 4,
            minInstantiated: 1,
          },
        ],
      },
    };
    const result = loadContent(
      writePacks({
        core: corePack([]),
        'ext-plots': extension,
        'city-vienna': cityPack({ meetingSpots: 1, deadDrops: 1 }),
      }),
      ['city-vienna', 'ext-plots'],
    );
    const err = expectErrors(result).find(
      (e) => e.file === 'tag-conformance' && e.path === 'requiredQueries[rq-ext-drop]',
    );
    expect(err?.pack).toBe('city-vienna');
    expect(err?.message).toBe('city vienna: 1 binders, minimum 4');
  });
});

// --- pure helpers ----------------------------------------------------------

describe('resolveFieldPath', () => {
  it('reads a scalar field', () => {
    expect(resolveFieldPath({ climate: 'climate:temperate' }, 'climate')).toEqual([
      'climate:temperate',
    ]);
  });

  it('iterates a list field with []', () => {
    expect(resolveFieldPath({ tags: ['a', 'b'] }, 'tags[]')).toEqual(['a', 'b']);
  });

  it('descends through a list of records to an inner field', () => {
    const item = { schedule: [{ at: ['x'] }, { at: ['y', 'z'] }] };
    expect(resolveFieldPath(item, 'schedule[].at')).toEqual([
      ['x'],
      ['y', 'z'],
    ]);
  });

  it('yields nothing for a missing field', () => {
    expect(resolveFieldPath({}, 'tags[]')).toEqual([]);
    expect(resolveFieldPath({ tags: 'not-a-list' }, 'tags[]')).toEqual([]);
  });
});

describe('buildTagVocabulary', () => {
  it('merges facets, Tags and Required Queries across packs and inherits facet appliesTo', () => {
    const index = buildTagVocabulary([
      {
        id: 'core',
        files: [
          {
            relPath: 'tags.yaml',
            content: vocabulary([
              { id: 'rq-a', query: ['role:civilian'], minStatic: 1, minInstantiated: 0 },
            ]),
          },
        ],
      },
    ]);
    expect(index.present).toBe(true);
    // `role:civilian` inherits the `role` facet's appliesTo (archetype only).
    expect([...(index.appliesTo.get('role:civilian') ?? [])]).toEqual(['archetype']);
    expect(index.requiredQueries.map((q) => q.id)).toEqual(['rq-a']);
  });

  it('reports no vocabulary when no tags.yaml is present', () => {
    const index = buildTagVocabulary([{ id: 'core', files: [] }]);
    expect(index.present).toBe(false);
    expect(index.requiredQueries).toEqual([]);
  });
});
