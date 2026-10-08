import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import {
  loadContent,
  resolveTemplate,
  type ContentError,
  type ContentSet,
} from '../index.js';

// --- fixture helpers -------------------------------------------------------

/** A pack described as a map of relative file path -> YAML-serialisable value. */
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
function writePacks(packs: Record<string, PackFiles>): {
  root: string;
  dirs: string[];
  dirOf: (packDir: string) => string;
} {
  const root = mkdtempSync(join(tmpdir(), 'tc-packs-'));
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
  return { root, dirs, dirOf: (packDir) => join(root, packDir) };
}

// --- reusable valid content ------------------------------------------------

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

const archetypeWaiter = {
  id: 'waiter',
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
};

const personaAustrian = {
  id: 'austrian',
  namePools: [
    { culture: 'austrian', gender: 'male', given: ['Franz'], family: ['Huber'] },
    { culture: 'austrian', gender: 'female', given: ['Maria'], family: ['Gruber'] },
  ],
  backgrounds: ['A lifelong Viennese.'],
};

/** A minimal Descriptor library defining the one pool the archetype names. */
const descriptorsCore = {
  version: 1,
  shared: {
    build: ['lean and stooped'],
    grooming: ['clean-shaven', { text: 'a pencil moustache', fits: 'male' }],
  },
  pools: {
    'street-clothes': {
      garments: [
        { text: 'a belted gabardine raincoat', fits: 'any' },
        { text: 'a plain dirndl-blouse and dark skirt', fits: 'female' },
      ],
      accessories: ['a soft grey felt hat'],
    },
  },
};

const locationKaffeehaus = {
  id: 'kaffeehaus',
  public: true,
  allowedActions: ['talk', 'surveil'],
  baseRisk: 0.1,
  allowsDeadDrops: false,
  namePatterns: ['Café {pick:names}'],
  descriptionPool: ['A warm coffee house.'],
  atmosphereTags: ['smoky'],
};

/** A minimal, internally consistent pack that loads cleanly on its own. */
function corePack(overrides: Partial<PackFiles> = {}): PackFiles {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
    'predicates.yaml': [predicateMeetsAt],
    'archetypes.yaml': [archetypeWaiter],
    'personas.yaml': [personaAustrian],
    'descriptors.yaml': descriptorsCore,
    'location-types.yaml': [locationKaffeehaus],
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof loadContent>): ContentSet {
  if (!result.ok) {
    throw new Error(
      `expected load to succeed, got errors:\n${JSON.stringify(result.errors, null, 2)}`,
    );
  }
  return result.value;
}

function expectErrors(result: ReturnType<typeof loadContent>): readonly ContentError[] {
  if (result.ok) {
    throw new Error('expected load to fail');
  }
  return result.errors;
}

// --- tests -----------------------------------------------------------------

describe('loadContent — happy path', () => {
  it('loads a single valid pack and namespaces ids', () => {
    const { dirs } = writePacks({ core: corePack() });
    const set = expectOk(loadContent(dirs, ['core']));

    expect(set.archetypes.has('core/waiter')).toBe(true);
    expect(set.personaLibraries.has('core/austrian')).toBe(true);
    expect(set.locationTypes.has('core/kaffeehaus')).toBe(true);
    expect(set.predicates.has('MEETS_AT')).toBe(true);
  });

  it('builds a manifest pinning schema, id, version and a hex hash', () => {
    const { dirs } = writePacks({ core: corePack() });
    const set = expectOk(loadContent(dirs, ['core']));

    expect(set.manifest.schema).toBe(1);
    expect(set.manifest.packs).toHaveLength(1);
    const entry = set.manifest.packs[0];
    expect(entry.id).toBe('core');
    expect(entry.version).toBe('1.0.0');
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts content laid out as directories of files', () => {
    const { dirs } = writePacks({
      core: {
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
        'predicates.yaml': [predicateMeetsAt],
        'archetypes/waiter.yaml': archetypeWaiter,
        'personas/austrian.yaml': personaAustrian,
        'descriptors.yaml': descriptorsCore,
        'location-types/kaffeehaus.yaml': locationKaffeehaus,
      },
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.archetypes.has('core/waiter')).toBe(true);
  });

  it('ignores authored kinds that land in later tasks', () => {
    const { dirs } = writePacks({
      core: corePack({
        'city.yaml': { districts: [] },
      }),
    });
    expectOk(loadContent(dirs, ['core']));
  });

  it('loads glossary.yaml into the Content Set, keyed by term (Req 26.5)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'glossary.yaml': [
          { term: 'Asset', definition: 'A recruited source who reports to you.' },
          { term: 'Budget', definition: 'Your operating funds.' },
        ],
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.glossary.get('Asset')?.definition).toContain('recruited source');
    expect([...set.glossary.keys()].sort()).toEqual(['Asset', 'Budget']);
  });

  it('reports a glossary entry that does not match its schema', () => {
    const result = loadContent(
      writePacks({ core: corePack({ 'glossary.yaml': [{ term: 'X' }] }) }).dirs,
      ['core'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.file === 'glossary.yaml')).toBe(true);
    }
  });

  it('accepts a content file in the { provenance, items } envelope (Req 16.2)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2, role: 'core' },
        'archetypes.yaml': {
          provenance: {
            generated: true,
            model: 'local/mixtral',
            promptHash: 'abc',
            generatedAt: '2024-01-01T00:00:00Z',
            reviewedBy: 'ada',
            reviewedAt: '2024-01-02T00:00:00Z',
          },
          items: [archetypeWaiter],
        },
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.archetypes.has('core/waiter')).toBe(true);
  });

  it('loads the same content whether a file is a bare list or an envelope', () => {
    const bare = expectOk(
      loadContent(writePacks({ core: corePack() }).dirs, ['core']),
    );
    const wrapped = expectOk(
      loadContent(
        writePacks({
          core: corePack({ 'archetypes.yaml': { items: [archetypeWaiter] } }),
        }).dirs,
        ['core'],
      ),
    );
    expect([...wrapped.archetypes.keys()].sort()).toEqual(
      [...bare.archetypes.keys()].sort(),
    );
  });

  it('locates a schema error inside an envelope at items[i]', () => {
    const result = loadContent(
      writePacks({
        core: corePack({
          'archetypes.yaml': { items: [{ ...archetypeWaiter, role: 42 }] },
        }),
      }).dirs,
      ['core'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.file === 'archetypes.yaml' && e.path.startsWith('items[0]'),
        ),
      ).toBe(true);
    }
  });

  it('reports a malformed envelope whose items is not a list', () => {
    const result = loadContent(
      writePacks({
        core: corePack({ 'archetypes.yaml': { items: archetypeWaiter } }),
      }).dirs,
      ['core'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.file === 'archetypes.yaml')).toBe(true);
    }
  });
});

describe('loadContent — dependency resolution and ordering', () => {
  function base(): Record<string, PackFiles> {
    return {
      core: corePack(),
      ext: {
        'pack.yaml': {
          id: 'ext',
          version: '1.0.0',
          contentSchema: 1,
          requires: [{ id: 'core', range: '^1.0.0' }],
        },
        // References core's persona and descriptor pools by namespaced id.
        'archetypes.yaml': [
          {
            ...archetypeWaiter,
            id: 'tram-conductor',
            personaPools: ['core/austrian'],
            descriptorPools: ['core/street-clothes'],
          },
        ],
      },
    };
  }

  it('pulls in a transitive dependency even if not selected', () => {
    const { dirs } = writePacks(base());
    const set = expectOk(loadContent(dirs, ['ext']));
    expect(set.archetypes.has('core/waiter')).toBe(true);
    expect(set.archetypes.has('ext/tram-conductor')).toBe(true);
    // Dependency precedes the dependant in the manifest.
    expect(set.manifest.packs.map((p) => p.id)).toEqual(['core', 'ext']);
  });

  it('produces the same ContentSet regardless of selection order', () => {
    const { dirs } = writePacks(base());
    const a = expectOk(loadContent(dirs, ['core', 'ext']));
    const b = expectOk(loadContent([...dirs].reverse(), ['ext', 'core']));
    expect(a.manifest).toEqual(b.manifest);
    expect([...a.archetypes.keys()].sort()).toEqual(
      [...b.archetypes.keys()].sort(),
    );
  });

  it('reports a missing dependency', () => {
    const packs = base();
    delete (packs as Record<string, unknown>).core;
    const { dirs } = writePacks(packs);
    const errors = expectErrors(loadContent(dirs, ['ext']));
    expect(errors.some((e) => /requires missing pack "core"/.test(e.message))).toBe(
      true,
    );
  });

  it('reports an incompatible dependency version', () => {
    const packs = base();
    (packs.ext['pack.yaml'] as Record<string, unknown>).requires = [
      { id: 'core', range: '^2.0.0' },
    ];
    const { dirs } = writePacks(packs);
    const errors = expectErrors(loadContent(dirs, ['ext']));
    expect(
      errors.some((e) => /does not satisfy "\^2\.0\.0"/.test(e.message)),
    ).toBe(true);
  });

  it('reports a dependency cycle', () => {
    const { dirs } = writePacks({
      a: {
        'pack.yaml': {
          id: 'a',
          version: '1.0.0',
          contentSchema: 1,
          requires: [{ id: 'b', range: '^1.0.0' }],
        },
        'predicates.yaml': [predicateMeetsAt],
      },
      b: {
        'pack.yaml': {
          id: 'b',
          version: '1.0.0',
          contentSchema: 1,
          requires: [{ id: 'a', range: '^1.0.0' }],
        },
      },
    });
    const errors = expectErrors(loadContent(dirs, ['a', 'b']));
    expect(errors.some((e) => /dependency cycle/.test(e.message))).toBe(true);
  });
});

describe('loadContent — merge and overrides', () => {
  it('coexists ids from different packs under their own namespaces', () => {
    // `waiter` under both packs is two distinct namespaced ids, never a clash.
    const { dirs } = writePacks({
      core: corePack(),
      ext: {
        'pack.yaml': {
          id: 'ext',
          version: '1.0.0',
          contentSchema: 1,
          requires: [{ id: 'core', range: '^1.0.0' }],
        },
        'personas.yaml': [personaAustrian],
        'descriptors.yaml': descriptorsCore,
        'archetypes.yaml': [archetypeWaiter],
      },
    });
    const set = expectOk(loadContent(dirs, ['ext']));
    expect(set.archetypes.has('core/waiter')).toBe(true);
    expect(set.archetypes.has('ext/waiter')).toBe(true);
  });

  it('rejects a duplicate id within a pack without an override', () => {
    const { dirs } = writePacks({
      core: corePack({ 'archetypes.yaml': [archetypeWaiter, archetypeWaiter] }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some((e) => /duplicate id "core\/waiter"/.test(e.message)),
    ).toBe(true);
  });

  it('allows a redefinition when the id is listed in overrides', () => {
    const { dirs } = writePacks({
      core: corePack({
        'pack.yaml': {
          id: 'core',
          version: '1.0.0',
          contentSchema: 1,
          overrides: ['waiter'],
        },
        // Two definitions of `waiter`; the second wins because it is overridden.
        'archetypes.yaml': [
          archetypeWaiter,
          { ...archetypeWaiter, wariness: { min: 0.5, max: 0.9 } },
        ],
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.archetypes.get('core/waiter')?.wariness).toEqual({
      min: 0.5,
      max: 0.9,
    });
  });
});

describe('loadContent — validation and cross-references (Property 23 corruptions)', () => {
  it('reports a Zod validation failure with a located path', () => {
    const { dirs } = writePacks({
      core: corePack({
        'location-types.yaml': [{ ...locationKaffeehaus, baseRisk: 5 }],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    const hit = errors.find(
      (e) => e.file === 'location-types.yaml' && e.path.includes('baseRisk'),
    );
    expect(hit).toBeDefined();
    expect(hit?.pack).toBe('core');
  });

  it('reports a dangling persona-pool reference', () => {
    const { dirs } = writePacks({
      core: corePack({
        'archetypes.yaml': [{ ...archetypeWaiter, personaPools: ['nope'] }],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) => e.path === 'core/waiter.personaPools[0]' && /persona pool/.test(e.message),
      ),
    ).toBe(true);
  });

  it('reports a dangling descriptor-pool reference (Req 31.2)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'archetypes.yaml': [{ ...archetypeWaiter, descriptorPools: ['nope'] }],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          e.path === 'core/waiter.descriptorPools[0]' &&
          /descriptor pool/.test(e.message),
      ),
    ).toBe(true);
  });

  it('reports a dangling archetype reference from a Plot template', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          {
            id: 'the-plot',
            roleSlots: [{ id: 'handler', archetypes: ['ghost'] }],
            stages: [
              {
                id: 's1',
                deadline: { min: 1, max: 2 },
                onDisrupted: { delay: 1, reroute: 0, abort: 0 },
              },
            ],
          },
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) => /archetype "ghost"/.test(e.message) && e.path.includes('roleSlots'),
      ),
    ).toBe(true);
  });

  // --- structured trace references (task 26.1, Requirement 31.2) -----------

  /** A Plot template whose single stage carries one structured trace. */
  function plotWithTrace(trace: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'the-plot',
      roleSlots: [{ id: 'handler', archetypes: ['waiter'] }],
      materielSlots: [{ id: 'pouch', description: 'A sealed pouch.' }],
      targetSlots: [{ id: 'office', description: 'The target office.' }],
      stages: [
        {
          id: 's1',
          deadline: { min: 1, max: 2 },
          traces: [trace],
          onDisrupted: { delay: 1, reroute: 0, abort: 0 },
        },
      ],
    };
  }

  it('accepts a trace whose role, place, materiel and evidence all resolve', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          plotWithTrace({
            kind: 'meeting',
            roles: ['handler'],
            place: { locationType: 'kaffeehaus' },
            materiel: 'pouch',
            evidences: ['MEETS_AT'],
            text: 'The handler meets a contact.',
          }),
        ],
      }),
    });
    expectOk(loadContent(dirs, ['core']));
  });

  it('reports a trace role that is not a declared role slot', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          plotWithTrace({ kind: 'meeting', roles: ['ghost'], text: 'x' }),
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /role slot "ghost"/.test(e.message) &&
          e.path === 'core/the-plot.stages[0].traces[0].roles[0]',
      ),
    ).toBe(true);
  });

  it('reports a trace place that names an unknown Location Type', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          plotWithTrace({
            kind: 'meeting',
            place: { locationType: 'moon-base' },
            text: 'x',
          }),
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /Location Type "moon-base"/.test(e.message) &&
          e.path === 'core/the-plot.stages[0].traces[0].place.locationType',
      ),
    ).toBe(true);
  });

  it('reports a trace place that names an unknown target slot', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          plotWithTrace({ kind: 'meeting', place: { target: 'nowhere' }, text: 'x' }),
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /target slot "nowhere"/.test(e.message) &&
          e.path === 'core/the-plot.stages[0].traces[0].place.target',
      ),
    ).toBe(true);
  });

  it('reports a trace materiel that is not a declared materiel slot', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          plotWithTrace({ kind: 'drop-loaded', materiel: 'phantom', text: 'x' }),
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /materiel slot "phantom"/.test(e.message) &&
          e.path === 'core/the-plot.stages[0].traces[0].materiel',
      ),
    ).toBe(true);
  });

  it('reports a trace evidence that is not a loaded predicate', () => {
    const { dirs } = writePacks({
      core: corePack({
        'plots.yaml': [
          plotWithTrace({ kind: 'meeting', evidences: ['NOT_A_PREDICATE'], text: 'x' }),
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /predicate "NOT_A_PREDICATE"/.test(e.message) &&
          e.path === 'core/the-plot.stages[0].traces[0].evidences[0]',
      ),
    ).toBe(true);
  });

  it('validates Side Thread traces the same way', () => {
    const { dirs } = writePacks({
      core: corePack({
        'side-threads.yaml': [
          {
            id: 'thread',
            roleSlots: [{ id: 'runner', archetypes: ['waiter'] }],
            stages: [
              {
                id: 's1',
                deadline: { min: 1, max: 2 },
                traces: [{ kind: 'meeting', roles: ['missing'], text: 'x' }],
                onDisrupted: { delay: 1, reroute: 0, abort: 0 },
              },
            ],
          },
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /role slot "missing"/.test(e.message) &&
          e.path === 'core/thread.stages[0].traces[0].roles[0]',
      ),
    ).toBe(true);
  });

  it('reports an undeclared template slot in a predicate renderer', () => {
    const bad = {
      ...predicateMeetsAt,
      render: { second: 'You meet {object}.', third: '{subject} meets {ghost}.' },
    };
    const { dirs } = writePacks({ core: corePack({ 'predicates.yaml': [bad] }) });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          e.file === 'predicates.yaml' && /undeclared slot "ghost"/.test(e.message),
      ),
    ).toBe(true);
  });

  it('reports a duplicate predicate field code', () => {
    const clash = { ...predicateMeetsAt, id: 'OTHER', fieldCode: 'MT' };
    const { dirs } = writePacks({
      core: corePack({ 'predicates.yaml': [predicateMeetsAt, clash] }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some((e) => /field code "MT" is already used/.test(e.message)),
    ).toBe(true);
  });

  it('reports an unknown evaluator kind', () => {
    const bad = { ...predicateMeetsAt, evaluator: 'telepathy' };
    const { dirs } = writePacks({ core: corePack({ 'predicates.yaml': [bad] }) });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(errors.some((e) => e.file === 'predicates.yaml')).toBe(true);
  });

  it('collects every error rather than stopping at the first', () => {
    const { dirs } = writePacks({
      core: corePack({
        'archetypes.yaml': [{ ...archetypeWaiter, personaPools: ['nope'] }],
        'location-types.yaml': [{ ...locationKaffeehaus, baseRisk: 9 }],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.file === 'location-types.yaml')).toBe(true);
    expect(errors.some((e) => e.file === 'cross-reference')).toBe(true);
  });
});

describe('loadContent — manifest and schema generation', () => {
  it('rejects a pack targeting an unknown content schema generation', () => {
    const { dirs } = writePacks({
      core: corePack({
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 99 },
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) => e.path === 'contentSchema' && /content schema 99/.test(e.message),
      ),
    ).toBe(true);
  });

  it('accepts a contentSchema-2 pack declaring a role (Requirements 1.1, 1.3)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2, role: 'core' },
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.archetypes.has('core/waiter')).toBe(true);
  });

  it('loads a contentSchema-1 pack with no role unchanged (Requirement 1.2)', () => {
    const { dirs } = writePacks({ core: corePack() });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.archetypes.has('core/waiter')).toBe(true);
  });

  it('reports a YAML syntax error against the file', () => {
    const { dirs } = writePacks({
      core: corePack({ 'predicates.yaml': ': : not yaml : :' }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(errors.some((e) => e.file === 'predicates.yaml')).toBe(true);
  });

  it('hash is stable across reloads of identical content', () => {
    const { dirs } = writePacks({ core: corePack() });
    const a = expectOk(loadContent(dirs, ['core']));
    const b = expectOk(loadContent(dirs, ['core']));
    expect(a.manifest.packs[0].hash).toBe(b.manifest.packs[0].hash);
  });
});

describe('loadContent — Service Definitions (task 1.8, Req 19.1, 19.2)', () => {
  /** A shared service as an Era Pack would ship it. */
  const ownService = {
    id: 'own-service',
    name: 'The Firm',
    kind: 'own',
    country: 'United Kingdom',
  };

  /** A full, well-formed City Definition referencing services by id. */
  function cityDef(services: string[]): Record<string, unknown> {
    return {
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
      cultureWeights: [{ group: 'core/austrian', weight: 3 }],
      services,
    };
  }

  it('merges services into the Content Set, namespaced by pack', () => {
    const { dirs } = writePacks({
      core: corePack({
        'services.yaml': [
          ownService,
          { id: 'stapo', name: 'State Police', kind: 'local-security', country: 'Austria' },
        ],
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.services.has('core/own-service')).toBe(true);
    expect(set.services.get('core/stapo')?.kind).toBe('local-security');
  });

  it('reports a service whose schema is violated, located at the item', () => {
    const { dirs } = writePacks({
      core: corePack({
        'services.yaml': [{ ...ownService, kind: 'friendly' }],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some((e) => e.file === 'services.yaml' && e.path.includes('kind')),
    ).toBe(true);
  });

  it('resolves every CityDefinition.services reference (Req 19.2)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'services.yaml': [ownService],
        'city.yaml': cityDef(['own-service']),
      }),
    });
    expectOk(loadContent(dirs, ['core']));
  });

  it('refuses a city services entry with no Service Definition (Req 19.2)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'services.yaml': [ownService],
        'city.yaml': cityDef(['own-service', 'phantom']),
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) =>
          /service "phantom"/.test(e.message) &&
          e.path === 'vienna.services[1]',
      ),
    ).toBe(true);
  });

  it('resolves a city reference to a service a dependency Era Pack ships', () => {
    const { dirs } = writePacks({
      era: {
        'pack.yaml': { id: 'era', version: '1.0.0', contentSchema: 1 },
        'services.yaml': [ownService],
      },
      city: {
        'pack.yaml': {
          id: 'city',
          version: '1.0.0',
          contentSchema: 1,
          requires: [{ id: 'era', range: '^1.0.0' }],
        },
        'city.yaml': cityDef(['era/own-service']),
      },
    });
    expectOk(loadContent(dirs, ['city']));
  });
});

describe('loadContent — Template Variants (task 2.2, Req 8.2, 8.3)', () => {
  /** A Document template whose rendered form binds {headline}, {place}, {when}. */
  const article = {
    id: 'cafe-article',
    kind: 'newspaper',
    titlePattern: '{headline}',
    sections: [{ id: 'lede', body: 'A meeting at {place} {when}.' }],
  };

  it('loads a conforming variant and exposes it through resolveTemplate', () => {
    const { dirs } = writePacks({
      core: corePack({
        'documents.yaml': [article],
        'template-variants.yaml': [
          {
            id: 'vienna-cafe',
            base: 'cafe-article',
            scope: { city: 'city-vienna' },
            template: '{headline}\nTreffen im {place} {when}.',
          },
        ],
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(set.templateVariantDefs.has('core/vienna-cafe')).toBe(true);

    const resolved = resolveTemplate(set, 'core/cafe-article', 'core/city-vienna');
    expect(resolved?.ast.source).toContain('Treffen im');

    // A different city falls back to the base document template.
    const other = resolveTemplate(set, 'core/cafe-article', 'core/city-berlin');
    expect(other?.ast.source).toContain('A meeting at');
  });

  it('refuses a variant whose slot set differs from its base (CE-VARIANT)', () => {
    const { dirs } = writePacks({
      core: corePack({
        'documents.yaml': [article],
        'template-variants.yaml': [
          {
            id: 'vienna-cafe',
            base: 'cafe-article',
            scope: { city: 'city-vienna' },
            // Drops {when} and adds {who}: one missing, one extra.
            template: '{headline}\nTreffen im {place} mit {who}.',
          },
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    const hit = errors.find((e) => e.path === 'core/vienna-cafe.template');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('missing [when]');
    expect(hit?.message).toContain('extra [who]');
  });

  it('refuses a variant naming a base that does not resolve', () => {
    const { dirs } = writePacks({
      core: corePack({
        'template-variants.yaml': [
          {
            id: 'ghost',
            base: 'no-such-doc',
            scope: { era: 'era-cw' },
            template: 'anything',
          },
        ],
      }),
    });
    const errors = expectErrors(loadContent(dirs, ['core']));
    expect(
      errors.some(
        (e) => e.path === 'core/ghost.base' && /no-such-doc/.test(e.message),
      ),
    ).toBe(true);
  });

  it('prefers the city variant over an era variant for its city', () => {
    const { dirs } = writePacks({
      core: corePack({
        'documents.yaml': [article],
        'template-variants.yaml': [
          {
            id: 'era-cafe',
            base: 'cafe-article',
            scope: { era: 'era-cw' },
            template: '{headline}\nEra {place} {when}.',
          },
          {
            id: 'vienna-cafe',
            base: 'cafe-article',
            scope: { city: 'city-vienna' },
            template: '{headline}\nStadt {place} {when}.',
          },
        ],
      }),
    });
    const set = expectOk(loadContent(dirs, ['core']));
    expect(
      resolveTemplate(set, 'core/cafe-article', 'core/city-vienna')?.ast.source,
    ).toContain('Stadt');
    // The core city has no city variant, so it gets the era variant.
    expect(
      resolveTemplate(set, 'core/cafe-article', 'core')?.ast.source,
    ).toContain('Era');
  });
});

describe('loadContent — template schema v2 (plot-library task 1.1)', () => {
  const v2Plot = { id: 'sample', templateSchema: 2, kind: 'plot' };

  it('rejects template schema 2 unless pack.yaml declares contentSchema 2', () => {
    const rejected = expectErrors(
      loadContent(writePacks({ core: corePack({ 'plots/sample.yaml': v2Plot }) }).dirs, ['core']),
    );
    expect(rejected.some((error) => error.path.endsWith('templateSchema'))).toBe(true);
    expect(rejected.some((error) => error.message.includes('contentSchema: 2'))).toBe(true);

    const allowed = expectErrors(
      loadContent(
        writePacks({
          lib: corePack({
            'pack.yaml': { id: 'lib', version: '1.0.0', contentSchema: 2 },
            'plots/sample.yaml': v2Plot,
          }),
        }).dirs,
        ['lib'],
      ),
    );
    expect(allowed.some((error) => error.message.includes('contentSchema: 2'))).toBe(false);
  });
});
