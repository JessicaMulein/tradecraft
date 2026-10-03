/**
 * The Content Kind Registry (content-expansion task 1.2).
 *
 * These tests pin the behaviour task 1.2 adds to the loader: every slice kind
 * and every kind this spec registers is known, a file of an unregistered kind
 * is refused with a located error (Requirement 17.2), and a caller can register
 * extra kinds through `LoadOptions.kinds` (Requirement 17.7). The static shape
 * of the registry — the slice registrations and this spec's registrations — is
 * checked directly so a kind that is dropped or mis-declared is caught here.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';
import { z } from 'zod';

import {
  CONTENT_EXPANSION_KIND_REGISTRATIONS,
  SLICE_KIND_REGISTRATIONS,
  loadContent,
  type ContentKindRegistration,
} from '../index.js';

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

function writePack(files: PackFiles): string[] {
  const root = mkdtempSync(join(tmpdir(), 'tc-registry-'));
  tempRoots.push(root);
  const dir = join(root, 'core');
  mkdirSync(dir, { recursive: true });
  for (const [rel, value] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : toYaml(value), 'utf8');
  }
  return [dir];
}

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

const locationKaffeehaus = {
  id: 'kaffeehaus',
  public: true,
  allowedActions: ['talk'],
  baseRisk: 0.1,
  allowsDeadDrops: false,
  namePatterns: ['Café {pick:names}'],
  descriptionPool: ['A warm coffee house.'],
  atmosphereTags: ['smoky'],
};

/** A minimal pack that loads cleanly on its own. */
function corePack(overrides: PackFiles = {}): PackFiles {
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

// --- the static registry ---------------------------------------------------

describe('Content Kind Registry — slice kinds (Req 17.1)', () => {
  it('registers every slice content kind with a dir, schema and roles', () => {
    const kinds = SLICE_KIND_REGISTRATIONS.map((r) => r.kind).sort();
    expect(kinds).toEqual(
      [
        'archetype',
        'cover-identity',
        'difficulty-preset',
        'document-template',
        'hint',
        'location-type',
        'persona-library',
        'plot-template',
        'rumour-template',
        'side-thread-template',
      ].sort(),
    );
    for (const reg of SLICE_KIND_REGISTRATIONS) {
      expect(reg.dir.length).toBeGreaterThan(0);
      expect(reg.roles.length).toBeGreaterThan(0);
      expect(reg.cityScoped).toBe(false);
      expect(reg.owner).toContain('content');
    }
  });

  it('registers every new kind this spec adds, each with a distinct name', () => {
    const names = CONTENT_EXPANSION_KIND_REGISTRATIONS.map((r) => r.kind);
    for (const expected of [
      'tag-vocabulary',
      'city',
      'district',
      'location',
      'route',
      'newspaper',
      'local-org',
      'weather',
      'streets',
      'sources',
      'era',
      'technology',
      'cipher-conventions',
      'anachronisms',
      'blocklist',
      'style-guide',
      'sensitivity',
      'public-text',
      'culture-group',
      'descriptor-fragment',
      'locale',
      'template-variant',
      'service',
    ]) {
      expect(names).toContain(expected);
    }
    // No duplicate kind names across this spec's registrations.
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks the City kinds City-Scoped and the Era/Library kinds not', () => {
    const byKind = new Map(
      CONTENT_EXPANSION_KIND_REGISTRATIONS.map((r) => [r.kind, r]),
    );
    expect(byKind.get('city')?.cityScoped).toBe(true);
    expect(byKind.get('district')?.cityScoped).toBe(true);
    expect(byKind.get('era')?.cityScoped).toBe(false);
    expect(byKind.get('culture-group')?.cityScoped).toBe(false);
    expect(byKind.get('city')?.roles).toEqual(['city']);
    expect(byKind.get('era')?.roles).toEqual(['era']);
  });
});

// --- loader behaviour -------------------------------------------------------

describe('Content Kind Registry — loader (Req 17.2)', () => {
  it('still loads a pack that uses only slice kinds', () => {
    const result = loadContent(writePack(corePack()), ['core']);
    expect(result.ok).toBe(true);
  });

  it('accepts a file whose kind this spec registers (era)', () => {
    // `era.yaml` is a registered kind (its schema arrives in task 1.5), so a
    // pack carrying it loads rather than being refused.
    const result = loadContent(
      writePack(corePack({ 'era.yaml': { id: 'cold-war' } })),
      ['core'],
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a registered kind laid out as a directory of files', () => {
    const result = loadContent(
      writePack(corePack({ 'districts/innere-stadt.yaml': { id: 'innere-stadt' } })),
      ['core'],
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a file whose kind is not registered, with a located error', () => {
    const result = loadContent(
      writePack(corePack({ 'spaceships.yaml': [{ id: 'enterprise' }] })),
      ['core'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.file === 'spaceships.yaml');
      expect(err).toBeDefined();
      expect(err?.pack).toBe('core');
      expect(err?.message).toContain('registered content kind');
    }
  });

  it('accepts a caller-registered kind through LoadOptions.kinds (Req 17.7)', () => {
    const spaceship: ContentKindRegistration = {
      kind: 'spaceship',
      dir: 'spaceships',
      schema: z.unknown(),
      roles: ['extension'],
      cityScoped: false,
      fields: {},
      owner: '@tradecraft/test',
    };
    const dirs = writePack(corePack({ 'spaceships.yaml': [{ id: 'enterprise' }] }));
    expect(loadContent(dirs, ['core']).ok).toBe(false);
    expect(loadContent(dirs, ['core'], { kinds: [spaceship] }).ok).toBe(true);
  });
});
