import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkCampaignContent, numericModifierPaths, type CampaignSource } from './check.js';
import { loadCampaignContent } from './load.js';

const CORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'content',
  'packs',
  'core',
);

const refs = {
  archetypes: new Set(['core/hostile-officer']),
  predicates: new Set(['MEMBER_OF']),
};

function source(
  kind: string,
  items: readonly unknown[],
  file = `campaign/${kind}.yaml`,
): CampaignSource {
  return { pack: 'core', file, list: true, kind, items };
}

describe('campaign content checks', () => {
  it('names the numeric preset and recruitment-weight fields', () => {
    const paths = numericModifierPaths();
    expect(paths.has('detectionBase.surveil')).toBe(true);
    expect(paths.has('tradecraftErrorProbability')).toBe(true);
    expect(paths.has('firstContact.e')).toBe(true);
    expect(paths.has('pitch.w1')).toBe(true);
    expect(paths.has('detection.surveil')).toBe(false);
    expect(paths.has('hintsDefault')).toBe(false);
  });

  it('reports dangling arc references with pack, file and path', () => {
    const errors = checkCampaignContent(
      [
        source('trait', [{ id: 'methodical' }]),
        source('arc-thread', [
          {
            id: 'nemesis-shadow',
            clues: [{ id: 'seen', prop: 'NOT_A_PREDICATE' }],
            roleSlots: [{ id: 'nemesis', archetypes: ['no-such-archetype'] }],
          },
        ]),
        source('arc', [
          {
            id: 'nemesis',
            binds: { nemesis: { archetype: 'no-such-archetype' } },
            traits: ['missing-trait'],
            stages: [{ thread: 'missing-thread' }],
          },
        ]),
      ],
      refs,
    );
    expect(errors.map((error) => error.message)).toEqual([
      'archetype "no-such-archetype" does not resolve',
      'predicate "NOT_A_PREDICATE" does not resolve',
      'archetype "no-such-archetype" does not resolve',
      'trait "missing-trait" does not resolve',
      'arc thread "missing-thread" does not resolve',
    ]);
    for (const error of errors) {
      expect(error.pack).toBe('core');
      expect(error.file).toContain('campaign/');
      expect(error.path.length).toBeGreaterThan(0);
    }
  });

  it('reports an unknown modifier path and inverted bounds', () => {
    const errors = checkCampaignContent([
      source('skill', [
        {
          id: 'surveillance',
          effects: [
            { path: 'not.a.field', op: 'mul', perLevel: -0.06, bounds: [1, 0.7] },
            { path: 'detectionBase.surveil', op: 'mul', perLevel: -0.06, bounds: [0.7, 1] },
          ],
        },
      ]),
    ]);
    expect(errors).toEqual([
      {
        pack: 'core',
        file: 'campaign/skill.yaml',
        path: '[0].effects[0].bounds',
        message: 'bounds must be ordered',
      },
      {
        pack: 'core',
        file: 'campaign/skill.yaml',
        path: '[0].effects[0].path',
        message: 'modifier path "not.a.field" is not a numeric preset or recruitment-weight field',
      },
    ]);
  });

  it('reports overlapping epoch years and accepts a gap', () => {
    const epochs = source('epoch', [
      { id: 'occupation', years: [1948, 1950] },
      { id: 'hardening', years: [1950, 1955] },
      { id: 'later', years: [1956, 1962] },
    ]);
    const errors = checkCampaignContent([epochs]);
    expect(errors).toEqual([
      {
        pack: 'core',
        file: 'campaign/epoch.yaml',
        path: '[1].years',
        message: 'epoch years overlap "occupation"',
      },
    ]);
  });

  it('accepts a resolved arc, an ordered effect and disjoint epochs', () => {
    const errors = checkCampaignContent(
      [
        source('trait', [{ id: 'strained' }]),
        source('arc-thread', [
          {
            id: 'nemesis-shadow',
            clues: [{ id: 'seen', prop: 'MEMBER_OF' }],
            roleSlots: [{ id: 'nemesis', archetypes: ['hostile-officer'] }],
          },
        ]),
        source('arc', [
          {
            id: 'nemesis',
            binds: { nemesis: { archetype: 'core/hostile-officer' } },
            traits: ['strained'],
            stages: [{ thread: 'nemesis-shadow' }],
          },
        ]),
        source('epoch', [
          { id: 'occupation', years: [1948, 1950] },
          { id: 'hardening', years: [1951, 1955] },
        ]),
        source('skill', [
          {
            effects: [{ path: 'meeting.regard', op: 'add', perLevel: 0.02, bounds: [0, 0.1] }],
          },
        ]),
      ],
      refs,
    );
    expect(errors).toEqual([]);
  });

  it('fails a pack load when a modifier path is not a numeric field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campaign-check-'));
    try {
      mkdirSync(join(dir, 'campaign'));
      writeFileSync(
        join(dir, 'pack.yaml'),
        [
          'id: camp-check',
          'version: 1.0.0',
          'contentSchema: 2',
          'role: extension',
          'requires: []',
          'overrides: []',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'campaign', 'skills.yaml'),
        [
          '- id: surveillance',
          '  name: Surveillance',
          '  xp:',
          '    from: [surveilObservations]',
          '    perLevel: [6, 14, 24, 36, 50]',
          '  effects:',
          '    - { path: not.a.field, op: mul, perLevel: -0.06, bounds: [0.7, 1] }',
          '',
        ].join('\n'),
      );
      const loaded = loadCampaignContent([dir], ['camp-check']);
      expect(loaded.ok).toBe(false);
      if (loaded.ok) {
        return;
      }
      expect(loaded.errors).toContainEqual({
        pack: 'camp-check',
        file: 'campaign/skills.yaml',
        path: '[0].effects[0].path',
        message: 'modifier path "not.a.field" is not a numeric preset or recruitment-weight field',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads the core pack when it has no campaign files', () => {
    const loaded = loadCampaignContent([CORE], ['core']);
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 4))).toBe(true);
  });
});
