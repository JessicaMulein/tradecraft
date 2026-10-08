/**
 * Review Board arithmetic and the decision Cable.
 *
 * The score uses the shipped weights. Decisions follow the rank table and the
 * dismissal floor. The Cable is the review template with the officer's name,
 * current rank and score filled in.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import {
  accumulateStanding,
  applyReview,
  careerPointsAward,
  careerScore,
  renderTemplate,
  reviewDecision,
  type CareerScoreInput,
  type ReviewDecision,
} from './review.js';
import type { Officer } from './state.js';

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

const weights = config.value.review.weights;
const floor = config.value.review.dismissalFloor;

function decision(
  score: number,
  officer: Pick<Officer, 'rank' | 'reprimands' | 'careerStanding'>,
): ReviewDecision {
  const result = reviewDecision(score, officer, content.ranks, floor);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

function input(patch: Partial<CareerScoreInput> = {}): CareerScoreInput {
  return {
    outcome: 'success',
    standing: 0,
    directives: [],
    arrestsWrongful: 0,
    assetsLost: 0,
    ...patch,
  };
}

describe('review board', () => {
  it('adds the weighted outcome, standing, directives, arrests, losses and factions', () => {
    const score = careerScore(
      input({
        outcome: 'success',
        standing: 20,
        directives: [{ status: 'met' }, { status: 'open' }, { status: 'failed' }],
        arrestsWrongful: 1,
        assetsLost: 2,
      }),
      { factions: { security: 10, operations: 20 } },
      weights,
    );
    expect(weights.outcome.success).toBe(4);
    expect(score).toBe(4 + 0.1 * 20 + 2 - 2 - 3 - 2 * 2 + 30 / 10);
    expect(
      careerScore(input({ outcome: 'failure-burned' }), { factions: {} }, weights),
    ).toBe(weights.outcome['failure-burned']);
  });

  it('awards the rounded score and never a negative point total', () => {
    expect(careerPointsAward(2)).toBe(2);
    expect(careerPointsAward(1.5)).toBe(2);
    expect(careerPointsAward(-1.5)).toBe(0);
    expect(accumulateStanding(1, 5)).toBe(6);
    expect(accumulateStanding(1, 5, 4)).toBe(10);
  });

  it('promotes, holds, demotes, reprimands and dismisses from the rank table', () => {
    const officer = { rank: 'case-officer' as const, reprimands: 0, careerStanding: 0 };
    expect(decision(6, officer)).toBe('promote');
    expect(decision(5.9, officer)).toBe('hold');
    expect(decision(-4, officer)).toBe('hold');
    expect(decision(-4.01, officer)).toBe('reprimand');
    expect(decision(-3.01, { ...officer, rank: 'senior-case-officer' })).toBe('demote');
    expect(decision(100, { ...officer, rank: 'controller' })).toBe('hold');
    expect(decision(-0.01, { ...officer, rank: 'controller' })).toBe('demote');
    expect(decision(100, { ...officer, reprimands: 3 })).toBe('dismiss');
    expect(decision(6, { ...officer, careerStanding: floor })).toBe('promote');
    expect(decision(6, { ...officer, careerStanding: floor - 0.01 })).toBe('dismiss');
    expect(
      reviewDecision(6, { ...officer, rank: 'admiral' as Officer['rank'] }, content.ranks, floor).ok,
    ).toBe(false);
  });

  it('moves one rank, counts a reprimand, and renders the review cable', () => {
    const reviewed = applyReview(
      {
        name: 'Ada',
        rank: 'case-officer',
        reprimands: 0,
        careerStanding: 0,
        careerPoints: 4,
        factions: {},
      },
      6,
      0,
      content.ranks,
      content.texts,
      floor,
    );
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) {
      return;
    }
    expect(reviewed.value.rank).toBe('senior-case-officer');
    expect(reviewed.value.careerPoints).toBe(10);
    expect(reviewed.value.cable).toEqual({
      title: 'Review board',
      body: 'The board records Ada at the rank of case-officer. The score for this posting is 6.',
    });

    const demoted = applyReview(
      {
        name: 'Ada',
        rank: 'senior-case-officer',
        reprimands: 0,
        careerStanding: 0,
        careerPoints: 0,
        factions: {},
      },
      -4,
      0,
      content.ranks,
      content.texts,
      floor,
    );
    expect(demoted.ok && demoted.value.decision).toBe('demote');
    expect(demoted.ok && demoted.value.rank).toBe('case-officer');

    const reprimand = applyReview(
      {
        name: 'Ada',
        rank: 'case-officer',
        reprimands: 2,
        careerStanding: 0,
        careerPoints: 0,
        factions: {},
      },
      -5,
      0,
      content.ranks,
      content.texts,
      floor,
    );
    expect(reprimand.ok && reprimand.value.reprimands).toBe(3);
    expect(reprimand.ok && reprimand.value.rank).toBe('case-officer');

    const dismissed = applyReview(
      {
        name: 'Ada',
        rank: 'chief-of-station',
        reprimands: 0,
        careerStanding: 0,
        careerPoints: 1,
        factions: {},
      },
      12,
      -10,
      content.ranks,
      content.texts,
      floor,
    );
    expect(dismissed.ok && dismissed.value.decision).toBe('dismiss');
    expect(dismissed.ok && dismissed.value.careerStanding).toBe(-10);
    expect(dismissed.ok && dismissed.value.rank).toBe('chief-of-station');

    const stayed = applyReview(
      {
        name: 'Ada',
        rank: 'controller',
        reprimands: 0,
        careerStanding: 0,
        careerPoints: 0,
        factions: {},
      },
      20,
      0,
      content.ranks,
      content.texts,
      floor,
    );
    expect(stayed.ok && stayed.value.decision).toBe('hold');
    expect(stayed.ok && stayed.value.rank).toBe('controller');

    expect(applyReview(
      {
        name: 'Ada',
        rank: 'case-officer',
        reprimands: 0,
        careerStanding: 0,
        careerPoints: 0,
        factions: {},
      },
      6,
      0,
      content.ranks,
      [],
      floor,
    ).ok).toBe(false);

    expect(renderTemplate({ title: 'Note', body: 'Keep {unknown}.' }, { name: 'Ada' })).toEqual({
      title: 'Note',
      body: 'Keep {unknown}.',
    });
  });
});
