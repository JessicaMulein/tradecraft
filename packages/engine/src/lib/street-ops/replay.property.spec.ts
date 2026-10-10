/**
 * Property 13 (street-ops task 15.3). Replaying a drive, a checkpoint and a
 * bluff from the same seed reproduces the same state and the same fact lines.
 *
 * **Validates: Requirements 13.1, 13.2**
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

import { resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import type { Action } from '../action/types.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { TruthStore } from '../truth/truth.js';
import { streetOpsRegistry } from './addon.js';
import { CheckpointKindSchema } from './content.js';
import { runtimeFromScenario } from './drive.js';
import { compileStreetGraph, gridGraph } from './graph.js';

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

function scenario(): ScenarioConfig {
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
    streetOps: { enabled: true, ticksPerPhase: 360 },
  });
}

function play(start: WorldState, actions: readonly Action[], ctx: ResolverContext, seed: string): {
  readonly states: readonly WorldState[];
  readonly lines: readonly string[];
} {
  const states: WorldState[] = [];
  const lines: string[] = [];
  let state = start;
  for (const action of actions) {
    const resolved = resolve(state, action, createPrng(seed), ctx);
    state = resolved.next;
    states.push(state);
    lines.push(resolved.result.factLines.join('\n'));
  }
  return { states, lines };
}

describe('street session replay', () => {
  const enabled = scenario();
  const world = generate('street-ops-replay', { ...LOADED.inputs, preset: preset(), scenario: enabled });
  const file = gridGraph(2, 2);
  const segment = file.segments[0]?.id;
  if (segment === undefined) throw new Error('grid has no segment');
  const graph = compileStreetGraph({
    ...file,
    frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
    checkpoints: [{ id: 'halt', kind: 'document-halt', segment, at: 0.5, service: 'local' }],
  });
  const runtime = runtimeFromScenario(enabled, {
    graphs: [graph],
    checkpoints: [
      CheckpointKindSchema.parse({
        id: 'document-halt',
        borderCheck: 'pass',
        thoroughness: 0.3,
        hours: ['morning', 'afternoon', 'evening', 'night'],
        searches: ['visual'],
      }),
    ],
    stories: [{ id: 'late-from-the-office', slots: ['origin'], fits: ['cover'], followUps: [] }],
    vehicles: [
      {
        id: 'pool-coupe',
        name: 'Pool coupe',
        era: { from: world.meta.setting.year, to: world.meta.setting.year },
        speed: 'normal',
        seats: 2,
        conspicuousness: 0.4,
        spots: [],
      },
    ],
  });
  const extensions = streetOpsRegistry(enabled, runtime);

  it('reproduces the state and the fact lines of a recorded session', () => {
    // Feature: street-ops, Property 13: Replay equality
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('straight', 'left', 'right', 'back'), { minLength: 1, maxLength: 3 }),
        fc.constantFrom('Where are you going?', 'Papers. Now.', 'Out of the car.'),
        (turns, flavour) => {
          const actions: Action[] = [
            { kind: 'street-ops.drive', vehicle: 'pool-coupe' },
            ...turns.map((relative) => ({ kind: 'street-ops.turn' as const, relative })),
            { kind: 'street-ops.bluff', template: 'late-from-the-office', flavour },
            { kind: 'street-ops.park' },
          ];
          const context = (): ResolverContext => ({
            content: LOADED.content,
            extensions,
            truth: TruthStore.create({ get: () => undefined }),
          });
          const start = JSON.parse(JSON.stringify(world)) as WorldState;
          const first = play(start, actions, context(), 'street-ops-replay');
          const second = play(JSON.parse(JSON.stringify(world)) as WorldState, actions, context(), 'street-ops-replay');
          expect(second.states).toEqual(first.states);
          expect(second.lines).toEqual(first.lines);
          expect(second.lines.join('\n').toLowerCase()).not.toContain('you are being followed');
        },
      ),
      { numRuns: 100 },
    );
  });
});
