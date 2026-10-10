/**
 * Property 14 (street-ops task 15.1). Discovery-path verification accepts the
 * same world with the add-on enabled or disabled, and a generated plot stage
 * never names a street action.
 *
 * **Validates: Requirements 13.3, 13.4**
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

import {
  isHumanEdge,
  isSignalEdge,
  verifyDiscoveryPaths,
  witnessesDisjoint,
  type DiscoveryInputs,
  type DiscoveryResult,
} from '../city/discovery.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs, type GenerateOptions } from '../generate.js';
import type { WorldState } from '../model/state.js';

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

function scenario(enabled: boolean): ScenarioConfig {
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
    ...(enabled ? { streetOps: { enabled: true } } : {}),
  });
}

function inputs(enabled: boolean): GenerateInputs {
  return { ...LOADED.inputs, preset: STANDARD, scenario: scenario(enabled) };
}

function digest(result: DiscoveryResult): {
  readonly ok: boolean;
  readonly stages: readonly string[];
  readonly paired: boolean;
} {
  return {
    ok: result.ok,
    stages: result.stages.map((stage) => stage.stage),
    paired: result.stages.every(
      (stage) =>
        isHumanEdge(stage.human.edge) &&
        isSignalEdge(stage.signal.edge) &&
        witnessesDisjoint(stage.human, stage.signal),
    ),
  };
}

function run(seed: string, enabled: boolean): { readonly world: WorldState; readonly digests: ReturnType<typeof digest>[] } {
  const digests: ReturnType<typeof digest>[] = [];
  const verifier = (input: DiscoveryInputs): DiscoveryResult => {
    const result = verifyDiscoveryPaths(input);
    digests.push(digest(result));
    return result;
  };
  const options: GenerateOptions = { verifier };
  return { world: generate(seed, inputs(enabled), options), digests };
}

function withoutStreet(state: WorldState): WorldState {
  const scenario = { ...state.meta.scenario };
  delete scenario.streetOps;
  return { ...state, meta: { ...state.meta, scenario } };
}

const SEEDS = ['alpha', 'bravo', 'charlie'] as const;

describe('street-ops solvability', () => {
  const compared = SEEDS.map((seed) => ({ seed, off: run(seed, false), on: run(seed, true) }));

  it('keeps the discovery verdict when the add-on is enabled', () => {
    // Feature: street-ops, Property 14: Solvability unaffected
    fc.assert(
      fc.property(fc.constantFrom(...compared), ({ off, on }) => {
        expect(withoutStreet(on.world)).toEqual(off.world);
        expect(on.digests).toEqual(off.digests);
        expect(on.digests.length).toBeGreaterThan(0);
        for (const item of on.digests) {
          expect(item.ok).toBe(true);
          expect(item.paired).toBe(true);
          expect(item.stages.length).toBeGreaterThanOrEqual(on.world.plot.stages.length);
        }
        const covered = new Set(on.digests[on.digests.length - 1]?.stages ?? []);
        for (const stage of on.world.plot.stages) expect(covered.has(stage.id)).toBe(true);
        const text = JSON.stringify({ plot: on.world.plot, threads: on.world.sideThreads });
        expect(text).not.toContain('street-ops');
        expect(text).not.toContain('smuggle');
      }),
      { numRuns: 100 },
    );
  });
});
