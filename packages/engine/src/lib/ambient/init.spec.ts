/**
 * Ambient initialisation (ambient-world Req 3). The default scenario leaves
 * ambient off. An enabled scenario adds institutions and townsfolk without
 * changing the slice world.
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
import { describe, expect, it } from 'vitest';

import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from '../config/scenario-config.js';
import { verifyDiscoveryPaths, type DiscoveryResult } from '../city/discovery.js';
import {
  GeneratorError,
  generate,
  type GenerateInputs,
} from '../generate.js';
import { BACKGROUND_ID_PREFIX } from '../noise/background.js';

import { ambientBudgets } from './budgets.js';
import { revealTruth } from '../model/core.js';

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

function loadInputs(scenario: ScenarioConfig): GenerateInputs {
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
    if (key === 'standard' || key.endsWith('/standard')) {
      preset = value;
    }
  }
  if (preset === undefined) {
    throw new Error('no standard preset');
  }
  return {
    content: content.value,
    preset,
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function scenario(enabled: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    ...(enabled ? { ambient: { enabled: true, density: 'standard' } } : {}),
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

const OFF = loadInputs(scenario(false));
const ON = loadInputs(scenario(true));

/** Slice entities, with the ambient opt-in flag set aside. */
function project(world: ReturnType<typeof generate>) {
  const scenario = { ...world.meta.scenario };
  delete scenario.ambient;
  const { ambient: _ambient, ...rest } = world;
  return { ...rest, meta: { ...rest.meta, scenario } };
}

describe('ambient initialisation', () => {
  it('leaves a slice world without ambient state', () => {
    const world = generate('alpha', OFF);
    expect(world.ambient).toBeUndefined();
  });

  it('adds orgs, outlets, townsfolk, ties and dormant sites, and matches the slice world', () => {
    const off = generate('alpha', OFF);
    const on = generate('alpha', ON);
    expect(on.ambient).toBeDefined();
    if (on.ambient === undefined) {
      return;
    }
    const ambient = on.ambient;
    expect(project(on)).toEqual(project(off));
    expect(ambient.outlets.length).toBeGreaterThanOrEqual(1);
    expect(ambient.outlets.length).toBeLessThanOrEqual(3);
    expect(ambient.dormant.length).toBeGreaterThanOrEqual(2);
    expect(ambient.dormant.length).toBeLessThanOrEqual(4);
    for (const id of ambient.dormant) {
      expect(on.city.locations[id]).toBeUndefined();
    }
    expect(Object.keys(ambient.townsfolk)).toHaveLength(ambientBudgets('standard').townsfolk);
    expect(ambient.civicOrgs.some((org) => org.kind === 'cover-employer')).toBe(true);
    expect(ambient.civicOrgs.some((org) => org.kind === 'police')).toBe(true);
    expect(ambient.calendar.startDate).toBe(on.meta.setting.startDate);
    expect(ambient.metrics.exo.police).toBe(0.3);
    expect(ambient.gate.solvable.length).toBeGreaterThan(0);
    expect(ambient.gate.slowRunsToday).toBe(0);
    expect(ambient.metrics.react.police).toBe(0);
    const degree = new Map<string, number>();
    for (const tie of ambient.ties) {
      degree.set(tie.a, (degree.get(tie.a) ?? 0) + 1);
      degree.set(tie.b, (degree.get(tie.b) ?? 0) + 1);
    }
    for (const count of degree.values()) {
      expect(count).toBeLessThanOrEqual(8);
    }
    const informants = revealTruth(ambient.informants);
    for (const id of Object.keys(informants)) {
      const townsfolk = id in ambient.townsfolk;
      const background = id.startsWith(`npc:${BACKGROUND_ID_PREFIX}-`);
      expect(townsfolk || background).toBe(true);
    }
    expect(generate('alpha', ON)).toEqual(on);
  });

  it('retries ambient seeds and then throws a GeneratorError naming the seed', () => {
    const alwaysFail: typeof verifyDiscoveryPaths = (): DiscoveryResult => ({
      ok: false,
      root: { entities: new Set(), channels: new Set(), documents: new Set(), leads: new Set() },
      stages: [],
      single: [],
      failure: {
        kind: 'stage',
        stage: 'stage:forced-failure',
        reason: 'forced',
        hasHuman: false,
        hasSignal: false,
      },
    });
    expect(() =>
      generate('alpha', ON, { ambientVerifier: alwaysFail, maxAmbientAttempts: 8 }),
    ).toThrow(GeneratorError);
    try {
      generate('alpha', ON, { ambientVerifier: alwaysFail, maxAmbientAttempts: 8 });
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorError);
      if (error instanceof GeneratorError) {
        expect(error.phase).toBe('ambient');
        expect(error.seed).toBe('alpha');
        expect(error.attempts).toBe(8);
        expect(error.message).toContain('alpha');
      }
    }
  });
});
