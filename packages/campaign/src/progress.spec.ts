import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import {
  applyStress,
  applyTraitTriggers,
  growSkills,
  requiresMedicalLeave,
} from './progress.js';
import type { PostingStats } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(
  loaded.value,
  campaignSources([CORE], new Set(['core'])).sources,
);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error('campaign config did not load');
}

function stats(patch: Partial<PostingStats> = {}): PostingStats {
  return {
    decrypts: 0,
    recruits: 0,
    turned: 0,
    surveilObservations: 0,
    followsCompleted: 0,
    arrestsCorrect: 0,
    arrestsWrongful: 0,
    madeFactLines: 0,
    meetingsHeld: 0,
    dropsServiced: 0,
    ...patch,
  };
}

const quiet = { burned: false, assetArrested: false, captured: false };

describe('skill growth, traits and stress', () => {
  it('raises a skill when experience reaches the next threshold and stops at 5', () => {
    const none = growSkills({}, stats(), content.skills);
    expect(none.surveillance).toEqual({ level: 0, xp: 0 });

    const first = growSkills({}, stats({ surveilObservations: 4, followsCompleted: 2 }), content.skills);
    expect(first.surveillance).toEqual({ level: 1, xp: 6 });

    const held = growSkills(
      { cryptanalysis: { level: 1, xp: 0 } },
      stats({ decrypts: 2 }),
      content.skills,
    );
    expect(held.cryptanalysis).toEqual({ level: 1, xp: 2 });

    const second = growSkills(
      { cryptanalysis: { level: 1, xp: 0 } },
      stats({ decrypts: 7 }),
      content.skills,
    );
    // The starting level is kept, then each reached threshold adds one more.
    expect(second.cryptanalysis).toEqual({ level: 3, xp: 7 });

    const capped = growSkills({}, stats({ decrypts: 100 }), content.skills);
    expect(capped.cryptanalysis).toEqual({ level: 5, xp: 100 });
  });

  it('adds strained at 80, drops it below 80, and applies a burn trigger', () => {
    expect(
      applyTraitTriggers([], 79, quiet, content.traits),
    ).toEqual([]);
    expect(
      applyTraitTriggers([], 80, quiet, content.traits),
    ).toEqual(['strained']);
    expect(
      applyTraitTriggers(['strained'], 79, quiet, content.traits),
    ).toEqual([]);

    const scarred = applyTraitTriggers(
      ['watchful'],
      0,
      { burned: true, assetArrested: true, captured: false },
      [
        {
          id: 'scarred',
          name: 'Scarred',
          triggers: [{ kind: 'burned', action: 'add' }],
          effects: [],
        },
        {
          id: 'watchful',
          name: 'Watchful',
          triggers: [{ kind: 'asset-arrested', action: 'remove' }],
          effects: [],
        },
      ],
    );
    expect(scarred).toEqual(['scarred']);
  });

  it('clamps stress and forces medical leave at 100', () => {
    const amounts = config.value.stress;
    expect(applyStress(0, quiet, amounts)).toBe(0);
    expect(applyStress(10, { ...quiet, burned: true }, amounts)).toBe(30);
    expect(applyStress(5, { ...quiet, assetArrested: true }, amounts)).toBe(20);
    expect(
      applyStress(61, { burned: true, assetArrested: false, captured: true }, amounts),
    ).toBe(100);
    expect(requiresMedicalLeave(99)).toBe(false);
    expect(requiresMedicalLeave(100)).toBe(true);
    const afterCapture = applyStress(80, { ...quiet, captured: true }, amounts);
    expect(afterCapture).toBe(100);
    expect(requiresMedicalLeave(afterCapture)).toBe(true);
    expect(applyTraitTriggers([], afterCapture, quiet, content.traits)).toEqual(['strained']);
  });
});
