/**
 * Property 20: for any player history and candidate set, fallback selection
 * returns a template that is not already in the history whenever one exists,
 * and otherwise returns a candidate. Archived schema-2 plots become history
 * rows, one per plot, in posting order.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createPrng } from './prng/prng.js';
import { fallbackSelect, toTemplateHistory } from './plot-select.js';

const id = fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/);

const plotEntry = fc.record({
  templateId: id,
  variantKey: id,
  archetype: fc.constantFrom('sabotage', 'mole', 'smuggling'),
  outcome: fc.constantFrom('success', 'failure'),
});

describe('fallback plot selection property', () => {
  it('avoids a used template when another remains, and records every archived plot in order', () => {
    // Feature: campaign-career, Property 20: Fallback Plot selection
    fc.assert(
      fc.property(
        fc.uniqueArray(id, { minLength: 1, maxLength: 8 }),
        fc.array(id, { maxLength: 12 }),
        fc.array(
          fc.record({
            plots: fc.option(fc.array(plotEntry, { maxLength: 4 }), { nil: undefined }),
          }),
          { maxLength: 5 },
        ),
        fc.string({ minLength: 1, maxLength: 16 }),
        (candidateIds, historyIds, visible, seed) => {
          const chosen = fallbackSelect(
            candidateIds.map((candidateId) => ({ id: candidateId })),
            historyIds.map((templateId) => ({ templateId })),
            createPrng(seed),
          );
          const unused = candidateIds.filter((candidateId) => !historyIds.includes(candidateId));
          if (unused.length > 0) {
            expect(unused).toContain(chosen);
          } else {
            expect(candidateIds).toContain(chosen);
          }

          const rows = toTemplateHistory(visible);
          expect(rows).toEqual(visible.flatMap((posting) => posting.plots ?? []));
        },
      ),
      { numRuns: 100 },
    );
  });
});
