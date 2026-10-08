/**
 * Officer modifiers (design, "Officer and modifiers"; Requirements 4.1–4.5).
 *
 * Effects run in a fixed order: Rank, Skills, Traits, posting tier, era,
 * Requisitions. Each content effect is clamped to its own bounds, then the
 * merged preset and recruitment weights are re-validated with the slice
 * schemas. Slice formulas are not changed; the result is posting-context input.
 *
 * A language skill's Cold Approach term (`firstContact.a`) is applied only
 * when the officer speaks that language at level 2 or higher and the city
 * uses it. A language crash course raises that skill by one level before the
 * skill effects run, so the course counts as a level rather than a second pass.
 */

import { DifficultyPresetSchema, type DifficultyPreset } from '@tradecraft/content';
import { RecruitmentWeightsSchema, type Result } from '@tradecraft/engine';
import type { z } from 'zod';

import type { CampaignContent } from './content/library.js';
import type { ModifierEffect, RankRow, Requisition, Skill } from './content/schemas.js';
import { shiftDoctrine } from './era.js';
import type { DeepPartial, Officer, SkillLevel } from './state.js';

export type RecruitmentWeights = z.infer<typeof RecruitmentWeightsSchema>;

export type PostingTier = 'quiet' | 'standard' | 'hot';

export interface OfficerPosting {
  readonly tier: PostingTier;
  readonly cityLanguages: readonly string[];
  /** Requisition ids, in the order they were bought. */
  readonly requisitions: readonly string[];
  /** Tension and the campaign's era scale. Omitted before a posting is chosen. */
  readonly era?: { readonly tension: number; readonly doctrineScale: number };
}

export interface OfficerModifierBases {
  readonly preset: DifficultyPreset;
  readonly weights: RecruitmentWeights;
}

export interface OfficerModifiers {
  readonly preset: DeepPartial<DifficultyPreset>;
  readonly weights: DeepPartial<RecruitmentWeights>;
  readonly resolvedPreset: DifficultyPreset;
  readonly resolvedWeights: RecruitmentWeights;
  readonly arrestAuthority: number;
  readonly stationStaff: number;
  readonly extraPlayerDrop: boolean;
  readonly cipherAid: boolean;
  /** 0.9 when a prepared legend was bought, otherwise 1. */
  readonly coverSuspicionGrowth: number;
}

interface Working {
  preset: Record<string, unknown>;
  weights: Record<string, unknown>;
  presetOver: Record<string, unknown>;
  weightOver: Record<string, unknown>;
}

/**
 * The clamped add-delta or multiply-factor for one content effect.
 * `mul` is `1 + perLevel * level`; `add` is `perLevel * level`.
 */
export function modifierAmount(
  effect: Pick<ModifierEffect, 'op' | 'perLevel' | 'bounds'>,
  level: number,
): number {
  const raw = effect.op === 'mul' ? 1 + effect.perLevel * level : effect.perLevel * level;
  return Math.min(effect.bounds[1], Math.max(effect.bounds[0], raw));
}

/** Rank, skills, traits, tier, era and requisitions, clamped and schema-checked. */
export function officerModifiers(
  officer: Officer,
  posting: OfficerPosting,
  content: CampaignContent,
  base: OfficerModifierBases,
): Result<OfficerModifiers, string> {
  const rank = content.ranks.find((row) => row.id === officer.rank);
  if (rank === undefined) {
    return { ok: false, error: `unknown rank "${officer.rank}"` };
  }
  const bought = resolveRequisitions(posting.requisitions, content);
  if (!bought.ok) {
    return bought;
  }

  const working: Working = {
    preset: structuredClone(base.preset) as Record<string, unknown>,
    weights: structuredClone(base.weights) as Record<string, unknown>,
    presetOver: {},
    weightOver: {},
  };
  const levels = effectiveLevels(officer, bought.value);

  applyRank(working, rank);
  const skillError = applySkills(working, levels, posting.cityLanguages, content.skills);
  if (skillError !== undefined) {
    return { ok: false, error: skillError };
  }
  const traitError = applyTraits(working, officer.traits, content);
  if (traitError !== undefined) {
    return { ok: false, error: traitError };
  }
  applyTier(posting.tier);
  applyEra(working, posting.era);
  const extras = applyRequisitionEffects(working, bought.value);

  const resolvedPreset = DifficultyPresetSchema.safeParse(working.preset);
  if (!resolvedPreset.success) {
    return { ok: false, error: resolvedPreset.error.issues[0]?.message ?? 'preset is invalid' };
  }
  const resolvedWeights = RecruitmentWeightsSchema.safeParse(working.weights);
  if (!resolvedWeights.success) {
    return {
      ok: false,
      error: resolvedWeights.error.issues[0]?.message ?? 'recruitment weights are invalid',
    };
  }
  return {
    ok: true,
    value: {
      preset: working.presetOver as DeepPartial<DifficultyPreset>,
      weights: working.weightOver as DeepPartial<RecruitmentWeights>,
      resolvedPreset: resolvedPreset.data,
      resolvedWeights: resolvedWeights.data,
      arrestAuthority: rank.arrestAuthority,
      stationStaff: rank.stationStaff,
      extraPlayerDrop: extras.extraPlayerDrop,
      cipherAid: extras.cipherAid,
      coverSuspicionGrowth: extras.coverSuspicionGrowth,
    },
  };
}

function resolveRequisitions(
  ids: readonly string[],
  content: CampaignContent,
): Result<readonly Requisition[], string> {
  const found: Requisition[] = [];
  for (const id of ids) {
    const item = content.requisitions.find(
      (requisition) => requisition.id === id || id.endsWith(`/${requisition.id}`),
    );
    if (item === undefined) {
      return { ok: false, error: `unknown requisition "${id}"` };
    }
    found.push(item);
  }
  return { ok: true, value: found };
}

function effectiveLevels(
  officer: Officer,
  requisitions: readonly Requisition[],
): Record<string, SkillLevel> {
  const levels: Record<string, SkillLevel> = {};
  for (const [id, skill] of Object.entries(officer.skills)) {
    levels[id] = skill.level;
  }
  for (const requisition of requisitions) {
    if (requisition.effect.kind !== 'language-crash-course') {
      continue;
    }
    const id = requisition.effect.skill;
    const bare = id.includes('/') ? (id.split('/').pop() ?? id) : id;
    const current = levels[bare] ?? levels[id] ?? 0;
    const next = Math.min(5, current + 1) as SkillLevel;
    if (levels[bare] !== undefined) {
      levels[bare] = next;
    } else if (levels[id] !== undefined) {
      levels[id] = next;
    } else {
      levels[bare] = next;
    }
  }
  return levels;
}

function applyRank(working: Working, rank: RankRow): void {
  const budget = readNumber(working.preset, 'startingBudget');
  if (budget === undefined) {
    return;
  }
  writeNumber(working, 'startingBudget', Math.round(budget * rank.budgetScale));
}

function applySkills(
  working: Working,
  levels: Readonly<Record<string, SkillLevel>>,
  cityLanguages: readonly string[],
  skills: readonly Skill[],
): string | undefined {
  for (const skill of skills) {
    const level = levels[skill.id] ?? 0;
    if (level === 0) {
      continue;
    }
    if (skill.language && (level < 2 || !cityLanguages.includes(skill.id))) {
      continue;
    }
    for (const effect of skill.effects) {
      const error = applyEffect(working, effect, level);
      if (error !== undefined) {
        return error;
      }
    }
  }
  return undefined;
}

function applyTraits(
  working: Working,
  held: readonly string[],
  content: CampaignContent,
): string | undefined {
  for (const trait of content.traits) {
    if (!held.includes(trait.id)) {
      continue;
    }
    for (const effect of trait.effects) {
      const error = applyEffect(working, effect, 1);
      if (error !== undefined) {
        return error;
      }
    }
  }
  return undefined;
}

/** The tier is part of the fixed order. No preset path is authored for it. */
function applyTier(tier: PostingTier): PostingTier {
  switch (tier) {
    case 'quiet':
    case 'standard':
    case 'hot':
      return tier;
    default: {
      const neverTier: never = tier;
      return neverTier;
    }
  }
}

function applyEra(working: Working, era: OfficerPosting['era']): void {
  if (era === undefined) {
    return;
  }
  const doctrine = doctrineRanges(working.preset.doctrine);
  if (doctrine === undefined) {
    return;
  }
  const next = shiftDoctrine(doctrine, era.tension, era.doctrineScale);
  working.preset.doctrine = next;
  working.presetOver.doctrine = next;
}

function doctrineRanges(value: unknown): DifficultyPreset['doctrine'] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const ranges = {} as DifficultyPreset['doctrine'];
  for (const key of ['risk', 'security', 'deception'] as const) {
    const range = record[key];
    if (range === null || typeof range !== 'object' || Array.isArray(range)) {
      return undefined;
    }
    const ends = range as { min?: unknown; max?: unknown };
    if (typeof ends.min !== 'number' || typeof ends.max !== 'number') {
      return undefined;
    }
    ranges[key] = { min: ends.min, max: ends.max };
  }
  return ranges;
}

function applyRequisitionEffects(
  working: Working,
  requisitions: readonly Requisition[],
): { extraPlayerDrop: boolean; cipherAid: boolean; coverSuspicionGrowth: number } {
  let extraPlayerDrop = false;
  let cipherAid = false;
  let coverSuspicionGrowth = 1;
  for (const requisition of requisitions) {
    const effect = requisition.effect;
    if (effect.kind === 'budget-credit') {
      const budget = readNumber(working.preset, 'startingBudget');
      if (budget !== undefined) {
        writeNumber(working, 'startingBudget', budget + effect.amount);
      }
    } else if (effect.kind === 'trace-priority') {
      const delay = readNumber(working.preset, 'traceRequestDelayPhases');
      if (delay !== undefined) {
        writeNumber(working, 'traceRequestDelayPhases', Math.max(1, delay - 1));
      }
    } else if (effect.kind === 'extra-player-drop') {
      extraPlayerDrop = true;
    } else if (effect.kind === 'cipher-aid') {
      cipherAid = true;
    } else if (effect.kind === 'prepared-legend') {
      coverSuspicionGrowth = 0.9;
    }
  }
  return { extraPlayerDrop, cipherAid, coverSuspicionGrowth };
}

function applyEffect(working: Working, effect: ModifierEffect, level: number): string | undefined {
  const amount = modifierAmount(effect, level);
  const current = readNumber(working.preset, effect.path) ?? readNumber(working.weights, effect.path);
  if (current === undefined) {
    return `modifier path "${effect.path}" is not a numeric field`;
  }
  const next = effect.op === 'mul' ? current * amount : current + amount;
  writeNumber(working, effect.path, next);
  return undefined;
}

function readNumber(root: unknown, path: string): number | undefined {
  let current = root;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' ? current : undefined;
}

function writeNumber(working: Working, path: string, value: number): void {
  const onPreset = readNumber(working.preset, path) !== undefined;
  write(onPreset ? working.preset : working.weights, path, value);
  write(onPreset ? working.presetOver : working.weightOver, path, value);
}

function write(root: Record<string, unknown>, path: string, value: number): void {
  const keys = path.split('.');
  let current = root;
  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  const leaf = keys[keys.length - 1];
  if (leaf !== undefined) {
    current[leaf] = value;
  }
}
