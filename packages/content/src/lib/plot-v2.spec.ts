import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  PlotTemplateV2Schema,
  checkPlotTemplateV2,
  normaliseSchema1Plot,
  unexpectedProperNouns,
  type PlotTemplateV2,
  type VocabularyView,
} from './plot-v2.js';
import { PlotTemplateSchema, type PlotTemplate } from './kinds.js';

const VOCAB: VocabularyView = {
  tagAppliesTo: new Map([
    ['function:cafe', new Set(['location', 'location-type'])],
    ['role:cell', new Set(['archetype'])],
    ['materiel:charge', new Set(['plot-item'])],
  ]),
  requiredQueries: [{ query: ['function:cafe'] }, { query: ['role:cell'] }],
};

function stage(id: string, requires: string[] = []) {
  return {
    id,
    requires,
    deadline: { min: 2, max: 4 },
    traces: [
      {
        kind: 'meeting' as const,
        roles: ['leader'],
        place: { query: ['function:cafe'] },
        evidences: ['LOCATED_AT'],
        text: 'A watcher keeps a quiet note of who comes and goes.',
      },
    ],
    onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
  };
}

function validTemplate(extra: Record<string, unknown> = {}): PlotTemplateV2 {
  return PlotTemplateV2Schema.parse({
    id: 'sample',
    templateSchema: 2,
    kind: 'plot',
    displayName: 'Sample',
    archetype: 'sabotage',
    era: { from: 1948, to: 1962 },
    minPreset: 'easy',
    params: {
      venue: { kind: 'loc', query: ['function:cafe'] },
    },
    roleSlots: {
      leader: { query: ['role:cell'] },
    },
    cells: [{ id: 'action', roles: ['leader'] }],
    stages: [stage('open'), stage('close', ['open'])],
    stageCount: { min: 2, max: 4 },
    outcomes: {
      success: [{ kind: 'arrest-role', role: 'leader' }],
      failure: [{ kind: 'stage-completed', stage: 'close' }],
    },
    ...extra,
  });
}

describe('proper nouns', () => {
  it('allows a sentence-initial capital and an allowlisted institution', () => {
    expect(unexpectedProperNouns('The station opens Monday.', new Set(['Monday']))).toEqual([]);
    expect(unexpectedProperNouns('A clerk named Otto waits.', new Set())).toEqual(['Otto']);
  });

  it('ignores text inside slots', () => {
    expect(unexpectedProperNouns('Meet {Name} at the bar.', new Set())).toEqual([]);
  });
});

describe('schema-1 normaliser', () => {
  const slice: PlotTemplate = PlotTemplateSchema.parse({
    id: 'slice-plot',
    roleSlots: [{ id: 'leader', archetypes: ['cell-leader'] }],
    materielSlots: [{ id: 'file', description: 'A file.' }],
    targetSlots: [],
    stages: [
      {
        id: 'open',
        requires: [],
        produces: ['seen'],
        deadline: { min: 2, max: 4 },
        traces: [
          {
            kind: 'meeting',
            roles: ['leader'],
            evidences: ['LOCATED_AT'],
            text: 'Someone waits.',
          },
        ],
        onDisrupted: { delay: 0.5, reroute: 0.4, abort: 0.1 },
      },
    ],
  });

  it('maps a slice template to one cell and no branches', () => {
    const normalised = normaliseSchema1Plot(slice);
    expect(normalised.cells).toEqual([{ id: 'cell', roles: ['leader'] }]);
    expect(normalised.stages.every((entry) => 'id' in entry)).toBe(true);
    expect(normalised.twist).toBeUndefined();
    expect(normalised.outcomes.success.map((cond) => cond.kind)).toEqual([
      'arrest-role',
      'seize-item',
      'abort',
    ]);
  });
});

describe('Property 1: v2 content validation', () => {
  it('accepts a valid template and rejects each corruption', () => {
    // Feature: plot-library, Property 1: v2 content validation
    const base = validTemplate();
    expect(
      checkPlotTemplateV2({
        template: base,
        file: 'plots/sample.yaml',
        pack: 'coldwar-plots',
        vocabulary: VOCAB,
        itemTagSets: [['materiel:charge']],
      }),
    ).toEqual([]);

    fc.assert(
      fc.property(
        fc.constantFrom(
          'unknown-tag',
          'cycle',
          'missing-default',
          'too-many-configs',
          'bad-query-length',
        ),
        (corruption) => {
          let template = validTemplate();
          if (corruption === 'unknown-tag') {
            template = validTemplate({
              params: { venue: { kind: 'loc', query: ['function:missing'] } },
            });
          } else if (corruption === 'cycle') {
            template = validTemplate({
              stages: [stage('open', ['close']), stage('close', ['open'])],
            });
          } else if (corruption === 'missing-default') {
            template = validTemplate({
              stages: [
                stage('open'),
                {
                  branch: 'approach',
                  resolve: 'runtime',
                  after: ['open'],
                  alternatives: [
                    { id: 'night', when: [{ kind: 'alertness-at-least', value: 0.5 }], stages: [stage('plant')] },
                    { id: 'day', when: [{ kind: 'alertness-at-least', value: 0.1 }], stages: [stage('wait')] },
                  ],
                },
              ],
            });
          } else if (corruption === 'too-many-configs') {
            const branch = (name: string) => ({
              branch: name,
              resolve: 'runtime' as const,
              after: [] as string[],
              alternatives: [
                { id: 'a', when: [{ kind: 'default' as const }], stages: [stage(`${name}-a`)] },
                { id: 'b', when: [{ kind: 'alertness-at-least' as const, value: 1 }], stages: [stage(`${name}-b`)] },
              ],
            });
            template = validTemplate({
              stages: [branch('b1'), branch('b2'), branch('b3'), branch('b4'), branch('b5'), branch('b6')],
              stageCount: { min: 1, max: 12 },
            });
          } else {
            expect(() =>
              validTemplate({
                params: {
                  venue: {
                    kind: 'loc',
                    query: ['function:cafe', 'role:cell', 'function:cafe', 'role:cell'],
                  },
                },
              }),
            ).toThrow();
            return;
          }
          const errors = checkPlotTemplateV2({
            template,
            file: 'plots/sample.yaml',
            pack: 'coldwar-plots',
            vocabulary: VOCAB,
          });
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.every((issue) => issue.pack === 'coldwar-plots' && issue.file === 'plots/sample.yaml')).toBe(
            true,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
