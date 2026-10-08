/**
 * Skill growth, trait triggers and stress (Requirements 3.2–3.6).
 *
 * Experience is cumulative. A skill's level is the number of content
 * thresholds its experience has reached, plus levels granted without
 * experience (a background level or a training step), capped at 5. Training
 * itself stops at the rank's training cap. Stress is clamped to 0–100. A
 * `stress-at-least`
 * trigger tracks the threshold, so `strained` is on the officer for the next
 * posting only while stress stays at or above its `at` value. Stress of 100
 * forces medical leave.
 */

import type { Skill, Trait } from './content/schemas.js';
import type { Officer, PostingStats, SkillLevel } from './state.js';

export interface CareerEvents {
  readonly burned: boolean;
  readonly assetArrested: boolean;
  readonly captured: boolean;
}

export interface StressAmounts {
  readonly burned: number;
  readonly capture: number;
  readonly assetArrested: number;
}

const NONE: CareerEvents = { burned: false, assetArrested: false, captured: false };

/**
 * Raise one skill by one level. Does nothing once the skill is at the rank
 * training cap or at 5. Experience is unchanged, so the new level is a
 * training step on top of the thresholds already reached.
 */
export function trainSkill(
  skills: Officer['skills'],
  skillId: string,
  trainingCap: number,
): Officer['skills'] {
  const current = skills[skillId] ?? { level: 0 as SkillLevel, xp: 0 };
  const cap = Math.min(5, Math.max(0, trainingCap));
  if (current.level >= cap) {
    return skills;
  }
  return {
    ...skills,
    [skillId]: { level: asLevel(current.level + 1), xp: current.xp },
  };
}

/** Add posting-stat experience and raise levels that have reached a threshold. */
export function growSkills(
  skills: Officer['skills'],
  stats: PostingStats,
  catalogue: readonly Skill[],
): Officer['skills'] {
  const next: Record<string, { level: SkillLevel; xp: number }> = {};
  for (const [id, skill] of Object.entries(skills)) {
    next[id] = skill;
  }
  for (const skill of catalogue) {
    const current = next[skill.id] ?? { level: 0 as SkillLevel, xp: 0 };
    const carried = Math.max(0, current.level - thresholdsReached(skill, current.xp));
    const xp = current.xp + experienceFrom(stats, skill.xp.from);
    const reached = thresholdsReached(skill, xp);
    next[skill.id] = {
      level: asLevel(Math.min(5, reached + carried)),
      xp,
    };
  }
  return next;
}

/**
 * Add or remove traits whose triggers fired. A stress threshold is applied
 * while the stress stays on that side of `at` (default 80). A burn, arrest
 * or capture applies only when that event happened.
 */
export function applyTraitTriggers(
  traits: readonly string[],
  stress: number,
  events: CareerEvents,
  catalogue: readonly Trait[],
): readonly string[] {
  const next = [...traits];
  for (const trait of catalogue) {
    for (const trigger of trait.triggers) {
      const id = bare(trigger.trait ?? trait.id);
      if (trigger.kind === 'stress-at-least') {
        const on = stress >= (trigger.at ?? 80);
        if (trigger.action === 'add') {
          setTrait(next, id, on);
        } else if (on) {
          setTrait(next, id, false);
        }
      } else if (occasion(trigger.kind, events)) {
        setTrait(next, id, trigger.action === 'add');
      }
    }
  }
  return next;
}

/** Raise stress for a burn, an arrested asset or a capture, then clamp it. */
export function applyStress(stress: number, events: CareerEvents, amounts: StressAmounts): number {
  let next = stress;
  if (events.burned) {
    next += amounts.burned;
  }
  if (events.assetArrested) {
    next += amounts.assetArrested;
  }
  if (events.captured) {
    next += amounts.capture;
  }
  return clampStress(next);
}

/** Medical leave is forced once stress reaches 100. */
export function requiresMedicalLeave(stress: number): boolean {
  return stress >= 100;
}

export function clampStress(stress: number): number {
  if (!Number.isFinite(stress)) {
    return 0;
  }
  return Math.min(100, Math.max(0, stress));
}

function thresholdsReached(skill: Skill, xp: number): number {
  return skill.xp.perLevel.filter((threshold) => xp >= threshold).length;
}

function experienceFrom(stats: PostingStats, fields: readonly string[]): number {
  const record = stats as unknown as Record<string, unknown>;
  let total = 0;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

function occasion(kind: Trait['triggers'][number]['kind'], events: CareerEvents): boolean {
  if (kind === 'burned') {
    return events.burned;
  }
  if (kind === 'asset-arrested') {
    return events.assetArrested;
  }
  if (kind === 'captured') {
    return events.captured;
  }
  return false;
}

function setTrait(traits: string[], id: string, present: boolean): void {
  const at = traits.indexOf(id);
  if (present && at < 0) {
    traits.push(id);
  } else if (!present && at >= 0) {
    traits.splice(at, 1);
  }
}

function bare(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

function asLevel(level: number): SkillLevel {
  if (level === 0 || level === 1 || level === 2 || level === 3 || level === 4 || level === 5) {
    return level;
  }
  return 5;
}

export const NO_CAREER_EVENTS: CareerEvents = NONE;
