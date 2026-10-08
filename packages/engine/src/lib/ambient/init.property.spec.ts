/**
 * Property 3: additive initialisation. A day-0 world with ambient enabled,
 * projected onto the slice entities, matches the world with ambient off, and
 * the enabled world was accepted by discovery-path verification.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function inputs(enabled: boolean): GenerateInputs {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack data failed to load');
  }
  let preset: DifficultyPreset | undefined;
  for (const [key, value] of content.value.difficultyPresets) {
    if (key.endsWith('/standard') || key === 'standard') {
      preset = value;
    }
  }
  if (preset === undefined) {
    throw new Error('no standard preset');
  }
  const scenario: ScenarioConfig = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    ...(enabled ? { ambient: { enabled: true, density: 'sparse' } } : {}),
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content: content.value,
    preset,
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const OFF = inputs(false);
const ON = inputs(true);

function project(world: ReturnType<typeof generate>) {
  const scenario = { ...world.meta.scenario };
  delete scenario.ambient;
  const { ambient: _ambient, ...rest } = world;
  return { ...rest, meta: { ...rest.meta, scenario } };
}

describe('additive initialisation', () => {
  it('matches the slice world once ambient state is set aside', () => {
    // Feature: ambient-world, Property 3: Additive initialisation
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]{1,8}$/), (seed) => {
        const off = generate(seed, OFF);
        const on = generate(seed, ON);
        expect(on.ambient).toBeDefined();
        expect(project(on)).toEqual(project(off));
        expect(on.ambient?.dormant.length).toBeGreaterThanOrEqual(2);
        expect(Object.keys(on.ambient?.townsfolk ?? {})).toHaveLength(80);
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
