import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DifficultyPresetSchema } from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { modifierAmount, officerModifiers, type RecruitmentWeights } from './officer.js';
import type { Officer } from './state.js';

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
const preset = loaded.value.difficultyPresets.get('core/standard');
if (preset === undefined) {
  throw new Error('core/standard preset missing');
}

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1.5, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};

function officer(patch: Partial<Officer> = {}): Officer {
  return {
    name: 'Ada',
    background: 'analyst',
    rank: 'case-officer',
    skills: { cryptanalysis: { level: 1, xp: 0 }, german: { level: 1, xp: 0 } },
    traits: ['methodical'],
    stress: 0,
    reprimands: 0,
    legends: [],
    careerStanding: 0,
    careerPoints: 0,
    factions: { security: 1 },
    ...patch,
  };
}

describe('officer modifiers', () => {
  it('clamps an effect to its declared bounds', () => {
    expect(
      modifierAmount({ op: 'mul', perLevel: -0.06, bounds: [0.7, 1] }, 5),
    ).toBeCloseTo(0.7);
    expect(modifierAmount({ op: 'mul', perLevel: -1, bounds: [0.7, 1] }, 5)).toBe(0.7);
    expect(modifierAmount({ op: 'add', perLevel: 1, bounds: [0, 0.1] }, 5)).toBe(0.1);
  });

  it('applies rank, skills, traits and the language gate, then resolves the preset', () => {
    const quiet = officerModifiers(
      officer(),
      { tier: 'quiet', cityLanguages: ['german'], requisitions: [] },
      content,
      { preset, weights },
    );
    expect(quiet.ok).toBe(true);
    if (!quiet.ok) {
      return;
    }
    expect(quiet.value.arrestAuthority).toBe(2);
    expect(quiet.value.stationStaff).toBe(2);
    expect(quiet.value.resolvedPreset.startingBudget).toBe(Math.round(preset.startingBudget * 1));
    expect(quiet.value.resolvedPreset.tradecraftErrorProbability).toBeCloseTo(
      preset.tradecraftErrorProbability + 0.02 - 0.01,
    );
    expect(quiet.value.resolvedWeights.firstContact.a).toBe(1.5);
    expect(DifficultyPresetSchema.safeParse(quiet.value.resolvedPreset).success).toBe(true);

    const linguist = officerModifiers(
      officer({
        background: 'linguist',
        skills: { german: { level: 2, xp: 0 }, russian: { level: 1, xp: 0 } },
        traits: [],
      }),
      { tier: 'standard', cityLanguages: ['german', 'russian'], requisitions: [] },
      content,
      { preset, weights },
    );
    expect(linguist.ok).toBe(true);
    if (!linguist.ok) {
      return;
    }
    expect(linguist.value.resolvedWeights.firstContact.a).toBeCloseTo(1.5 + 0.3);

    const away = officerModifiers(
      officer({
        skills: { german: { level: 2, xp: 0 } },
        traits: [],
      }),
      { tier: 'hot', cityLanguages: ['french'], requisitions: [] },
      content,
      { preset, weights },
    );
    expect(away.ok).toBe(true);
    if (!away.ok) {
      return;
    }
    expect(away.value.resolvedWeights.firstContact.a).toBe(1.5);
  });

  it('scales the budget from the rank table before a requisition credit', () => {
    const result = officerModifiers(
      officer({ rank: 'senior-case-officer', skills: {}, traits: [] }),
      { tier: 'standard', cityLanguages: [], requisitions: ['budget-credit', 'trace-priority'] },
      content,
      { preset, weights },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.arrestAuthority).toBe(3);
    expect(result.value.stationStaff).toBe(2);
    expect(result.value.resolvedPreset.startingBudget).toBe(
      Math.round(preset.startingBudget * 1.2) + 40,
    );
    expect(result.value.resolvedPreset.traceRequestDelayPhases).toBe(
      Math.max(1, preset.traceRequestDelayPhases - 1),
    );
    expect(result.value.preset).toMatchObject({
      startingBudget: result.value.resolvedPreset.startingBudget,
    });
  });

  it('counts a language course toward the Cold Approach level and shifts doctrine after traits', () => {
    const result = officerModifiers(
      officer({ traits: ['strained'] }),
      {
        tier: 'hot',
        cityLanguages: ['german'],
        requisitions: ['language-course', 'prepared-legend', 'extra-drop', 'cipher-aid'],
        era: { tension: 1, doctrineScale: 0.2 },
      },
      content,
      { preset, weights },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.resolvedWeights.firstContact.a).toBeCloseTo(1.5 + 0.3);
    expect(result.value.coverSuspicionGrowth).toBe(0.9);
    expect(result.value.extraPlayerDrop).toBe(true);
    expect(result.value.cipherAid).toBe(true);
    expect(result.value.resolvedPreset.doctrine.risk.min).toBeCloseTo(preset.doctrine.risk.min + 0.1);
    expect(result.value.resolvedPreset.doctrine.risk.max).toBeCloseTo(preset.doctrine.risk.max + 0.1);
    expect(result.value.resolvedPreset.tradecraftErrorProbability).toBeCloseTo(
      preset.tradecraftErrorProbability + 0.02 + 0.03,
    );
  });

  it('rejects an unknown rank or requisition', () => {
    expect(
      officerModifiers(
        officer({ rank: 'admiral' as Officer['rank'] }),
        { tier: 'quiet', cityLanguages: [], requisitions: [] },
        content,
        { preset, weights },
      ).ok,
    ).toBe(false);
    expect(
      officerModifiers(
        officer(),
        { tier: 'quiet', cityLanguages: [], requisitions: ['not-a-thing'] },
        content,
        { preset, weights },
      ).ok,
    ).toBe(false);
  });
});
