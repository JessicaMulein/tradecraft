/**
 * Property 21: a career is ended exactly when a death capture, a dismissal,
 * an accepted retirement after three postings, an accepted defection, or a
 * calendar past 1962 has occurred. Once ended, that ending stays put.
 * The capture draw is deterministic.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrng } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { applyCapture, closeCampaign, endTrigger, ERA_LAST_YEAR, resolveBurn, resolveCapture } from './endings.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignEnd, CampaignState, ReviewOutcomeView } from './state.js';

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
const options = {
  capture: config.value.capture,
  burned: config.value.stress.burned,
  captureStress: config.value.stress.capture,
  archiveReveal: config.value.archiveReveal,
};

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

const REVIEWS = ['dismiss', 'hold', 'promote', 'demote', 'reprimand'] as const;

type Move =
  | { readonly kind: 'calendar'; readonly year: number }
  | { readonly kind: 'review'; readonly decision: (typeof REVIEWS)[number] }
  | { readonly kind: 'postings'; readonly n: number }
  | { readonly kind: 'offer-defection' }
  | { readonly kind: 'retire' }
  | { readonly kind: 'defect' }
  | { readonly kind: 'decline' }
  | { readonly kind: 'capture'; readonly tension: number }
  | { readonly kind: 'expel' };

const moveArb: fc.Arbitrary<Move> = fc.oneof(
  fc.record({
    kind: fc.constant('calendar' as const),
    year: fc.integer({ min: 1948, max: 1980 }),
  }),
  fc.record({
    kind: fc.constant('review' as const),
    decision: fc.constantFrom(...REVIEWS),
  }),
  fc.record({
    kind: fc.constant('postings' as const),
    n: fc.integer({ min: 0, max: 6 }),
  }),
  fc.constant({ kind: 'offer-defection' as const }),
  fc.constant({ kind: 'retire' as const }),
  fc.constant({ kind: 'defect' as const }),
  fc.constant({ kind: 'decline' as const }),
  fc.record({
    kind: fc.constant('capture' as const),
    tension: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  fc.constant({ kind: 'expel' as const }),
);

/** The triggers in Property 21. Retirement counts only after three postings. */
function triggerOccurred(state: CampaignState): boolean {
  if (state.view.staged.capture?.kind === 'death') {
    return true;
  }
  if (state.view.staged.review?.decision === 'dismiss') {
    return true;
  }
  if (state.view.acceptedEnd === 'defect') {
    return true;
  }
  if (state.view.acceptedEnd === 'retire' && state.postings >= 3) {
    return true;
  }
  return state.calendar.year > ERA_LAST_YEAR;
}

function expectSound(state: CampaignState): void {
  const triggered = triggerOccurred(state);
  expect(state.step.kind === 'ended').toBe(triggered);
  expect(endTrigger(state) === null).toBe(!triggered);
  if (state.step.kind !== 'ended') {
    return;
  }
  const end: CampaignEnd = state.step.end;
  if (end.kind === 'death') {
    expect(state.view.staged.capture?.kind).toBe('death');
  }
  if (end.kind === 'disgrace') {
    expect(state.view.staged.review?.decision).toBe('dismiss');
  }
  if (end.kind === 'defection') {
    expect(state.view.acceptedEnd).toBe('defect');
  }
  if (end.kind === 'retirement') {
    const accepted = state.view.acceptedEnd === 'retire' && state.postings >= 3;
    expect(accepted || state.calendar.year > ERA_LAST_YEAR).toBe(true);
  }
  expect(closeCampaign(state, options.archiveReveal).step).toEqual(state.step);
}

function atEndOffers(state: CampaignState): CampaignState {
  return { ...state, step: { kind: 'end-offers' } };
}

function choose(state: CampaignState, choice: CampaignChoice): CampaignState {
  const ready = atEndOffers(state);
  const before = JSON.stringify(ready);
  const result = step(ready, { kind: 'choice', choice }, content);
  if (!result.ok) {
    expect(JSON.stringify(ready)).toBe(before);
    return ready;
  }
  return result.value;
}

function applyMove(state: CampaignState, move: Move): CampaignState {
  if (move.kind === 'calendar') {
    return closeCampaign({ ...state, calendar: { year: move.year } }, options.archiveReveal);
  }
  if (move.kind === 'review') {
    const review: ReviewOutcomeView = { score: 0, decision: move.decision, text: 'The board has spoken.' };
    return closeCampaign(
      { ...state, view: { ...state.view, staged: { ...state.view.staged, review } } },
      options.archiveReveal,
    );
  }
  if (move.kind === 'postings') {
    return closeCampaign({ ...state, postings: move.n }, options.archiveReveal);
  }
  if (move.kind === 'offer-defection') {
    const endOffers = state.view.staged.endOffers.includes('defect')
      ? state.view.staged.endOffers
      : [...state.view.staged.endOffers, 'defect' as const];
    return closeCampaign(
      { ...state, view: { ...state.view, staged: { ...state.view.staged, endOffers } } },
      options.archiveReveal,
    );
  }
  if (move.kind === 'retire') {
    return choose(state, { kind: 'retire' });
  }
  if (move.kind === 'defect') {
    return choose(state, { kind: 'defect' });
  }
  if (move.kind === 'decline') {
    return choose(state, { kind: 'decline-end-offer' });
  }
  if (move.kind === 'capture') {
    return applyCapture(state, move.tension, content, options);
  }
  return resolveBurn(
    state,
    { blown: true, official: true, legend: 'lg-1', service: 'svc-east', tension: 0.5 },
    content,
    options,
  );
}

describe('campaign end soundness property', () => {
  it('ends exactly on a listed trigger, keeps that ending, and draws one capture twice', () => {
    // Feature: campaign-career, Property 21: Campaign End soundness
    fc.assert(
      fc.property(
        fc.array(moveArb, { maxLength: 8 }),
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        fc.integer({ min: 0, max: 1_000_000 }),
        (moves, standing, tension, strained, seed) => {
          let state = base;
          expectSound(state);
          let frozen: CampaignEnd | undefined;
          for (const move of moves) {
            if (state.step.kind === 'ended') {
              const before = JSON.stringify(state);
              const rejected = step(state, { kind: 'choice', choice: { kind: 'advance' } }, content);
              expect(rejected.ok).toBe(false);
              expect(JSON.stringify(state)).toBe(before);
              expect(state.step.end).toEqual(frozen);
              continue;
            }
            state = applyMove(state, move);
            expectSound(state);
            if (state.step.kind === 'ended') {
              frozen = frozen ?? state.step.end;
              expect(state.step.end).toEqual(frozen);
            }
          }

          const officer = { ...base.view.officer, careerStanding: standing, traits: strained ? ['strained'] : [] };
          const before = JSON.stringify(officer);
          const first = resolveCapture(officer, tension, options.capture, createPrng(String(seed)));
          const second = resolveCapture(officer, tension, options.capture, createPrng(String(seed)));
          expect(second).toEqual(first);
          expect(JSON.stringify(officer)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
