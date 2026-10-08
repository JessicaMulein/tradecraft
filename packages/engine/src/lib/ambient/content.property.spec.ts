/**
 * Property 20: a valid ambient document loads, and a single corruption fails
 * with pack, file and path.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  checkAmbientPredicate,
  checkAmbientRefs,
  duplicateIdIssues,
  type AmbientCatalogue,
} from './check.js';
import { EVENT_CATEGORIES, EventTemplateSchema, METRIC_IDS } from './content.js';

const catalogue: AmbientCatalogue = {
  stories: new Set(['strike']),
  notices: new Set(['curfew-order']),
  tags: new Set(['sector:international', 'function:cafe']),
};

const idArb = fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/);

function event(id: string, metric: (typeof METRIC_IDS)[number], category: (typeof EVENT_CATEGORIES)[number]) {
  return {
    id,
    category,
    class: 'exogenous' as const,
    weight: 1,
    cooldownDays: 0,
    name: 'A notice',
    durationDays: [1, 2] as [number, number],
    stages: [
      {
        day: 0,
        ops: [{ op: 'metric-delta' as const, metric, delta: 0.05 }],
      },
    ],
  };
}

describe('ambient content validation property', () => {
  it('accepts a generated event and locates each corruption', () => {
    // Feature: ambient-world, Property 20: Ambient content validation
    fc.assert(
      fc.property(
        idArb,
        fc.constantFrom(...METRIC_IDS),
        fc.constantFrom(...EVENT_CATEGORIES),
        fc.constantFrom('op', 'story', 'person', 'implication', 'duplicate'),
        (id, metric, category, corruption) => {
          const valid = event(id, metric, category);
          expect(EventTemplateSchema.safeParse(valid).success).toBe(true);
          expect(
            checkAmbientRefs([valid], [], catalogue, 'ambient', 'events/events.yaml', 'incidents/incidents.yaml'),
          ).toEqual([]);

          if (corruption === 'op') {
            const parsed = EventTemplateSchema.safeParse({
              ...valid,
              stages: [{ day: 0, ops: [{ op: 'fly-away' }] }],
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
              const issue = parsed.error.issues[0];
              expect(issue).toBeDefined();
              expect(issue?.path.join('.')).toContain('ops');
            }
            return;
          }
          if (corruption === 'story') {
            const dangling = {
              ...valid,
              stages: [
                {
                  day: 0,
                  ops: [{ op: 'news-development', story: 'missing-story', beat: 'announced' }],
                },
              ],
            };
            const issues = checkAmbientRefs(
              [dangling],
              [],
              catalogue,
              'ambient',
              'events/events.yaml',
              'incidents/incidents.yaml',
            );
            expect(issues[0]).toMatchObject({
              pack: 'ambient',
              file: 'events/events.yaml',
              path: '[0].stages[0].ops[0].story',
            });
            return;
          }
          if (corruption === 'person') {
            const parsed = EventTemplateSchema.safeParse({
              ...valid,
              stages: [
                {
                  day: 0,
                  ops: [
                    {
                      op: 'detain-npc',
                      who: { query: ['role:cell'] },
                      days: 1,
                    },
                  ],
                },
              ],
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
              expect(parsed.error.issues[0]?.path.join('.')).toContain('who');
            }
            return;
          }
          if (corruption === 'implication') {
            const issues = checkAmbientPredicate(
              { implication: { role: 'subject' } },
              'ambient',
              'predicates.yaml',
              '[0]',
            );
            expect(issues[0]).toMatchObject({
              pack: 'ambient',
              file: 'predicates.yaml',
              path: '[0]',
            });
            return;
          }
          const issues = duplicateIdIssues(
            [{ id }, { id }],
            'ambient',
            'events/events.yaml',
          );
          expect(issues[0]).toMatchObject({
            pack: 'ambient',
            file: 'events/events.yaml',
            path: '[1].id',
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
