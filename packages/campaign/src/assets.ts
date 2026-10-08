/**
 * Asset decisions (design, "Asset continuity"; Requirements 11.1, 11.2, 11.4, 11.5, 11.6).
 *
 * Each staged asset takes one decision. Handover adds standing from trust and
 * keeps the asset in that city's record. Exfiltration debits the archetype's
 * Career Point cost, drops the asset from play, and grants its one-off
 * benefit. Bring is only for a mobile archetype, and the next posting places
 * that asset as a principal with a contact and its carried trust. The asset
 * record is stored as it stands, so `hostileControlled` is not rewritten.
 */

import { asTruth, type Result } from '@tradecraft/engine';

import type { CampaignContent } from './content/library.js';
import type { Exfiltration } from './content/schemas.js';
import { debitCareerPoints } from './prepare.js';
import type {
  CampaignChoice,
  CampaignPersonId,
  CampaignState,
  CarriedAsset,
  CarryIn,
  SkillLevel,
} from './state.js';

/** Shown when the archetype is not mobile. */
export const BRING_REFUSAL = 'Only a travelling asset can be brought along.';

export interface AssetQuote {
  readonly allowed: boolean;
  readonly reason: string;
  readonly cost: number;
}

const NO_QUOTE: AssetQuote = {
  allowed: false,
  reason: 'That choice is not available during assets.',
  cost: 0,
};

/** Whether this asset decision is legal. Does not modify state. */
export function quoteAssetDecision(
  state: CampaignState,
  choice: CampaignChoice,
  content: CampaignContent,
): AssetQuote {
  if (choice.kind !== 'asset-decision') {
    return NO_QUOTE;
  }
  const asset = findStaged(state, choice.asset);
  if (asset === undefined) {
    return { allowed: false, reason: 'That asset is not waiting on a decision.', cost: 0 };
  }
  if (choice.decision === 'handover') {
    return { allowed: true, reason: '', cost: 0 };
  }
  if (choice.decision === 'bring') {
    if (!archetypeMobile(content, asset.person.archetype)) {
      return { allowed: false, reason: BRING_REFUSAL, cost: 0 };
    }
    return { allowed: true, reason: '', cost: 0 };
  }
  const row = findExfiltration(content, asset.person.archetype);
  if (row === undefined) {
    return { allowed: false, reason: 'HQ has no exfiltration for this asset.', cost: 0 };
  }
  if (state.view.officer.careerPoints < row.cost) {
    return {
      allowed: false,
      reason: 'That exfiltration costs more Career Points than you hold.',
      cost: row.cost,
    };
  }
  return { allowed: true, reason: '', cost: row.cost };
}

/** Apply one asset decision. A rejection leaves the caller holding the same state. */
export function applyAssetDecision(
  state: CampaignState,
  choice: CampaignChoice,
  content: CampaignContent,
  options: { readonly handoverBonus: number },
): Result<CampaignState, string> {
  const quote = quoteAssetDecision(state, choice, content);
  if (!quote.allowed || choice.kind !== 'asset-decision') {
    return { ok: false, error: quote.reason };
  }
  const asset = findStaged(state, choice.asset);
  if (asset === undefined) {
    return { ok: false, error: 'That asset is not waiting on a decision.' };
  }
  if (choice.decision === 'handover') {
    return { ok: true, value: handover(state, asset, options.handoverBonus) };
  }
  if (choice.decision === 'bring') {
    return { ok: true, value: bring(state, asset) };
  }
  const row = findExfiltration(content, asset.person.archetype);
  if (row === undefined) {
    return { ok: false, error: 'HQ has no exfiltration for this asset.' };
  }
  const paid = debitCareerPoints(state, row.cost);
  if (!paid.ok) {
    return paid;
  }
  return { ok: true, value: release(grant(paid.value, row), asset.person.id) };
}

/**
 * How a brought asset enters the next posting: a principal, already a contact,
 * with the trust and hostile-control flag it left with.
 */
export function broughtPlacement(asset: CarriedAsset): CarryIn['placements'][number] {
  return {
    person: asset.person,
    as: 'asset',
    trust: asset.trust,
    contact: true,
    hostileControlled: asset.hostileControlled,
    optional: false,
    priority: 1,
  };
}

function findStaged(state: CampaignState, id: CampaignPersonId): CarriedAsset | undefined {
  return state.truth.stagedAssets.find((asset) => asset.person.id === id);
}

function handover(state: CampaignState, asset: CarriedAsset, handoverBonus: number): CampaignState {
  const officer = state.view.officer;
  const prior = state.truth.cities[asset.city]?.handedOver ?? [];
  const cities = {
    ...state.truth.cities,
    [asset.city]: { handedOver: [...prior, asset] },
  };
  return release(
    {
      ...state,
      view: {
        ...state.view,
        officer: { ...officer, careerStanding: officer.careerStanding + handoverBonus * asset.trust },
      },
      truth: asTruth({ ...state.truth, cities }),
    },
    asset.person.id,
  );
}

function bring(state: CampaignState, asset: CarriedAsset): CampaignState {
  return release(
    {
      ...state,
      truth: asTruth({ ...state.truth, brought: [...state.truth.brought, asset] }),
    },
    asset.person.id,
  );
}

function grant(state: CampaignState, row: Exfiltration): CampaignState {
  const benefit = row.benefit;
  if (benefit.kind === 'extra-lead') {
    return {
      ...state,
      truth: asTruth({ ...state.truth, extraLeads: (state.truth.extraLeads ?? 0) + 1 }),
    };
  }
  const officer = state.view.officer;
  if (benefit.kind === 'language') {
    return {
      ...state,
      view: {
        ...state.view,
        officer: { ...officer, skills: addLanguage(officer.skills, benefit.language, benefit.levels) },
      },
    };
  }
  const current = officer.factions[benefit.faction] ?? 0;
  return {
    ...state,
    view: {
      ...state.view,
      officer: {
        ...officer,
        factions: { ...officer.factions, [benefit.faction]: current + benefit.amount },
      },
    },
  };
}

function addLanguage(
  skills: CampaignState['view']['officer']['skills'],
  language: string,
  levels: number,
): CampaignState['view']['officer']['skills'] {
  const current = skills[language] ?? { level: 0 as SkillLevel, xp: 0 };
  return {
    ...skills,
    [language]: { level: skillLevel(current.level + levels), xp: current.xp },
  };
}

function skillLevel(level: number): SkillLevel {
  const clamped = Math.max(0, Math.min(5, Math.trunc(level)));
  if (clamped === 0 || clamped === 1 || clamped === 2 || clamped === 3 || clamped === 4) {
    return clamped;
  }
  return 5;
}

function release(state: CampaignState, id: CampaignPersonId): CampaignState {
  const stagedAssets = state.truth.stagedAssets.filter((asset) => asset.person.id !== id);
  const assets = state.view.staged.assets.filter((asset) => asset.id !== id);
  const done = stagedAssets.length === 0 && state.step.kind === 'assets';
  return {
    ...state,
    step: done ? { kind: 'arcs' } : state.step,
    view: { ...state.view, staged: { ...state.view.staged, assets } },
    truth: asTruth({ ...state.truth, stagedAssets }),
  };
}

function archetypeMobile(content: CampaignContent, archetype: string): boolean {
  for (const [id, row] of content.set.archetypes) {
    if (sameId(id, archetype) || sameId(row.id, archetype)) {
      return row.mobile === true;
    }
  }
  return false;
}

function findExfiltration(content: CampaignContent, archetype: string): Exfiltration | undefined {
  return content.exfiltrations.find((row) => sameId(row.archetype, archetype));
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}
