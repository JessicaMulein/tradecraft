/**
 * Property 14: after any sequence of awards, requisitions and exfiltrations,
 * Career Points equal the starting balance plus awards minus the costs that
 * were actually paid. The balance never goes negative, and a rejected
 * purchase leaves the state unchanged.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ExfiltrationSchema, type Exfiltration } from './content/schemas.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { applyPreparation, debitCareerPoints } from './prepare.js';
import { step } from './reducer.js';
import { applyReview, careerPointsAward } from './review.js';
import type { CampaignChoice, CampaignState } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}
const floor = config.value.review.dismissalFloor;

const exfiltrations = (
  parse(readFileSync(join(CORE, 'campaign', 'exfiltrations.yaml'), 'utf8')) as unknown[]
).map((item) => ExfiltrationSchema.parse(item));
if (content.requisitions.length === 0 || exfiltrations.length === 0) {
  throw new Error('core campaign content is missing requisitions or exfiltrations');
}

const created = step(undefined, {
  kind: 'choice',
  choice: {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  } satisfies Extract<CampaignChoice, { kind: 'create' }>,
}, content);
if (!created.ok) {
  throw new Error(created.error.kind);
}
const base = created.value;

type Step =
  | { readonly kind: 'award'; readonly score: number }
  | { readonly kind: 'requisition'; readonly id: string }
  | { readonly kind: 'exfiltration'; readonly item: Exfiltration };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('award' as const),
    score: fc.double({ min: -40, max: 40, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant('requisition' as const),
    id: fc.constantFrom(...content.requisitions.map((item) => item.id)),
  }),
  fc.record({
    kind: fc.constant('exfiltration' as const),
    item: fc.constantFrom(...exfiltrations),
  }),
);

function withPoints(state: CampaignState, careerPoints: number): CampaignState {
  return {
    ...state,
    step: { kind: 'prepare' },
    view: { ...state.view, officer: { ...state.view.officer, careerPoints } },
  };
}

describe('career point conservation property', () => {
  it('keeps the balance at awards minus paid costs, and never below zero', () => {
    // Feature: campaign-career, Property 14: Career Point conservation
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(stepArb, { maxLength: 12 }),
        (initial, steps) => {
          let state = withPoints(base, initial);
          let awarded = 0;
          let spent = 0;
          for (const move of steps) {
            const before = JSON.stringify(state);
            const points = state.view.officer.careerPoints;
            if (move.kind === 'award') {
              const reviewed = applyReview(
                state.view.officer,
                move.score,
                0,
                content.ranks,
                content.texts,
                floor,
              );
              expect(reviewed.ok).toBe(true);
              if (!reviewed.ok) {
                return;
              }
              const award = reviewed.value.careerPoints - points;
              expect(award).toBe(careerPointsAward(move.score));
              expect(award).toBeGreaterThanOrEqual(0);
              state = withPoints(state, reviewed.value.careerPoints);
              awarded += award;
            } else if (move.kind === 'requisition') {
              const item = content.requisitions.find((row) => row.id === move.id);
              const bought = applyPreparation(
                state,
                { kind: 'requisition', id: move.id },
                content,
                { leaveRelief: config.value.stress.leaveRelief },
              );
              if (!bought.ok) {
                expect(JSON.stringify(state)).toBe(before);
              } else {
                state = bought.value;
                spent += item?.cost ?? 0;
              }
            } else {
              const paid = debitCareerPoints(state, move.item.cost);
              if (!paid.ok) {
                expect(JSON.stringify(state)).toBe(before);
              } else {
                state = paid.value;
                spent += move.item.cost;
              }
            }
            expect(state.view.officer.careerPoints).toBeGreaterThanOrEqual(0);
          }
          expect(state.view.officer.careerPoints).toBe(initial + awarded - spent);
        },
      ),
      { numRuns: 100 },
    );
  });
});
