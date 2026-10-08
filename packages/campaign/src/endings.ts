/**
 * Captures and campaign end (design, "Captures and Campaign End";
 * Requirements 17.6, 19.1–19.7, 7.4).
 *
 * A burn under official cover is an expulsion: the legend is marked burned to
 * that service, stress rises, and the career stays in the HQ phase. A burn
 * under non-official cover draws a capture from the campaign stream.
 *
 * Death chance, before the config clamp, is
 * `deathBase × (0.5 + tension) − 0.02 × careerStanding`, plus 0.05 while the
 * officer is strained. The rest of the draw is an exchange (one year, no
 * defection offer) or imprisonment (1–3 years, defection offered). Exchange
 * becomes more likely as standing rises, and less likely while strained.
 *
 * `endTrigger` is the only place that decides the career has ended. Closing
 * copies the truth archive into `archive.reveal` unless the mode is `never`.
 */

import { asTruth, createPrng, type Prng, type Result } from '@tradecraft/engine';

import type { CampaignContent } from './content/library.js';
import { applyStress, applyTraitTriggers, type CareerEvents } from './progress.js';
import type {
  ArchiveReveal,
  CampaignChoice,
  CampaignEnd,
  CampaignState,
  CaptureView,
  HostileDossier,
  LegendId,
  Officer,
  ServiceId,
} from './state.js';

/** The last year of the era. The next calendar year ends the career. */
export const ERA_LAST_YEAR = 1962;

/** Retirement is offered once this many postings are complete. */
export const RETIREMENT_POSTINGS = 3;

/** Added to the death chance, before the clamp, while the officer is strained. */
export const STRAINED_DEATH = 0.05;

/** Subtracted from the exchange weight, before the clamp, while strained. */
export const STRAINED_EXCHANGE = 0.1;

export interface CaptureOdds {
  readonly deathBase: number;
  readonly deathMin: number;
  readonly deathMax: number;
}

export interface EndingOptions {
  readonly capture: CaptureOdds;
  readonly burned: number;
  readonly captureStress: number;
  readonly archiveReveal: 'at-end' | 'never';
}

export interface BurnFacts {
  readonly blown: boolean;
  readonly official: boolean;
  readonly legend: LegendId;
  readonly service: ServiceId;
  readonly tension: number;
}

export interface EndingQuote {
  readonly allowed: boolean;
  readonly reason: string;
  readonly cost: number;
}

const NO_CAPTURE: EndingQuote = {
  allowed: false,
  reason: 'That choice is not available during capture.',
  cost: 0,
};

const NO_END: EndingQuote = {
  allowed: false,
  reason: 'That choice is not available during end offers.',
  cost: 0,
};

/** Draw a capture. Exchange is one year; imprisonment is one to three. */
export function resolveCapture(
  officer: Officer,
  tension: number,
  odds: CaptureOdds,
  rng: Prng,
): CaptureView {
  const strained = hasTrait(officer.traits, 'strained');
  const death = clamp(
    odds.deathBase * (0.5 + tension) - 0.02 * officer.careerStanding + (strained ? STRAINED_DEATH : 0),
    odds.deathMin,
    odds.deathMax,
  );
  if (rng.next() < death) {
    return { kind: 'death' };
  }
  const exchange = clamp(
    0.5 + 0.05 * officer.careerStanding - (strained ? STRAINED_EXCHANGE : 0),
    0.1,
    0.9,
  );
  if (rng.next() < exchange) {
    return { kind: 'exchange', yearsLost: 1, defectionOffer: false };
  }
  return { kind: 'imprisonment', yearsLost: rng.int(1, 3), defectionOffer: true };
}

/**
 * Official cover: mark the legend burned, raise stress, and stay in HQ.
 * Non-official cover: draw and apply a capture.
 */
export function resolveBurn(
  state: CampaignState,
  facts: BurnFacts,
  content: CampaignContent,
  options: EndingOptions,
): CampaignState {
  if (!facts.blown) {
    return state;
  }
  if (facts.official) {
    return expel(state, facts.legend, facts.service, content, options);
  }
  return applyCapture(state, facts.tension, content, options);
}

/** Record an expulsion. The legend is burned to `service` and stress rises. */
export function expel(
  state: CampaignState,
  legend: LegendId,
  service: ServiceId,
  content: CampaignContent,
  options: EndingOptions,
): CampaignState {
  const dossier = state.truth.dossiers[service] ?? emptyDossier(service);
  const burnedLegends = dossier.burnedLegends.includes(legend)
    ? dossier.burnedLegends
    : [...dossier.burnedLegends, legend];
  const stressed = withEvents(state, { burned: true, assetArrested: false, captured: false }, options.burned, content);
  return closeCampaign(
    {
      ...stressed,
      view: {
        ...stressed.view,
        officer: {
          ...stressed.view.officer,
          legends: stressed.view.officer.legends.map((row) => {
            if (row.id !== legend || row.observedBurnedBy.includes(service)) {
              return row;
            }
            return { ...row, observedBurnedBy: [...row.observedBurnedBy, service] };
          }),
        },
      },
      truth: asTruth({
        ...stressed.truth,
        dossiers: { ...stressed.truth.dossiers, [service]: { ...dossier, burnedLegends } },
      }),
    },
    options.archiveReveal,
  );
}

/** Draw a capture on the campaign stream, then apply years, stress, or death. */
export function applyCapture(
  state: CampaignState,
  tension: number,
  content: CampaignContent,
  options: EndingOptions,
): CampaignState {
  const rng = createPrng(state.rng);
  const capture = resolveCapture(state.view.officer, tension, options.capture, rng);
  const drawn: CampaignState = {
    ...state,
    rng: rng.state(),
    view: { ...state.view, staged: { ...state.view.staged, capture } },
  };
  if (capture.kind === 'death') {
    return closeCampaign(drawn, options.archiveReveal);
  }
  const stressed = withEvents(
    drawn,
    { burned: false, assetArrested: false, captured: true },
    options.captureStress,
    content,
  );
  return closeCampaign(
    { ...stressed, calendar: { year: stressed.calendar.year + capture.yearsLost } },
    options.archiveReveal,
  );
}

/** Retirement after three postings, and defection when a capture or the staged list offers it. */
export function offeredEnds(state: CampaignState): readonly ('retire' | 'defect')[] {
  const offers: ('retire' | 'defect')[] = [];
  if (state.postings >= RETIREMENT_POSTINGS) {
    offers.push('retire');
  }
  if (defectionOffered(state)) {
    offers.push('defect');
  }
  return offers;
}

/** The end this state has earned, or null while the career continues. */
export function endTrigger(state: CampaignState): CampaignEnd | null {
  const at = { year: state.calendar.year, posting: state.postings };
  if (state.view.staged.capture?.kind === 'death') {
    return { kind: 'death', at, cause: 'Died in hostile hands.' };
  }
  if (state.view.staged.review?.decision === 'dismiss') {
    return { kind: 'disgrace', at, cause: 'Dismissed by the review board.' };
  }
  if (state.view.acceptedEnd === 'defect') {
    return { kind: 'defection', at, cause: 'Accepted a defection offer.' };
  }
  if (state.view.acceptedEnd === 'retire' && state.postings >= RETIREMENT_POSTINGS) {
    return { kind: 'retirement', at, cause: 'Retired after three postings.' };
  }
  if (state.calendar.year > ERA_LAST_YEAR) {
    return { kind: 'retirement', at, cause: 'The calendar passed 1962.' };
  }
  return null;
}

/** Set `ended` from `endTrigger`. An ended career is returned unchanged. */
export function closeCampaign(
  state: CampaignState,
  archiveReveal: EndingOptions['archiveReveal'],
): CampaignState {
  if (state.step.kind === 'ended') {
    return state;
  }
  const end = endTrigger(state);
  if (end === null) {
    return state;
  }
  return {
    ...state,
    step: { kind: 'ended', end },
    archive: {
      ...state.archive,
      reveal: archiveReveal === 'never' ? state.archive.reveal : revealOf(state),
    },
  };
}

/** Whether a capture-step choice is legal. */
export function quoteCaptureStep(state: CampaignState, choice: CampaignChoice): EndingQuote {
  if (choice.kind === 'advance') {
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.kind === 'defect') {
    if (!defectionOffered(state)) {
      return { allowed: false, reason: 'No one has offered defection.', cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  return NO_CAPTURE;
}

/** Advance reads a capture, or resolves one. Defection accepts the offer. */
export function applyCaptureStep(
  state: CampaignState,
  choice: CampaignChoice,
  content: CampaignContent,
  options: EndingOptions,
): Result<CampaignState, string> {
  const quote = quoteCaptureStep(state, choice);
  if (!quote.allowed) {
    return { ok: false, error: quote.reason };
  }
  if (choice.kind === 'defect') {
    return { ok: true, value: acceptEnd(state, 'defect', options.archiveReveal) };
  }
  if (state.view.staged.capture === undefined) {
    const tension = state.truth.tensionByYear[state.calendar.year] ?? 0.5;
    return { ok: true, value: applyCapture(state, tension, content, options) };
  }
  return {
    ok: true,
    value: closeCampaign({ ...state, step: { kind: 'assets' } }, options.archiveReveal),
  };
}

/** Whether a retirement, defection, or decline is legal. */
export function quoteEndOffer(state: CampaignState, choice: CampaignChoice): EndingQuote {
  const offers = offeredEnds(state);
  if (choice.kind === 'retire') {
    if (!offers.includes('retire')) {
      return { allowed: false, reason: 'Retirement is offered after three postings.', cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.kind === 'defect') {
    if (!offers.includes('defect')) {
      return { allowed: false, reason: 'No one has offered defection.', cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.kind === 'decline-end-offer') {
    return { allowed: true, reason: '', cost: 0 };
  }
  return NO_END;
}

/** Accept retirement or defection, or decline and return to offers. */
export function applyEndOffer(
  state: CampaignState,
  choice: CampaignChoice,
  options: Pick<EndingOptions, 'archiveReveal'>,
): Result<CampaignState, string> {
  const quote = quoteEndOffer(state, choice);
  if (!quote.allowed) {
    return { ok: false, error: quote.reason };
  }
  if (choice.kind === 'retire' || choice.kind === 'defect') {
    return { ok: true, value: acceptEnd(state, choice.kind, options.archiveReveal) };
  }
  if (choice.kind === 'decline-end-offer') {
    return {
      ok: true,
      value: closeCampaign(
        {
          ...state,
          step: { kind: 'offers' },
          view: { ...state.view, staged: { ...state.view.staged, endOffers: offeredEnds(state) } },
        },
        options.archiveReveal,
      ),
    };
  }
  return { ok: false, error: quote.reason };
}

function acceptEnd(
  state: CampaignState,
  accepted: 'retire' | 'defect',
  archiveReveal: EndingOptions['archiveReveal'],
): CampaignState {
  return closeCampaign(
    { ...state, view: { ...state.view, acceptedEnd: accepted } },
    archiveReveal,
  );
}

function defectionOffered(state: CampaignState): boolean {
  const capture = state.view.staged.capture;
  if (capture !== undefined && capture.kind !== 'death' && capture.defectionOffer) {
    return true;
  }
  return state.view.staged.endOffers.includes('defect');
}

function withEvents(
  state: CampaignState,
  events: CareerEvents,
  amount: number,
  content: CampaignContent,
): CampaignState {
  const officer = state.view.officer;
  const amounts = { burned: amount, capture: amount, assetArrested: 0 };
  const stress = applyStress(officer.stress, events, amounts);
  return {
    ...state,
    view: {
      ...state.view,
      officer: {
        ...officer,
        stress,
        traits: applyTraitTriggers(officer.traits, stress, events, content.traits),
      },
    },
  };
}

function revealOf(state: CampaignState): ArchiveReveal {
  return {
    debriefs: state.truth.archive.map((row) => row.debrief),
    hqMole: state.truth.hqMole,
    arcs: state.truth.arcs,
    dossiers: state.truth.dossiers,
  };
}

function emptyDossier(service: ServiceId): HostileDossier {
  return {
    service,
    notoriety: 0,
    descriptorKnown: false,
    burnedLegends: [],
    patterns: [],
    channelKinds: [],
    suspectedAssets: [],
    doctrineShift: {},
  };
}

function hasTrait(traits: readonly string[], id: string): boolean {
  return traits.some((trait) => trait === id || trait.endsWith(`/${id}`));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
