/**
 * Review Board (design, "Review Board"; Requirements 8.1–8.6).
 *
 * The career score uses the content weights. A high score promotes one rank,
 * up to Controller. A score under the rank's floor demotes one rank, or issues
 * a reprimand when the officer is already a Case Officer. Three reprimands, or
 * Career Standing under the dismissal floor, dismisses. Career Points are the
 * rounded score, and never negative. Standing adds this posting's Standing and
 * any handover bonus. The decision Cable fills the review template.
 */

import type { Result } from '@tradecraft/engine';

import { RANKS, type CampaignText, type RankId, type RankRow, type ReviewWeights } from './content/schemas.js';
import type { Officer } from './state.js';

export type ReviewDecision = 'promote' | 'hold' | 'demote' | 'reprimand' | 'dismiss';

/** The posting facts the score reads. Assets lost are not on the Outcome Record. */
export interface CareerScoreInput {
  readonly outcome: 'success' | 'failure-plot' | 'failure-burned';
  readonly standing: number;
  readonly directives: readonly { readonly status: 'open' | 'met' | 'failed' }[];
  readonly arrestsWrongful: number;
  readonly assetsLost: number;
}

export interface ReviewResult {
  readonly score: number;
  readonly decision: ReviewDecision;
  readonly rank: RankId;
  readonly reprimands: number;
  readonly careerPoints: number;
  readonly careerStanding: number;
  readonly cable: { readonly title: string; readonly body: string };
}

/** Weighted posting outcome, standing, directives, arrests, losses and factions. */
export function careerScore(
  input: CareerScoreInput,
  officer: Pick<Officer, 'factions'>,
  weights: ReviewWeights,
): number {
  let met = 0;
  let failed = 0;
  for (const directive of input.directives) {
    if (directive.status === 'met') {
      met += 1;
    } else if (directive.status === 'failed') {
      failed += 1;
    }
  }
  let factionSum = 0;
  for (const value of Object.values(officer.factions)) {
    factionSum += value;
  }
  return (
    weights.outcome[input.outcome] +
    weights.standing * input.standing +
    weights.directiveMet * met -
    weights.directiveFailed * failed -
    weights.wrongful * input.arrestsWrongful -
    weights.assetLost * input.assetsLost +
    weights.faction * (factionSum / 10)
  );
}

/** Promotion, demotion, reprimand or dismissal for one score. */
export function reviewDecision(
  score: number,
  officer: Pick<Officer, 'rank' | 'reprimands' | 'careerStanding'>,
  ranks: readonly RankRow[],
  dismissalFloor: number,
): Result<ReviewDecision, string> {
  if (officer.reprimands >= 3 || officer.careerStanding < dismissalFloor) {
    return { ok: true, value: 'dismiss' };
  }
  const row = ranks.find((rank) => rank.id === officer.rank);
  if (row === undefined) {
    return { ok: false, error: `unknown rank "${officer.rank}"` };
  }
  if (row.promoteAt !== undefined && score >= row.promoteAt) {
    return { ok: true, value: 'promote' };
  }
  if (score < row.demoteBelow) {
    return { ok: true, value: officer.rank === 'case-officer' ? 'reprimand' : 'demote' };
  }
  return { ok: true, value: 'hold' };
}

/** Career Points from a score: the rounded score, and never below zero. */
export function careerPointsAward(score: number): number {
  return Math.max(0, Math.round(score));
}

/** Posting Standing, plus a handover bonus, added to the career total. */
export function accumulateStanding(
  careerStanding: number,
  postingStanding: number,
  handoverBonus = 0,
): number {
  return careerStanding + postingStanding + handoverBonus;
}

/** Fill `{tokens}` in a campaign text template. Unknown tokens stay as written. */
export function renderTemplate(
  template: Pick<CampaignText, 'title' | 'body'>,
  fields: Readonly<Record<string, string | number>>,
): { readonly title: string; readonly body: string } {
  return { title: fill(template.title, fields), body: fill(template.body, fields) };
}

/** The review-board Cable for this officer and score. */
export function reviewCable(
  texts: readonly CampaignText[],
  fields: { readonly name: string; readonly rank: string; readonly score: number },
): Result<{ readonly title: string; readonly body: string }, string> {
  const template = texts.find((text) => text.use === 'review');
  if (template === undefined) {
    return { ok: false, error: 'no review cable template' };
  }
  return { ok: true, value: renderTemplate(template, fields) };
}

/**
 * Apply one review. Standing is accumulated first, so a posting that drops
 * Career Standing under the floor dismisses on this review. A reprimand adds
 * one; dismissal does not add another.
 */
export function applyReview(
  officer: Pick<Officer, 'name' | 'rank' | 'reprimands' | 'careerStanding' | 'careerPoints' | 'factions'>,
  score: number,
  postingStanding: number,
  ranks: readonly RankRow[],
  texts: readonly CampaignText[],
  dismissalFloor: number,
  handoverBonus = 0,
): Result<ReviewResult, string> {
  const careerStanding = accumulateStanding(officer.careerStanding, postingStanding, handoverBonus);
  const decided = reviewDecision(score, { ...officer, careerStanding }, ranks, dismissalFloor);
  if (!decided.ok) {
    return decided;
  }
  const cable = reviewCable(texts, { name: officer.name, rank: officer.rank, score });
  if (!cable.ok) {
    return cable;
  }
  const decision = decided.value;
  return {
    ok: true,
    value: {
      score,
      decision,
      rank: nextRank(officer.rank, decision),
      reprimands: decision === 'reprimand' ? officer.reprimands + 1 : officer.reprimands,
      careerPoints: officer.careerPoints + careerPointsAward(score),
      careerStanding,
      cable: cable.value,
    },
  };
}

/**
 * Apply a staged review. Career Standing was added when the posting folded.
 * This records the rank, the reprimand and the Career Points.
 */
export function commitReview(
  officer: Officer,
  review: { readonly score: number; readonly decision: ReviewDecision },
): Officer {
  return {
    ...officer,
    rank: nextRank(officer.rank, review.decision),
    reprimands: review.decision === 'reprimand' ? officer.reprimands + 1 : officer.reprimands,
    careerPoints: officer.careerPoints + careerPointsAward(review.score),
  };
}

function nextRank(rank: RankId, decision: ReviewDecision): RankId {
  const index = RANKS.indexOf(rank);
  if (decision === 'promote') {
    return RANKS[Math.min(RANKS.length - 1, index + 1)] ?? rank;
  }
  if (decision === 'demote') {
    return RANKS[Math.max(0, index - 1)] ?? rank;
  }
  return rank;
}

function fill(text: string, fields: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (token, key: string) => {
    const value = fields[key];
    return value === undefined ? token : String(value);
  });
}
