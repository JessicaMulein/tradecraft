/**
 * Property 12: for any officer and two scores a ≤ b, the decision for b is at
 * least as favourable as the decision for a. Favour runs dismiss, reprimand,
 * demote, hold, promote. The rank after either decision stays on the ladder,
 * and moves by at most one step.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { RANKS } from './content/schemas.js';
import { loadCampaignConfig } from './config.js';
import { applyReview, type ReviewDecision } from './review.js';

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
if (content.ranks.length === 0 || content.texts.length === 0) {
  throw new Error('core campaign content is missing ranks or texts');
}

const FAVOUR: readonly ReviewDecision[] = ['dismiss', 'reprimand', 'demote', 'hold', 'promote'];
const floor = config.value.review.dismissalFloor;

describe('review monotonicity property', () => {
  it('ranks a higher score at least as favourably, and keeps the rank on the ladder', () => {
    // Feature: campaign-career, Property 12: Review monotonicity
    fc.assert(
      fc.property(
        fc.record({
          rank: fc.constantFrom(...RANKS),
          reprimands: fc.integer({ min: 0, max: 5 }),
          careerStanding: fc.double({ min: -30, max: 30, noNaN: true }),
          low: fc.double({ min: -40, max: 40, noNaN: true }),
          high: fc.double({ min: -40, max: 40, noNaN: true }),
        }),
        (sample) => {
          const officer = {
            name: 'Ada',
            rank: sample.rank,
            reprimands: sample.reprimands,
            careerStanding: sample.careerStanding,
            careerPoints: 0,
            factions: {},
          };
          const scores = [sample.low, sample.high].sort((left, right) => left - right);
          const lower = applyReview(officer, scores[0] ?? 0, 0, content.ranks, content.texts, floor);
          const higher = applyReview(officer, scores[1] ?? 0, 0, content.ranks, content.texts, floor);
          expect(lower.ok).toBe(true);
          expect(higher.ok).toBe(true);
          if (!lower.ok || !higher.ok) {
            return;
          }
          const from = RANKS.indexOf(sample.rank);
          expect(FAVOUR.indexOf(higher.value.decision)).toBeGreaterThanOrEqual(
            FAVOUR.indexOf(lower.value.decision),
          );
          for (const result of [lower.value, higher.value]) {
            const to = RANKS.indexOf(result.rank);
            expect(to).toBeGreaterThanOrEqual(0);
            expect(Math.abs(to - from)).toBeLessThanOrEqual(1);
            if (result.decision === 'promote') {
              expect(to).toBeGreaterThanOrEqual(from);
            } else if (result.decision === 'demote') {
              expect(to).toBeLessThanOrEqual(from);
            } else {
              expect(to).toBe(from);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
