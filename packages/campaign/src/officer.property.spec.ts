/**
 * Property 10: for any officer, posting tier, epoch, tension and requisition
 * set, every applied content effect stays inside its declared bounds and the
 * merged difficulty preset passes the slice schema.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DifficultyPresetSchema } from '@tradecraft/content';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { EpochSchema, RANKS, type ModifierEffect } from './content/schemas.js';
import { modifierAmount, officerModifiers, type RecruitmentWeights } from './officer.js';
import type { Officer, SkillLevel } from './state.js';

const CORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'content',
  'packs',
  'core',
);

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const sources = campaignSources([CORE], new Set(['core'])).sources;
const content = campaignContent(loaded.value, sources);
const presets = [...loaded.value.difficultyPresets.values()];
const epochs = sources
  .filter((source) => source.kind === 'epoch')
  .flatMap((source) => source.items.map((item) => EpochSchema.parse(item)));
if (presets.length === 0 || epochs.length === 0 || content.skills.length === 0) {
  throw new Error('core campaign content is missing presets, epochs or skills');
}

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1.5, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};

const TIERS = ['quiet', 'standard', 'hot'] as const;
const languageIds = content.skills.filter((skill) => skill.language).map((skill) => skill.id);

function asLevel(level: number): SkillLevel {
  if (level === 0 || level === 1 || level === 2 || level === 3 || level === 4 || level === 5) {
    return level;
  }
  throw new Error(`skill level ${level} is outside 0–5`);
}

/** The level a skill effect sees, including one language course. */
function effectiveLevel(skillId: string, base: number, requisitionIds: readonly string[]): number {
  let level = base;
  for (const id of requisitionIds) {
    const item = content.requisitions.find((requisition) => requisition.id === id);
    if (item?.effect.kind !== 'language-crash-course') {
      continue;
    }
    const named = item.effect.skill;
    const bare = named.includes('/') ? named.slice(named.lastIndexOf('/') + 1) : named;
    if (bare === skillId) {
      level = Math.min(5, level + 1);
    }
  }
  return level;
}

function expectWithinBounds(effect: ModifierEffect, level: number): void {
  const raw = effect.op === 'mul' ? 1 + effect.perLevel * level : effect.perLevel * level;
  const [lo, hi] = effect.bounds;
  const clamped = Math.min(hi, Math.max(lo, raw));
  expect(clamped).toBeGreaterThanOrEqual(lo);
  expect(clamped).toBeLessThanOrEqual(hi);
  expect(modifierAmount(effect, level)).toBeCloseTo(clamped);
}

describe('bounded officer modifiers', () => {
  it('keeps every applied effect inside its bounds and the merged preset valid', () => {
    // Feature: campaign-career, Property 10: Bounded Officer modifiers
    fc.assert(
      fc.property(
        fc.record({
          rank: fc.constantFrom(...RANKS),
          levels: fc.array(fc.integer({ min: 0, max: 5 }), {
            minLength: content.skills.length,
            maxLength: content.skills.length,
          }),
          traits: fc.subarray(content.traits.map((trait) => trait.id)),
          stress: fc.integer({ min: 0, max: 100 }),
          tier: fc.constantFrom(...TIERS),
          epoch: fc.constantFrom(...epochs),
          tensionUnit: fc.double({ min: 0, max: 1, noNaN: true }),
          doctrineScale: fc.double({ min: 0, max: 0.5, noNaN: true }),
          cityLanguages: fc.subarray(languageIds),
          requisitions: fc.subarray(content.requisitions.map((item) => item.id)),
          preset: fc.constantFrom(...presets),
        }),
        (sample) => {
          const skills: Record<string, { level: SkillLevel; xp: number }> = {};
          content.skills.forEach((skill, index) => {
            const level = sample.levels[index];
            if (level === undefined) {
              return;
            }
            skills[skill.id] = { level: asLevel(level), xp: 0 };
          });
          const officer: Officer = {
            name: 'Ada',
            background: 'analyst',
            rank: sample.rank,
            skills,
            traits: sample.traits,
            stress: sample.stress,
            reprimands: 0,
            legends: [],
            careerStanding: 0,
            careerPoints: 0,
            factions: {},
          };
          const [tensionLo, tensionHi] = sample.epoch.tension;
          const tension = tensionLo + sample.tensionUnit * (tensionHi - tensionLo);
          const result = officerModifiers(
            officer,
            {
              tier: sample.tier,
              cityLanguages: sample.cityLanguages,
              requisitions: sample.requisitions,
              era: { tension, doctrineScale: sample.doctrineScale },
            },
            content,
            { preset: sample.preset, weights },
          );
          expect(result.ok, result.ok ? '' : result.error).toBe(true);
          if (!result.ok) {
            return;
          }
          expect(DifficultyPresetSchema.safeParse(result.value.resolvedPreset).success).toBe(true);

          for (const skill of content.skills) {
            const level = effectiveLevel(
              skill.id,
              sample.levels[content.skills.indexOf(skill)] ?? 0,
              sample.requisitions,
            );
            if (level === 0) {
              continue;
            }
            if (skill.language && (level < 2 || !sample.cityLanguages.includes(skill.id))) {
              continue;
            }
            for (const effect of skill.effects) {
              expectWithinBounds(effect, level);
            }
          }
          for (const trait of content.traits) {
            if (!sample.traits.includes(trait.id)) {
              continue;
            }
            for (const effect of trait.effects) {
              expectWithinBounds(effect, 1);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
