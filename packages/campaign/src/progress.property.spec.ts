/**
 * Property 11: after any sequence of posting stats and training choices, each
 * skill level is non-decreasing, at most 5, and equal to the thresholds its
 * experience has reached plus the training steps actually taken. Training
 * alone cannot pass the rank's training cap.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { growSkills, trainSkill } from './progress.js';
import type { PostingStats, SkillLevel } from './state.js';

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
const content = campaignContent(
  loaded.value,
  campaignSources([CORE], new Set(['core'])).sources,
);
if (content.skills.length === 0 || content.ranks.length === 0) {
  throw new Error('core campaign content is missing skills or ranks');
}

const STAT_FIELDS = [
  'decrypts',
  'recruits',
  'turned',
  'surveilObservations',
  'followsCompleted',
  'arrestsCorrect',
  'arrestsWrongful',
  'madeFactLines',
  'meetingsHeld',
  'dropsServiced',
] as const;

type Step =
  | { readonly kind: 'stats'; readonly stats: PostingStats }
  | { readonly kind: 'train'; readonly skillId: string };

function experience(stats: PostingStats, fields: readonly string[]): number {
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

function thresholds(perLevel: readonly number[], xp: number): number {
  return perLevel.filter((mark) => xp >= mark).length;
}

describe('skill growth property', () => {
  it('keeps levels equal to thresholds reached plus training, within the rank cap', () => {
    // Feature: campaign-career, Property 11: Skill growth
    const statRecord = Object.fromEntries(
      STAT_FIELDS.map((field) => [field, fc.integer({ min: 0, max: 40 })]),
    ) as { [K in (typeof STAT_FIELDS)[number]]: fc.Arbitrary<number> };

    fc.assert(
      fc.property(
        fc.record({
          rank: fc.constantFrom(...content.ranks),
          steps: fc.array(
            fc.oneof(
              fc.record(statRecord).map((stats) => ({ kind: 'stats' as const, stats })),
              fc
                .constantFrom(...content.skills.map((skill) => skill.id))
                .map((skillId) => ({ kind: 'train' as const, skillId })),
            ),
            { minLength: 0, maxLength: 16 },
          ),
        }),
        (sample) => {
          const cap = Math.min(5, sample.rank.trainingCap);
          let skills: Record<string, { level: SkillLevel; xp: number }> = {};
          const xp: Record<string, number> = {};
          const trains: Record<string, number> = {};
          const previous: Record<string, number> = {};

          for (const step of sample.steps as readonly Step[]) {
            if (step.kind === 'stats') {
              skills = { ...growSkills(skills, step.stats, content.skills) };
              for (const skill of content.skills) {
                xp[skill.id] = (xp[skill.id] ?? 0) + experience(step.stats, skill.xp.from);
              }
            } else {
              const before = skills[step.skillId]?.level ?? 0;
              skills = { ...trainSkill(skills, step.skillId, sample.rank.trainingCap) };
              const after = skills[step.skillId]?.level ?? 0;
              if (after !== before) {
                expect(after).toBe(before + 1);
                trains[step.skillId] = (trains[step.skillId] ?? 0) + 1;
              }
            }

            for (const skill of content.skills) {
              const level = skills[skill.id]?.level ?? 0;
              const reached = thresholds(skill.xp.perLevel, xp[skill.id] ?? 0);
              const taken = trains[skill.id] ?? 0;
              expect(level).toBeGreaterThanOrEqual(previous[skill.id] ?? 0);
              expect(level).toBeLessThanOrEqual(5);
              expect(taken).toBeLessThanOrEqual(cap);
              expect(level).toBe(Math.min(5, reached + taken));
              expect(level - reached).toBeLessThanOrEqual(cap);
              previous[skill.id] = level;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
