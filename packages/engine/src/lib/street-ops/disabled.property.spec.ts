/**
 * Property 1 (street-ops task 1.2): a disabled add-on matches a build that
 * never had one, and turning it on without taking a street action does not
 * move the generated world.
 *
 * **Validates: Requirements 1.4, 13.1**
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { quote } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import type { Action } from '../action/types.js';
import { ScenarioConfigSchema, scenarioForStore, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import type { WorldState } from '../model/state.js';
import { streetOpsRegistry } from './addon.js';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');

function loadCore(): { content: ContentSet; inputs: Omit<GenerateInputs, 'scenario' | 'preset'> } {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    inputs: {
      content: content.value,
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
    },
  };
}

const LOADED = loadCore();

function preset(): DifficultyPreset {
  for (const [key, value] of LOADED.content.difficultyPresets) {
    if (key === 'standard' || key.endsWith('/standard')) return value;
  }
  throw new Error('no standard preset');
}

const STANDARD = preset();

function baseScenario(): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function withoutStreetOps(state: WorldState): WorldState {
  const { streetOps: _streetOps, ...scenario } = state.meta.scenario;
  return { ...state, meta: { ...state.meta, scenario } };
}

describe('street-ops disabled', () => {
  it('stores a disabled block as if the add-on were absent', () => {
    // Feature: street-ops, Property 1: Disabled equals absent
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 500 }),
        (narrateSteps, ticksPerPhase, sightRangeM) => {
          const absent = baseScenario();
          const disabled = ScenarioConfigSchema.parse({
            ...absent,
            streetOps: { enabled: false, narrateSteps, ticksPerPhase, sightRangeM },
          });
          expect(scenarioForStore(disabled)).toEqual(absent);
          expect(scenarioForStore(absent)).toBe(absent);
          expect(streetOpsRegistry(disabled)).toBeUndefined();
          expect(streetOpsRegistry(absent)).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaves a generated world unchanged when the add-on is disabled or unused', () => {
    // Feature: street-ops, Property 1: Disabled equals absent
    const absent = baseScenario();
    const disabled = ScenarioConfigSchema.parse({ ...absent, streetOps: { enabled: false } });
    const enabled = ScenarioConfigSchema.parse({ ...absent, streetOps: { enabled: true } });
    const inputs = (scenario: ScenarioConfig): GenerateInputs => ({
      ...LOADED.inputs,
      preset: STANDARD,
      scenario,
    });
    const plain = generate('street-ops-absent', inputs(absent));
    const off = generate('street-ops-absent', inputs(disabled));
    const on = generate('street-ops-absent', inputs(enabled));
    expect(off).toEqual(plain);
    expect(withoutStreetOps(on)).toEqual(plain);
    expect(on.meta.scenario.streetOps?.enabled).toBe(true);
    expect(plain.meta.scenario.streetOps).toBeUndefined();
  });

  it('refuses an unregistered street action and does not move a built-in quote', () => {
    // Feature: street-ops, Property 1: Disabled equals absent
    const state = generate('street-ops-quote', {
      ...LOADED.inputs,
      preset: STANDARD,
      scenario: baseScenario(),
    });
    const ctx: ResolverContext = { content: LOADED.content };
    const enabled = ScenarioConfigSchema.parse({
      ...baseScenario(),
      streetOps: { enabled: true },
    });
    const extensions = streetOpsRegistry(enabled);
    const withRegistry: ResolverContext = { ...ctx, extensions };
    const wait: Action = { kind: 'wait', phases: 1 };
    const turn: Action = { kind: 'street-ops.turn' };
    expect(quote(state, wait, ctx)).toEqual(quote(state, wait, withRegistry));
    const refused = quote(state, turn, withRegistry);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('unavailable');
    expect(extensions?.addons).toHaveLength(1);
    expect(extensions?.action('street-ops.turn')).toBeDefined();
  });
});
