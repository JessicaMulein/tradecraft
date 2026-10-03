import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent, type ContentError } from '../index.js';
import {
  DRAFT_AREA_SEGMENT,
  checkProvenance,
  isUnderDraftArea,
  type PackForProvenance,
} from './provenance-gate.js';

// --- unit tests on the pure gate -------------------------------------------

describe('isUnderDraftArea', () => {
  it('matches a path with a content-drafts segment anywhere in it', () => {
    expect(isUnderDraftArea('/root/content-drafts/city-vienna')).toBe(true);
    expect(isUnderDraftArea('content-drafts/era-cold-war-early')).toBe(true);
    expect(isUnderDraftArea('C:\\work\\content-drafts\\lib')).toBe(true);
  });

  it('does not match an ordinary pack path', () => {
    expect(isUnderDraftArea('/root/packs/core')).toBe(false);
  });

  it('matches per segment, not substring', () => {
    // A directory merely named like a longer word must not match.
    expect(isUnderDraftArea('/root/content-drafts-archive/x')).toBe(false);
    expect(DRAFT_AREA_SEGMENT).toBe('content-drafts');
  });
});

describe('checkProvenance', () => {
  const file = (relPath: string, content: unknown) => ({ relPath, content });

  it('accepts a bare-list file (no provenance)', () => {
    const errors: ContentError[] = [];
    const packs: PackForProvenance[] = [
      { id: 'core', dir: '/packs/core', files: [file('archetypes.yaml', [{ id: 'a' }])] },
    ];
    checkProvenance(packs, errors);
    expect(errors).toEqual([]);
  });

  it('accepts a reviewed generated file', () => {
    const errors: ContentError[] = [];
    const packs: PackForProvenance[] = [
      {
        id: 'core',
        dir: '/packs/core',
        files: [
          file('archetypes.yaml', {
            provenance: {
              generated: true,
              model: 'local/mixtral',
              reviewedBy: 'ada',
              reviewedAt: '2024-01-02T00:00:00Z',
            },
            items: [{ id: 'a' }],
          }),
        ],
      },
    ];
    checkProvenance(packs, errors);
    expect(errors).toEqual([]);
  });

  it('accepts a file explicitly marked generated: false', () => {
    const errors: ContentError[] = [];
    const packs: PackForProvenance[] = [
      {
        id: 'core',
        dir: '/packs/core',
        files: [file('archetypes.yaml', { provenance: { generated: false }, items: [] })],
      },
    ];
    checkProvenance(packs, errors);
    expect(errors).toEqual([]);
  });

  it('refuses a generated file missing reviewedBy', () => {
    const errors: ContentError[] = [];
    const packs: PackForProvenance[] = [
      {
        id: 'city-x',
        dir: '/packs/city-x',
        files: [
          file('locations.yaml', {
            provenance: { generated: true, reviewedAt: '2024-01-02T00:00:00Z' },
            items: [],
          }),
        ],
      },
    ];
    checkProvenance(packs, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      pack: 'city-x',
      file: 'locations.yaml',
      path: 'provenance',
    });
  });

  it('refuses a generated file missing reviewedAt', () => {
    const errors: ContentError[] = [];
    const packs: PackForProvenance[] = [
      {
        id: 'city-x',
        dir: '/packs/city-x',
        files: [
          file('locations.yaml', {
            provenance: { generated: true, reviewedBy: 'ada' },
            items: [],
          }),
        ],
      },
    ];
    checkProvenance(packs, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('locations.yaml');
  });

  it('refuses a whole pack under the Draft Area and does not inspect its files', () => {
    const errors: ContentError[] = [];
    const packs: PackForProvenance[] = [
      {
        id: 'city-draft',
        dir: '/root/content-drafts/city-draft',
        // a file that would otherwise also fail — but the pack is refused once
        files: [file('locations.yaml', { provenance: { generated: true }, items: [] })],
      },
    ];
    checkProvenance(packs, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ pack: 'city-draft', file: 'pack.yaml', path: '' });
    expect(errors[0].message).toContain(DRAFT_AREA_SEGMENT);
  });
});

// --- integration through the loader ----------------------------------------

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

/**
 * Write packs under a chosen subdirectory of a fresh temp root (so a pack can
 * be placed under `content-drafts/`). Returns the pack directories.
 */
function writePacksUnder(
  subdir: string,
  packs: Record<string, PackFiles>,
): { dirs: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'tc-prov-'));
  tempRoots.push(root);
  const dirs: string[] = [];
  for (const [name, files] of Object.entries(packs)) {
    const dir = join(root, subdir, name);
    mkdirSync(dir, { recursive: true });
    for (const [rel, value] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof value === 'string' ? value : toYaml(value), 'utf8');
    }
    dirs.push(dir);
  }
  return { dirs };
}

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

const waiter = {
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
  tags: [],
};

/** A minimal schema-2 core pack with one archetype file. */
function minimalCore(archetypesFile: unknown): PackFiles {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 2, role: 'core' },
    'personas.yaml': [personaAustrian],
    'descriptors.yaml': descriptorsCore,
    'archetypes.yaml': archetypesFile,
  };
}

describe('loadContent — Provenance gate (Req 16.3, 16.4)', () => {
  it('refuses a generated-but-unreviewed file', () => {
    const { dirs } = writePacksUnder('packs', {
      core: minimalCore({
        provenance: { generated: true, model: 'local/x' },
        items: [waiter],
      }),
    });
    const result = loadContent(dirs, ['core']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.file === 'archetypes.yaml' && e.path === 'provenance',
        ),
      ).toBe(true);
    }
  });

  it('accepts a reviewed generated file', () => {
    const { dirs } = writePacksUnder('packs', {
      core: minimalCore({
        provenance: {
          generated: true,
          model: 'local/x',
          reviewedBy: 'ada',
          reviewedAt: '2024-01-02T00:00:00Z',
        },
        items: [waiter],
      }),
    });
    const result = loadContent(dirs, ['core']);
    expect(result.ok).toBe(true);
  });

  it('refuses a pack loaded from under content-drafts/', () => {
    const { dirs } = writePacksUnder('content-drafts', {
      core: minimalCore([waiter]),
    });
    const result = loadContent(dirs, ['core']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.file === 'pack.yaml' && e.message.includes(DRAFT_AREA_SEGMENT),
        ),
      ).toBe(true);
    }
  });

  it('accepts the same pack when it is not under the Draft Area', () => {
    const { dirs } = writePacksUnder('packs', { core: minimalCore([waiter]) });
    expect(loadContent(dirs, ['core']).ok).toBe(true);
  });
});
