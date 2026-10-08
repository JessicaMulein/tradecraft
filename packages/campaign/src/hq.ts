/**
 * HQ phase transitions (design, "Campaign lifecycle"; Requirements 2.5, 5.1, 8.1, 11.1, 16.4).
 *
 * Accepting an offer moves to preparation. Departing records the posting seed
 * and starts the posting. Debrief and Review each take one advance so the
 * player can read the cable. The review advance applies the staged decision.
 * Dismissal ends the career. A non-official burn goes to capture. Anything
 * else goes to asset decisions. On the arcs step an accusation uses only
 * player-held claims. Advancing that step opens end offers. Declining those
 * offers draws the next set.
 */

import { createPrng, asTruth, type Result } from '@tradecraft/engine';

import type { CampaignContent } from './content/library.js';
import { closeCampaign, offeredEnds, type EndingOptions } from './endings.js';
import { makeOffers } from './offers.js';
import {
  ACCUSATION_REFUSAL,
  ACCUSATION_UNKNOWN,
  applyAccusation,
  quoteAccusation,
} from './molehunt.js';
import { commitReview } from './review.js';
import { postingSeed } from './seed.js';
import type {
  CampaignChoice,
  CampaignState,
  CampaignTruth,
  CarryClaim,
} from './state.js';

/** Shipped `config/campaign.yaml` mole threshold. */
export const MOLE_THRESHOLD = 3;

export interface HqQuote {
  readonly allowed: boolean;
  readonly reason: string;
  readonly cost: number;
}

const refused = (reason: string): HqQuote => ({ allowed: false, reason, cost: 0 });
const allowed: HqQuote = { allowed: true, reason: '', cost: 0 };

/** Whether this offer may be accepted. An assigned posting is the only choice. */
export function quoteAcceptOffer(state: CampaignState, choice: CampaignChoice): HqQuote {
  if (choice.kind !== 'accept-offer') {
    return refused('That choice is not available during offers.');
  }
  const offer = state.view.offers.find((row) => row.id === choice.offer);
  if (offer === undefined) {
    return refused('That posting is not on offer.');
  }
  const assigned = state.view.offers.find((row) => row.assigned);
  if (assigned !== undefined && assigned.id !== offer.id) {
    return refused('Headquarters has assigned this posting.');
  }
  return allowed;
}

/** Record the offer and open preparation. */
export function applyAcceptOffer(state: CampaignState, choice: CampaignChoice): CampaignState {
  if (choice.kind !== 'accept-offer') {
    return state;
  }
  return {
    ...state,
    step: { kind: 'prepare' },
    view: { ...state.view, chosen: choice.offer, trainingUsed: 0 },
  };
}

/** Depart once a legend has been chosen for this posting. */
export function quoteDepart(state: CampaignState, choice: CampaignChoice): HqQuote {
  if (choice.kind !== 'advance') {
    return refused('That choice is not available during prepare.');
  }
  if (state.view.chosen === undefined) {
    return refused('No posting has been accepted.');
  }
  const legend = state.view.officer.legends.some((row) => row.posting === state.postings);
  if (!legend) {
    return refused('Choose a legend before you depart.');
  }
  return allowed;
}

/** Start the posting. Its seed depends only on the campaign seed and the index. */
export function applyDepart(state: CampaignState): CampaignState {
  const index = state.postings;
  return {
    ...state,
    step: { kind: 'posting', ctx: { index, seed: postingSeed(state.seed, index) } },
  };
}

/** The debrief is read, then the review. */
export function quoteAdvance(choice: CampaignChoice, step: string): HqQuote {
  if (choice.kind !== 'advance') {
    return refused(`That choice is not available during ${step}.`);
  }
  return allowed;
}

export function applyDebrief(state: CampaignState): CampaignState {
  return { ...state, step: { kind: 'review' } };
}

/** The staged board decision has to be on the record. */
export function quoteReview(state: CampaignState, choice: CampaignChoice): HqQuote {
  if (choice.kind !== 'advance') {
    return refused('That choice is not available during review.');
  }
  if (state.view.staged.review === undefined) {
    return refused('The review board has not recorded a decision.');
  }
  return allowed;
}

/**
 * Apply the staged review. Dismissal ends the career. A burned non-official
 * legend goes to capture. Every other decision goes on to the assets.
 */
export function applyReviewStep(
  state: CampaignState,
  archiveReveal: EndingOptions['archiveReveal'],
): CampaignState {
  const review = state.view.staged.review;
  if (review === undefined) {
    return state;
  }
  const drafted: CampaignState = {
    ...state,
    view: { ...state.view, officer: commitReview(state.view.officer, review) },
  };
  if (review.decision === 'dismiss') {
    return closeCampaign(drafted, archiveReveal);
  }
  return { ...drafted, step: { kind: nonOfficialBurn(drafted) ? 'capture' : 'assets' } };
}

/** An accusation is gated on held claims. Advance opens the end offers. */
export function quoteArcs(state: CampaignState, choice: CampaignChoice): HqQuote {
  if (choice.kind === 'advance') {
    return allowed;
  }
  if (choice.kind !== 'accuse') {
    return refused('That choice is not available during arcs.');
  }
  if (!state.view.hqCast.some((figure) => figure.id === choice.figure)) {
    return refused(ACCUSATION_UNKNOWN);
  }
  const quote = quoteAccusation(heldClaims(state), choice.figure, MOLE_THRESHOLD);
  if (!quote.allowed) {
    return refused(quote.reason ?? ACCUSATION_REFUSAL);
  }
  return allowed;
}

export function applyArcs(
  state: CampaignState,
  choice: CampaignChoice,
  content: CampaignContent,
): Result<CampaignState, string> {
  if (choice.kind === 'advance') {
    return {
      ok: true,
      value: {
        ...state,
        step: { kind: 'end-offers' },
        view: {
          ...state.view,
          staged: {
            review: state.view.staged.review,
            assets: state.view.staged.assets,
            capture: state.view.staged.capture,
            endOffers: offeredEnds(state),
          },
        },
      },
    };
  }
  if (choice.kind !== 'accuse') {
    return { ok: false, error: 'That choice is not available during arcs.' };
  }
  const figure = state.view.hqCast.find((row) => row.id === choice.figure);
  const template = content.arcs.find((arc) => arc.id === 'mole-hunt' || arc.id.endsWith('/mole-hunt'));
  if (figure === undefined || template === undefined) {
    return { ok: false, error: ACCUSATION_UNKNOWN };
  }
  const accused = applyAccusation({
    officer: state.view.officer,
    figure: choice.figure,
    figureName: figure.name,
    mole: state.truth.hqMole,
    hqFigures: state.truth.hqFigures,
    hqCast: state.view.hqCast,
    arcs: state.truth.arcs,
    moleArc: template,
    claims: heldClaims(state),
    threshold: MOLE_THRESHOLD,
    texts: content.texts,
  });
  if (!accused.ok) {
    return { ok: false, error: accused.reason };
  }
  const truth: CampaignTruth = {
    ...state.truth,
    hqFigures: accused.value.hqFigures,
    arcs: accused.value.arcs,
  };
  return {
    ok: true,
    value: {
      ...state,
      view: {
        ...state.view,
        officer: accused.value.officer,
        hqCast: accused.value.hqCast,
        arcs: refreshArcStatus(state.view.arcs, truth.arcs, content),
        staged: { ...state.view.staged, accusation: { text: accused.value.cable.body } },
      },
      truth: asTruth(truth),
    },
  };
}

/** After a declined ending, draw the next 2–4 offers on the campaign stream. */
export function redrawOffers(state: CampaignState, content: CampaignContent): CampaignState {
  if (state.step.kind !== 'offers') {
    return state;
  }
  const rng = createPrng(state.rng);
  const offers = makeOffers(state, content, rng, { atCreation: false, assignmentThreshold: 0 });
  return {
    ...state,
    rng: rng.state(),
    view: {
      ...state.view,
      offers,
      chosen: undefined,
      trainingUsed: 0,
      pendingRequisitions: [],
    },
  };
}

function nonOfficialBurn(state: CampaignState): boolean {
  const last = state.archive.visible.at(-1);
  if (last === undefined || last.outcome !== 'failure-burned') {
    return false;
  }
  const legend = state.view.officer.legends.find((row) => row.id === last.legend);
  return legend?.official === false;
}

function heldClaims(state: CampaignState): readonly CarryClaim[] {
  return state.archive.visible.flatMap((entry) => entry.carry.heldClaims);
}

function refreshArcStatus(
  view: CampaignState['view']['arcs'],
  arcs: CampaignTruth['arcs'],
  content: CampaignContent,
): CampaignState['view']['arcs'] {
  return view.map((row) => {
    const template = content.arcs.find((arc) => arc.id === row.id || arc.id.endsWith(`/${row.id}`));
    const record = arcs[row.id];
    if (template === undefined || record === undefined) {
      return row;
    }
    const clues = template.resolve.filter((condition) => condition.kind === 'clue-held');
    const resolved = clues.length > 0 && clues.every((condition) => record.clues[condition.clue] === true);
    return resolved ? { ...row, status: 'resolved' as const } : row;
  });
}
