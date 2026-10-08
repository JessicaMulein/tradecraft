/**
 * Property 22: a generated campaign content set loads, and one corruption
 * fails with a pack, file and path that locate it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

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

const PACK = `id: camp-prop
version: 1.0.0
contentSchema: 2
role: extension
requires:
  - id: core
    range: "^1.0.0"
overrides: []
`;

const CORRUPTIONS = ['archetype', 'trait', 'condition', 'path', 'bounds'] as const;
type Corruption = (typeof CORRUPTIONS)[number];

interface Generated {
  readonly n: number;
  readonly perLevel: number;
  readonly path: string;
  readonly year: number;
  readonly posting: number;
  readonly corruption: Corruption;
}

function documents(g: Generated, corrupt: boolean): Record<string, unknown> {
  const trait = `t${g.n}`;
  const thread = `h${g.n}`;
  const arc: Record<string, unknown> = {
    id: `c${g.n}`,
    priority: 1,
    binds: {
      nemesis: { from: 'carried-hostile', archetype: 'core/cell-leader' },
    },
    traits: [trait],
    stages: [
      {
        id: 'shadow',
        when: [{ kind: 'posting-index-at-least', n: g.posting }],
        thread,
        advance: [{ kind: 'clue-held', clue: 'seen-clue' }],
      },
    ],
    resolve: [{ kind: 'person-status', slot: 'nemesis', in: ['arrested'] }],
  };
  const skill: Record<string, unknown> = {
    id: `s${g.n}`,
    name: 'Surveillance',
    xp: { from: ['surveilObservations'], perLevel: [1, 2, 3, 4, 5] },
    effects: [{ path: g.path, op: 'mul', perLevel: g.perLevel, bounds: [0.7, 1] }],
  };
  if (corrupt && g.corruption === 'archetype') {
    arc.binds = { nemesis: { from: 'carried-hostile', archetype: 'missing-archetype' } };
  }
  if (corrupt && g.corruption === 'trait') {
    arc.traits = ['missing-trait'];
  }
  if (corrupt && g.corruption === 'condition') {
    const stage = (arc.stages as Record<string, unknown>[])[0];
    if (stage !== undefined) {
      stage.when = [{ kind: 'fly-away' }];
    }
  }
  if (corrupt && g.corruption === 'path') {
    skill.effects = [{ path: 'not.a.field', op: 'mul', perLevel: g.perLevel, bounds: [0.7, 1] }];
  }
  if (corrupt && g.corruption === 'bounds') {
    skill.effects = [{ path: g.path, op: 'mul', perLevel: g.perLevel, bounds: [1, 0.2] }];
  }
  return {
    'campaign/traits.yaml': [{ id: trait, name: 'A trait' }],
    'campaign/arc-threads.yaml': [
      {
        id: thread,
        stages: [
          {
            id: 'seen',
            deadline: { min: 1, max: 4 },
            onDisrupted: { delay: 1, reroute: 0, abort: 0 },
            traces: [{ kind: 'meeting', evidences: ['MEMBER_OF'], text: 'A meeting.' }],
          },
        ],
        clues: [{ id: 'seen-clue', prop: 'MEMBER_OF' }],
      },
    ],
    'campaign/arcs.yaml': [arc],
    'campaign/skills.yaml': [skill],
    'campaign/epochs.yaml': [
      { id: `e${g.n}a`, years: [g.year, g.year], ciphers: ['caesar'], tension: [0.4, 0.6] },
      { id: `e${g.n}b`, years: [g.year + 2, g.year + 4], ciphers: ['caesar'], tension: [0.2, 0.3] },
    ],
  };
}

function writePack(dir: string, docs: Record<string, unknown>): void {
  mkdirSync(join(dir, 'campaign'), { recursive: true });
  writeFileSync(join(dir, 'pack.yaml'), PACK);
  for (const [file, body] of Object.entries(docs)) {
    writeFileSync(join(dir, file), stringify(body));
  }
}

function located(corruption: Corruption): { readonly file: string; readonly path: string } {
  if (corruption === 'path' || corruption === 'bounds') {
    return {
      file: 'campaign/skills.yaml',
      path: corruption === 'path' ? '[0].effects[0].path' : '[0].effects[0].bounds',
    };
  }
  if (corruption === 'archetype') {
    return { file: 'campaign/arcs.yaml', path: '[0].binds.nemesis.archetype' };
  }
  if (corruption === 'trait') {
    return { file: 'campaign/arcs.yaml', path: '[0].traits[0]' };
  }
  return { file: 'campaign/arcs.yaml', path: '[0].stages[0].when[0]' };
}

describe('campaign content validation property', () => {
  it('loads a generated set and locates one corruption', () => {
    // Feature: campaign-career, Property 22: Campaign content validation
    const dir = mkdtempSync(join(tmpdir(), 'campaign-prop-'));
    try {
      fc.assert(
        fc.property(
          fc.record({
            n: fc.integer({ min: 1, max: 9000 }),
            perLevel: fc.integer({ min: -5, max: 5 }),
            path: fc.constantFrom(
              'detectionBase.surveil',
              'tradecraftErrorProbability',
              'firstContact.a',
              'pitch.w1',
            ),
            // Core epochs occupy 1948–1962. A generated span in that range is an
            // overlap, not a valid set, so the property draws years after it.
            year: fc.integer({ min: 1963, max: 1980 }),
            posting: fc.integer({ min: 0, max: 6 }),
            corruption: fc.constantFrom(...CORRUPTIONS),
          }),
          (generated) => {
            writePack(dir, documents(generated, false));
            const valid = loadCampaignContent([CORE, dir], ['camp-prop']);
            expect(valid.ok, valid.ok ? '' : JSON.stringify(valid.errors.slice(0, 4))).toBe(true);

            writePack(dir, documents(generated, true));
            const failed = loadCampaignContent([CORE, dir], ['camp-prop']);
            expect(failed.ok).toBe(false);
            if (failed.ok) {
              return;
            }
            const where = located(generated.corruption);
            expect(failed.errors).toContainEqual(
              expect.objectContaining({
                pack: 'camp-prop',
                file: where.file,
                path: expect.stringContaining(where.path),
              }),
            );
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
