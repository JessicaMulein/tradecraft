/**
 * HQ preparation (design, "HQ preparation"; Requirements 10.1–10.6, 23.6).
 *
 * Two training slots. Training raises one skill by one level up to the rank
 * cap. Leave spends a slot and lowers stress by the configured relief, and
 * training is refused while stress is still at 100. A requisition is debited
 * only when the officer can pay; otherwise the state is unchanged. A legend
 * must be a cover the chosen city allows and not one burned to a service
 * active there. The refusal does not say which. Adopting a manifest appends
 * it for later postings.
 */

import type { ContentManifest } from '@tradecraft/content';
import type { Result } from '@tradecraft/engine';

import { coverOfficial } from './content/city-pack.js';
import type { CampaignContent } from './content/library.js';
import { applyTraitTriggers, clampStress, NO_CAREER_EVENTS, trainSkill } from './progress.js';
import type { CampaignChoice, CampaignState, LegendId, OfficerLegend } from './state.js';

export const TRAINING_SLOTS = 2;

/** Shown for a cover the city forbids or a legend burned to a service there. */
export const LEGEND_REFUSAL = 'HQ judges this legend unsafe for this city.';

export interface ChoiceQuote {
  readonly allowed: boolean;
  readonly reason: string;
  readonly cost: number;
}

export interface LegendCity {
  readonly covers: readonly string[];
  readonly services: readonly string[];
}

const NO_QUOTE: ChoiceQuote = { allowed: false, reason: 'That choice is not available during prepare.', cost: 0 };

/** Whether a prepare choice is legal. Does not modify state. */
export function quotePreparation(
  state: CampaignState,
  choice: CampaignChoice,
  content: CampaignContent,
  city: LegendCity = legendCity(state, content),
): ChoiceQuote {
  const slots = slotsLeft(state);
  if (choice.kind === 'train') {
    if (state.view.officer.stress >= 100) {
      return { allowed: false, reason: 'Medical leave comes before training.', cost: 0 };
    }
    if (slots <= 0) {
      return { allowed: false, reason: 'No training slot remains.', cost: 0 };
    }
    if (findSkill(content, choice.skill) === undefined) {
      return { allowed: false, reason: 'That skill is not available.', cost: 0 };
    }
    if (atTrainingCap(state, content, choice.skill)) {
      return { allowed: false, reason: "That skill is already at the rank's training cap.", cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.kind === 'leave') {
    if (slots <= 0) {
      return { allowed: false, reason: 'No training slot remains.', cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.kind === 'requisition') {
    const item = findRequisition(content, choice.id);
    if (item === undefined) {
      return { allowed: false, reason: 'That requisition is not available.', cost: 0 };
    }
    if (state.view.officer.careerPoints < item.cost) {
      return {
        allowed: false,
        reason: 'That requisition costs more Career Points than you hold.',
        cost: item.cost,
      };
    }
    return { allowed: true, reason: '', cost: item.cost };
  }
  if (choice.kind === 'legend') {
    if (choice.name.trim().length === 0) {
      return { allowed: false, reason: 'Name the legend.', cost: 0 };
    }
    if (state.view.chosen === undefined) {
      return { allowed: false, reason: 'Choose a posting first.', cost: 0 };
    }
    if (!coverAllowed(state, choice.cover, city)) {
      return { allowed: false, reason: LEGEND_REFUSAL, cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.kind === 'adopt-manifest') {
    return { allowed: true, reason: '', cost: 0 };
  }
  return NO_QUOTE;
}

/** Apply one prepare choice. A rejection leaves the caller holding the same state. */
export function applyPreparation(
  state: CampaignState,
  choice: CampaignChoice,
  content: CampaignContent,
  options: { readonly leaveRelief: number; readonly city?: LegendCity },
): Result<CampaignState, string> {
  const quote = quotePreparation(state, choice, content, options.city);
  if (!quote.allowed) {
    return { ok: false, error: quote.reason };
  }
  if (choice.kind === 'train') {
    return { ok: true, value: spendSlot(state, trainOfficer(state, content, choice.skill)) };
  }
  if (choice.kind === 'leave') {
    return { ok: true, value: spendSlot(state, relieve(state, content, options.leaveRelief)) };
  }
  if (choice.kind === 'requisition') {
    const item = findRequisition(content, choice.id);
    if (item === undefined) {
      return { ok: false, error: 'That requisition is not available.' };
    }
    return { ok: true, value: buy(state, item.id, item.cost) };
  }
  if (choice.kind === 'legend') {
    return { ok: true, value: addLegend(state, content, choice.cover, choice.name) };
  }
  if (choice.kind === 'adopt-manifest') {
    return { ok: true, value: adopt(state, choice.manifest) };
  }
  return { ok: false, error: NO_QUOTE.reason };
}

/** Covers and services for the chosen offer's city. */
export function legendCity(state: CampaignState, content: CampaignContent): LegendCity {
  const offer = state.view.offers.find((row) => row.id === state.view.chosen);
  for (const [id, bundle] of Object.entries(content.set.cities)) {
    if (offer !== undefined && (id === offer.city || bundle.def.id === offer.city)) {
      return {
        covers: bundle.covers.map((cover) => cover.id),
        services: [...bundle.def.services],
      };
    }
  }
  if (offer === undefined) {
    return { covers: [], services: [] };
  }
  return { covers: [], services: [offer.service] };
}

function slotsLeft(state: CampaignState): number {
  return TRAINING_SLOTS - (state.view.trainingUsed ?? 0);
}

function spendSlot(state: CampaignState, officer: CampaignState['view']['officer']): CampaignState {
  return {
    ...state,
    view: {
      ...state.view,
      trainingUsed: (state.view.trainingUsed ?? 0) + 1,
      officer,
    },
  };
}

function trainOfficer(
  state: CampaignState,
  content: CampaignContent,
  skill: string,
): CampaignState['view']['officer'] {
  const officer = state.view.officer;
  const cap = trainingCap(state, content);
  return { ...officer, skills: trainSkill(officer.skills, bare(skill), cap) };
}

function relieve(
  state: CampaignState,
  content: CampaignContent,
  leaveRelief: number,
): CampaignState['view']['officer'] {
  const officer = state.view.officer;
  const stress = clampStress(officer.stress - leaveRelief);
  return {
    ...officer,
    stress,
    traits: applyTraitTriggers(officer.traits, stress, NO_CAREER_EVENTS, content.traits),
  };
}

/** Debit a requisition or exfiltration. A short balance returns the same state. */
export function debitCareerPoints(state: CampaignState, cost: number): Result<CampaignState, string> {
  const points = state.view.officer.careerPoints;
  if (!Number.isFinite(cost) || cost < 0 || points < cost) {
    return { ok: false, error: 'That purchase costs more Career Points than you hold.' };
  }
  return {
    ok: true,
    value: {
      ...state,
      view: {
        ...state.view,
        officer: { ...state.view.officer, careerPoints: points - cost },
      },
    },
  };
}

function buy(state: CampaignState, id: string, cost: number): CampaignState {
  const paid = debitCareerPoints(state, cost);
  if (!paid.ok) {
    return state;
  }
  return {
    ...paid.value,
    view: {
      ...paid.value.view,
      pendingRequisitions: [...paid.value.view.pendingRequisitions, id],
    },
  };
}

function addLegend(
  state: CampaignState,
  content: CampaignContent,
  cover: string,
  name: string,
): CampaignState {
  const officer = state.view.officer;
  const legend: OfficerLegend = {
    id: nextLegendId(officer.legends),
    cover,
    name: name.trim(),
    official: coverIsOfficial(content, cover),
    posting: state.postings,
    observedBurnedBy: [],
  };
  return {
    ...state,
    view: { ...state.view, officer: { ...officer, legends: [...officer.legends, legend] } },
  };
}

function adopt(state: CampaignState, manifest: ContentManifest): CampaignState {
  return { ...state, manifests: [...state.manifests, manifest] };
}

function atTrainingCap(state: CampaignState, content: CampaignContent, skill: string): boolean {
  const level = state.view.officer.skills[bare(skill)]?.level ?? 0;
  return level >= Math.min(5, trainingCap(state, content));
}

function trainingCap(state: CampaignState, content: CampaignContent): number {
  const rank = content.ranks.find((row) => row.id === state.view.officer.rank);
  return rank?.trainingCap ?? 0;
}

function coverAllowed(state: CampaignState, cover: string, city: LegendCity): boolean {
  if (!city.covers.some((id) => sameId(id, cover))) {
    return false;
  }
  const burned = new Set<string>();
  for (const service of city.services) {
    const dossier = state.truth.dossiers[service];
    if (dossier === undefined) {
      continue;
    }
    for (const id of dossier.burnedLegends) {
      burned.add(id);
    }
  }
  return !state.view.officer.legends.some(
    (legend) => burned.has(legend.id) && sameId(legend.cover, cover),
  );
}

function coverIsOfficial(content: CampaignContent, cover: string): boolean {
  for (const [id, record] of content.set.coverIdentities) {
    if (sameId(id, cover)) {
      return coverOfficial(record);
    }
  }
  return true;
}

function nextLegendId(legends: readonly { readonly id: LegendId }[]): LegendId {
  let max = 0;
  for (const legend of legends) {
    const n = Number(legend.id.slice(3));
    if (Number.isInteger(n) && n > max) {
      max = n;
    }
  }
  return `lg-${max + 1}`;
}

function findSkill(content: CampaignContent, id: string): CampaignContent['skills'][number] | undefined {
  return content.skills.find((skill) => sameId(skill.id, id));
}

function findRequisition(
  content: CampaignContent,
  id: string,
): CampaignContent['requisitions'][number] | undefined {
  return content.requisitions.find((item) => sameId(item.id, id));
}

function bare(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash < 0 ? id : id.slice(slash + 1);
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}
