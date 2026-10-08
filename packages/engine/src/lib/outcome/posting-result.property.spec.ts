/**
 * Property 6: for any debrief, protected set and case file, a shown item names
 * no protected entity or matches a corroborated claim, an item that names none
 * is shown verbatim, and the end-of-campaign reveal contains every full item.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Proposition } from '../model/core.js';
import { redactDebrief, revealDebriefs, type CarryClaim, type DebriefFact, type PostedDebrief } from './posting-result.js';

const ENTITIES = ['npc:ada', 'npc:mole', 'npc:clerk', 'unk:1', 'org:hostile'] as const;

function sameProposition(left: Proposition, right: Proposition): boolean {
  return (
    left.id === right.id ||
    (left.predicate === right.predicate &&
      left.subject === right.subject &&
      left.object === right.object &&
      (left.place ?? '') === (right.place ?? ''))
  );
}

function namesProtected(item: DebriefFact, protectedIds: ReadonlySet<string>): boolean {
  return (item.entities ?? []).some((entity) => protectedIds.has(entity));
}

function corroborated(item: DebriefFact, claims: readonly CarryClaim[]): boolean {
  const fact = item.prop;
  if (fact === undefined) {
    return false;
  }
  return claims.some((claim) => claim.relation === 'corroborated' && sameProposition(claim.prop, fact));
}

describe('debrief redaction property', () => {
  it('shows only unprotected or corroborated items, and reveals every full item at the end', () => {
    // Feature: campaign-career, Property 6: Debrief redaction and reveal
    const entity = fc.constantFrom(...ENTITIES);
    const proposition: fc.Arbitrary<Proposition> = fc
      .record({
        id: fc.string({ minLength: 1, maxLength: 12 }),
        subject: entity,
        predicate: fc.constantFrom('KNOWS', 'LOCATED_AT'),
        object: entity,
      })
      .map((value) => value as Proposition);

    const fact = fc.record({
      text: fc.string({ maxLength: 40 }),
      entities: fc.subarray([...ENTITIES], { maxLength: 3 }),
      prop: fc.option(proposition, { nil: undefined }),
      relation: fc.constantFrom('none', 'corroborated', 'conflicted', 'absent'),
    });

    const debrief = fc.record({
      outcome: fc.constantFrom('success', 'failure-plot', 'failure-burned'),
      cause: fc.string({ maxLength: 20 }),
      sections: fc.array(
        fc.record({
          id: fc.constantFrom('allegiances', 'timeline', 'lies', 'noise'),
          items: fc.array(fact, { maxLength: 4 }),
        }),
        { maxLength: 3 },
      ),
    });

    fc.assert(
      fc.property(
        fc.record({
          debriefs: fc.array(debrief, { maxLength: 3 }),
          protectedIds: fc.subarray([...ENTITIES]),
        }),
        (sample) => {
          const protectedIds = new Set<string>(sample.protectedIds);
          const claims: CarryClaim[] = [];
          const briefings: PostedDebrief[] = sample.debriefs.map((briefing) => ({
            outcome: briefing.outcome,
            cause: briefing.cause,
            sections: briefing.sections.map((section) => ({
              id: section.id,
              items: section.items.map((item) => {
                const factItem: DebriefFact = {
                  text: item.text,
                  entities: item.entities,
                  ...(item.prop === undefined ? {} : { prop: item.prop }),
                };
                if (item.prop !== undefined && item.relation !== 'absent') {
                  claims.push({
                    id: `c${claims.length}`,
                    prop: item.prop,
                    text: item.text,
                    relation: item.relation,
                  });
                }
                return factItem;
              }),
            })),
          }));

          for (const briefing of briefings) {
            const redacted = redactDebrief(briefing, protectedIds, claims);
            expect(redacted.sections).toHaveLength(briefing.sections.length);
            briefing.sections.forEach((section, sectionIndex) => {
              const out = redacted.sections[sectionIndex];
              expect(out?.items).toHaveLength(section.items.length);
              section.items.forEach((item, itemIndex) => {
                const shown = out?.items[itemIndex];
                const named = namesProtected(item, protectedIds);
                if (!named) {
                  expect(shown).toEqual({ kind: 'shown', item: { text: item.text } });
                }
                if (shown?.kind === 'shown' && named) {
                  expect(corroborated(item, claims)).toBe(true);
                }
              });
            });
          }

          const revealed = revealDebriefs(briefings);
          expect(revealed).toHaveLength(briefings.length);
          briefings.forEach((briefing, index) => {
            const full = briefing.sections.flatMap((section) => section.items.map((item) => item.text));
            const opened = revealed[index]?.sections.flatMap((section) =>
              section.items.map((item) => item.text),
            );
            expect(opened).toEqual(full);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
