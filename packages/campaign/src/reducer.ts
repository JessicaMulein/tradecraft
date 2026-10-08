/**
 * Campaign reducer (design, "Campaign reducer"; Requirements 1.1–1.4, 2.3, 2.5, 16.1).
 *
 * `quoteChoice` and `step` are pure for a choice that already names its seed.
 * Minting a missing seed is the one read of entropy, and the logged choice
 * carries the seed that was used, so a replay never mints again.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '@tradecraft/content';
import {
  asTruth,
  createPrng,
  randomSeed,
  type Prng,
  type Result,
} from '@tradecraft/engine';

import { initArcs } from './arcs.js';
import { carryOver } from './carry-over.js';
import type { CampaignConfig } from './config.js';
import { applyAssetDecision, quoteAssetDecision } from './assets.js';
import type { CampaignContent } from './content/library.js';
import {
  applyCaptureStep,
  applyEndOffer,
  quoteCaptureStep,
  quoteEndOffer,
  type EndingOptions,
} from './endings.js';
import {
  applyAcceptOffer,
  applyArcs,
  applyDebrief,
  applyDepart,
  applyReviewStep,
  quoteAcceptOffer,
  quoteAdvance,
  quoteArcs,
  quoteDepart,
  quoteReview,
  redrawOffers,
} from './hq.js';
import { makeOffers } from './offers.js';
import { applyPreparation, quotePreparation } from './prepare.js';
import type { Background, HqCastTemplate } from './content/schemas.js';
import { campaignStream } from './seed.js';
import type {
  CampaignChoice,
  CampaignLogEntry,
  CampaignPersonId,
  CampaignState,
  CampaignTruth,
  HqFigure,
  HqStep,
  PostingResult,
  SkillLevel,
} from './state.js';

const START_YEAR_MIN = 1948;
const START_YEAR_MAX = 1950;

export interface ChoiceQuote {
  readonly allowed: boolean;
  readonly reason: string;
  readonly cost: number;
}

export interface CampaignError {
  readonly kind: 'rejected';
  readonly reason: string;
}

export type CampaignInput =
  | { readonly kind: 'choice'; readonly choice: CampaignChoice }
  | {
      readonly kind: 'posting-result';
      readonly index: number;
      readonly result: PostingResult;
      /** Slice action log, kept on the campaign log for replay. */
      readonly actions?: string;
      /** Recorded model responses, kept on the campaign log for replay. */
      readonly recording?: string;
    };

interface StepHandler {
  readonly quote: (
    state: CampaignState | undefined,
    choice: CampaignChoice,
    content: CampaignContent,
  ) => ChoiceQuote;
  readonly apply: (
    state: CampaignState | undefined,
    choice: CampaignChoice,
    content: CampaignContent,
  ) => CampaignState;
}

const unavailable = (step: string): ChoiceQuote => ({
  allowed: false,
  reason: `That choice is not available during ${step}.`,
  cost: 0,
});

function rejectApply(): CampaignState {
  throw new Error('step handler applied a choice quoteChoice rejected');
}

function quoteCreation(
  _state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): ChoiceQuote {
  if (choice.kind !== 'create') {
    return unavailable('creation');
  }
  if (choice.officerName.length === 0) {
    return { allowed: false, reason: 'Name the officer.', cost: 0 };
  }
  if (
    !Number.isInteger(choice.startYear) ||
    choice.startYear < START_YEAR_MIN ||
    choice.startYear > START_YEAR_MAX
  ) {
    return {
      allowed: false,
      reason: 'The start year must be from 1948 to 1950.',
      cost: 0,
    };
  }
  if (choice.seed === '') {
    return { allowed: false, reason: 'The campaign seed must not be empty.', cost: 0 };
  }
  if (findBackground(content, choice.background) === undefined) {
    return { allowed: false, reason: 'That background is not available.', cost: 0 };
  }
  if (resolvePreset(content, choice.preset) === undefined) {
    return { allowed: false, reason: 'That difficulty is not available.', cost: 0 };
  }
  if (content.hqCast.length === 0) {
    return { allowed: false, reason: 'Headquarters has no staff to assign.', cost: 0 };
  }
  return { allowed: true, reason: '', cost: 0 };
}

/**
 * Draw the HQ cast and the mole. Shuffle, then take 5–7 figures when the
 * catalogue is that large, then pick the mole. All draws come from `rng`,
 * which creation builds from the campaign stream.
 */
export function selectHqCast(
  templates: readonly HqCastTemplate[],
  rng: Prng,
): { readonly cast: readonly HqCastTemplate[]; readonly mole: number } {
  const shuffled = rng.shuffle(templates);
  const count =
    shuffled.length >= 5 ? rng.int(5, Math.min(7, shuffled.length)) : shuffled.length;
  const cast = shuffled.slice(0, count);
  const mole = cast.length === 0 ? 0 : rng.int(0, cast.length - 1);
  return { cast, mole };
}

function applyCreation(
  _state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): CampaignState {
  if (choice.kind !== 'create' || choice.seed === undefined) {
    return rejectApply();
  }
  const background = findBackground(content, choice.background);
  const preset = resolvePreset(content, choice.preset);
  if (background === undefined || preset === undefined) {
    return rejectApply();
  }
  const rng = createPrng(campaignStream(choice.seed));
  const drawn = selectHqCast(content.hqCast, rng);
  const figures: HqFigure[] = drawn.cast.map((template, index) => ({
    id: personId(index + 1),
    template: template.id,
    access: template.access,
  }));
  const mole = figures[drawn.mole];
  if (mole === undefined) {
    return rejectApply();
  }
  const bound = initArcs(
    content.arcs,
    { mole: mole.id, hostiles: [], nextPerson: figures.length + 1 },
    rng,
  );
  const truth: CampaignTruth = {
    dossiers: {},
    carriedHostiles: [],
    hqMole: mole.id,
    ...(bound.nemesis === undefined ? {} : { nemesis: bound.nemesis }),
    hqFigures: figures,
    cities: {},
    stagedAssets: [],
    brought: [],
    arcs: bound.arcs,
    unkMap: {},
    tensionByYear: {},
    archive: [],
  };
  const draft: CampaignState = {
    schema: 1,
    id: choice.seed,
    seed: choice.seed,
    preset,
    manifests: [content.set.manifest],
    calendar: { year: choice.startYear },
    postings: 0,
    step: { kind: 'offers' },
    view: {
      officer: {
        name: choice.officerName,
        background: background.id,
        rank: background.rank,
        skills: officerSkills(background),
        traits: [...background.traits],
        stress: 0,
        reprimands: 0,
        legends: [],
        careerStanding: 0,
        careerPoints: 0,
        factions: { ...background.factions },
      },
      offers: [],
      pendingRequisitions: [],
      staged: { assets: [], endOffers: [] },
      hqCast: figures.map((figure, index) => {
        const template = drawn.cast[index];
        return {
          id: figure.id,
          name: template?.name ?? figure.template,
          faction: template?.faction ?? '',
          role: template?.role ?? '',
        };
      }),
      arcs: bound.view,
      unk: {},
    },
    truth: asTruth(truth),
    archive: { visible: [] },
    rng: rng.state(),
    log: [],
  };
  const offers = makeOffers(draft, content, rng, { atCreation: true });
  return { ...draft, rng: rng.state(), view: { ...draft.view, offers } };
}

function quotePrepare(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): ChoiceQuote {
  if (state === undefined) {
    return unavailable('prepare');
  }
  if (choice.kind === 'advance') {
    return quoteDepart(state, choice);
  }
  return quotePreparation(state, choice, content);
}

function quoteAssets(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): ChoiceQuote {
  if (state === undefined) {
    return unavailable('assets');
  }
  return quoteAssetDecision(state, choice, content);
}

function applyAssets(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  const decided = applyAssetDecision(state, choice, content, { handoverBonus: 2 });
  if (!decided.ok) {
    return rejectApply();
  }
  return decided.value;
}

function applyPrepare(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  if (choice.kind === 'advance') {
    return applyDepart(state);
  }
  const prepared = applyPreparation(state, choice, content, { leaveRelief: 25 });
  if (!prepared.ok) {
    return rejectApply();
  }
  return prepared.value;
}

function quoteOffers(state: CampaignState | undefined, choice: CampaignChoice): ChoiceQuote {
  if (state === undefined) {
    return unavailable('offers');
  }
  return quoteAcceptOffer(state, choice);
}

function applyOffers(
  state: CampaignState | undefined,
  choice: CampaignChoice,
): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  return applyAcceptOffer(state, choice);
}

function quoteDebrief(state: CampaignState | undefined, choice: CampaignChoice): ChoiceQuote {
  if (state === undefined) {
    return unavailable('debrief');
  }
  return quoteAdvance(choice, 'debrief');
}

function applyDebriefStep(state: CampaignState | undefined): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  return applyDebrief(state);
}

function quoteReviewStep(state: CampaignState | undefined, choice: CampaignChoice): ChoiceQuote {
  if (state === undefined) {
    return unavailable('review');
  }
  return quoteReview(state, choice);
}

function applyReviewChoice(state: CampaignState | undefined): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  return applyReviewStep(state, ENDING.archiveReveal);
}

function quoteArcStep(
  state: CampaignState | undefined,
  choice: CampaignChoice,
): ChoiceQuote {
  if (state === undefined) {
    return unavailable('arcs');
  }
  return quoteArcs(state, choice);
}

function applyArcStep(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  const moved = applyArcs(state, choice, content);
  if (!moved.ok) {
    return rejectApply();
  }
  return moved.value;
}

const STEP_HANDLERS: Record<HqStep['kind'], StepHandler> = {
  creation: { quote: quoteCreation, apply: applyCreation },
  offers: {
    quote: quoteOffers,
    apply: applyOffers,
  },
  prepare: {
    quote: quotePrepare,
    apply: applyPrepare,
  },
  debrief: {
    quote: quoteDebrief,
    apply: applyDebriefStep,
  },
  review: {
    quote: quoteReviewStep,
    apply: applyReviewChoice,
  },
  capture: {
    quote: quoteCapture,
    apply: applyCaptureChoice,
  },
  assets: {
    quote: quoteAssets,
    apply: applyAssets,
  },
  arcs: {
    quote: quoteArcStep,
    apply: applyArcStep,
  },
  'end-offers': {
    quote: quoteEndOffers,
    apply: applyEndOffers,
  },
};

/** Shipped `config/campaign.yaml` capture odds, stress, and archive reveal. */
const ENDING: EndingOptions = {
  capture: { deathBase: 0.2, deathMin: 0.02, deathMax: 0.5 },
  burned: 20,
  captureStress: 40,
  archiveReveal: 'at-end',
};

function quoteCapture(
  state: CampaignState | undefined,
  choice: CampaignChoice,
): ChoiceQuote {
  if (state === undefined) {
    return unavailable('capture');
  }
  return quoteCaptureStep(state, choice);
}

function applyCaptureChoice(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  const captured = applyCaptureStep(state, choice, content, ENDING);
  if (!captured.ok) {
    return rejectApply();
  }
  return captured.value;
}

function quoteEndOffers(
  state: CampaignState | undefined,
  choice: CampaignChoice,
): ChoiceQuote {
  if (state === undefined) {
    return unavailable('end-offers');
  }
  return quoteEndOffer(state, choice);
}

function applyEndOffers(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): CampaignState {
  if (state === undefined) {
    return rejectApply();
  }
  const closed = applyEndOffer(state, choice, ENDING);
  if (!closed.ok) {
    return rejectApply();
  }
  return redrawOffers(closed.value, content);
}

function stepKind(state: CampaignState | undefined): HqStep['kind'] | 'posting' | 'ended' {
  return state?.step.kind ?? 'creation';
}

/** Whether `choice` is legal in `state`. Does not draw and does not mint a seed. */
export function quoteChoice(
  state: CampaignState | undefined,
  choice: CampaignChoice,
  content: CampaignContent,
): ChoiceQuote {
  const kind = stepKind(state);
  if (kind === 'ended') {
    return { allowed: false, reason: 'The career has ended.', cost: 0 };
  }
  if (kind === 'posting') {
    return { allowed: false, reason: 'A posting is in progress.', cost: 0 };
  }
  return STEP_HANDLERS[kind].quote(state, choice, content);
}

/**
 * Fold one input into a new campaign state. A rejected choice returns an error
 * and does not modify `state`. An accepted choice appends one log entry.
 */
export function step(
  state: CampaignState | undefined,
  input: CampaignInput,
  content: CampaignContent,
  config?: CampaignConfig,
): Result<CampaignState, CampaignError> {
  if (input.kind === 'posting-result') {
    return foldPosting(state, input, content, config);
  }
  const quote = quoteChoice(state, input.choice, content);
  if (!quote.allowed) {
    return { ok: false, error: { kind: 'rejected', reason: quote.reason } };
  }
  const choice = resolveSeed(input.choice);
  const kind = stepKind(state);
  if (kind === 'posting' || kind === 'ended') {
    return { ok: false, error: { kind: 'rejected', reason: quote.reason } };
  }
  const next = STEP_HANDLERS[kind].apply(state, choice, content);
  return { ok: true, value: appendChoice(next, choice) };
}

function foldPosting(
  state: CampaignState | undefined,
  input: Extract<CampaignInput, { kind: 'posting-result' }>,
  content: CampaignContent,
  config: CampaignConfig | undefined,
): Result<CampaignState, CampaignError> {
  if (state === undefined || state.step.kind !== 'posting') {
    return {
      ok: false,
      error: {
        kind: 'rejected',
        reason: 'A posting result is only accepted while a posting is in progress.',
      },
    };
  }
  if (state.step.ctx.index !== input.index) {
    return {
      ok: false,
      error: { kind: 'rejected', reason: 'That posting result is for a different posting.' },
    };
  }
  if (config === undefined) {
    return {
      ok: false,
      error: { kind: 'rejected', reason: 'Campaign config is required to fold a posting.' },
    };
  }
  const folded = carryOver(state, input.result, content, config);
  if (!folded.ok) {
    return { ok: false, error: { kind: 'rejected', reason: folded.error.paths.join(', ') } };
  }
  const manifest = state.manifests[state.manifests.length - 1];
  if (manifest === undefined) {
    return { ok: false, error: { kind: 'rejected', reason: 'The campaign has no content manifest.' } };
  }
  const entry: CampaignLogEntry = {
    seq: folded.value.log.length + 1,
    kind: 'posting',
    index: input.index,
    seed: state.step.ctx.seed,
    manifest,
    actions: input.actions ?? '',
    recording: input.recording ?? '',
    // Same digest as postingResultHash. replay.ts calls step, so this stays local.
    resultHash: createHash('sha256').update(canonicalJson(input.result)).digest('hex'),
  };
  return { ok: true, value: { ...folded.value, log: [...folded.value.log, entry] } };
}

function resolveSeed(choice: CampaignChoice): CampaignChoice {
  if (choice.kind === 'create' && choice.seed === undefined) {
    return { ...choice, seed: randomSeed() };
  }
  return choice;
}

function appendChoice(state: CampaignState, choice: CampaignChoice): CampaignState {
  const entry: CampaignLogEntry = {
    seq: state.log.length + 1,
    kind: 'choice',
    choice,
  };
  return { ...state, log: [...state.log, entry] };
}

function personId(n: number): CampaignPersonId {
  return `cp-${n}`;
}

function asLevel(level: number): SkillLevel {
  if (level === 0 || level === 1 || level === 2 || level === 3 || level === 4 || level === 5) {
    return level;
  }
  return 0;
}

function officerSkills(background: Background): CampaignState['view']['officer']['skills'] {
  const skills: Record<string, { readonly level: SkillLevel; readonly xp: number }> = {};
  for (const [id, level] of Object.entries(background.skills)) {
    skills[id] = { level: asLevel(level), xp: 0 };
  }
  for (const language of background.languages) {
    if (skills[language] === undefined) {
      skills[language] = { level: 1, xp: 0 };
    }
  }
  return skills;
}

function findBackground(content: CampaignContent, id: string): Background | undefined {
  return content.backgrounds.find(
    (background) => background.id === id || id.endsWith(`/${background.id}`),
  );
}

function resolvePreset(content: CampaignContent, preset: string): string | undefined {
  if (content.set.difficultyPresets.has(preset)) {
    return preset;
  }
  for (const id of content.set.difficultyPresets.keys()) {
    if (id.endsWith(`/${preset}`)) {
      return id;
    }
  }
  return undefined;
}
