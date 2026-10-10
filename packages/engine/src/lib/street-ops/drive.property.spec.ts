/**
 * Property 4 (street-ops task 6.1): a drive charges the phase boundaries its
 * ticks cross, and one phase at the end when it crossed none. The clock moves
 * by that total. Steps never run the tick count backwards.
 *
 * **Validates: Requirements 4.2, 4.3, 4.4**
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

import { quote, resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import type { Action } from '../action/types.js';
import { addPhases } from '../clock/clock.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { createPrng } from '../prng/prng.js';
import { streetOpsRegistry } from './addon.js';
import { chargeTicks, closeClock, driveCandidates, runtimeFromScenario, type DriveClock } from './drive.js';
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
    streetOps: { enabled: true, ticksPerPhase: 1 },
  });
}

describe('drive time accounting', () => {
  it('charges the boundaries a session crosses, and one phase when it crosses none', () => {
    // Feature: street-ops, Property 4: Time accounting
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.array(fc.integer({ min: 0, max: 80 }), { minLength: 1, maxLength: 12 }),
        (ticksPerPhase, steps) => {
          let clock: DriveClock = { ticks: 0, phasesCharged: 0 };
          let quoted = 0;
          for (const added of steps) {
            const next = chargeTicks(clock, added, ticksPerPhase);
            expect(next.clock.ticks).toBeGreaterThanOrEqual(clock.ticks);
            const boundaries =
              Math.floor(next.clock.ticks / ticksPerPhase) - Math.floor(clock.ticks / ticksPerPhase);
            expect(next.phases).toBe(boundaries);
            quoted += next.phases;
            clock = next.clock;
          }
          const closed = closeClock(clock);
          quoted += closed.phases;
          const boundaries = Math.floor(closed.clock.ticks / ticksPerPhase);
          const expected = boundaries === 0 ? 1 : boundaries;
          expect(closed.clock.phasesCharged).toBe(expected);
          expect(quoted).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('moves the clock by the phases a drive quotes, and keeps recognition data off the player record', () => {
    const enabled = scenario();
    const world = generate('street-ops-drive', {
      ...LOADED.inputs,
      preset: preset(),
      scenario: enabled,
    });
    const file = gridGraph(2, 2);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const graph = compileStreetGraph({
      ...file,
      frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
    });
    const runtime = runtimeFromScenario(enabled, {
      ticksPerPhase: 1,
      graphs: [graph],
      vehicles: [
        {
          id: 'pool-coupe',
          name: 'Pool coupe',
          era: { from: world.meta.setting.year, to: world.meta.setting.year },
          speed: 'normal',
          seats: 2,
          conspicuousness: 0.5,
          spots: [{ id: 'boot', capacity: 1, search: 0.4, endurance: 0.6 }],
        },
        {
          id: 'future-wagen',
          name: 'Future wagen',
          era: { from: world.meta.setting.year + 10, to: world.meta.setting.year + 20 },
          speed: 'fast',
          seats: 2,
          conspicuousness: 0.9,
          spots: [],
        },
      ],
    });
    const extensions = streetOpsRegistry(enabled, runtime);
    const ctx: ResolverContext = { content: LOADED.content, extensions };
    const offered = driveCandidates(world, ctx).map((action) => action.vehicle);
    expect(offered).toEqual(['pool-coupe']);

    const steps: Action[] = [
      { kind: 'street-ops.drive', vehicle: 'pool-coupe' },
      { kind: 'street-ops.turn', relative: 'straight' },
      { kind: 'street-ops.park' },
    ];
    let state = world;
    let time = world.time;
    let quoted = 0;
    for (const action of steps) {
      const q = quote(state, action, ctx);
      expect(q.allowed).toBe(true);
      quoted += q.phases;
      time = addPhases(time, q.phases);
      state = resolve(state, action, createPrng('street-ops-drive'), ctx).next;
    }
    expect(quoted).toBeGreaterThanOrEqual(1);
    expect(time).toEqual(addPhases(world.time, quoted));
    expect(state.time).toEqual(world.time);
    expect(state.ext?.streetOps?.session).toBeUndefined();
    const vehicle = state.ext?.streetOps?.vehicles[0];
    expect(vehicle).toEqual({
      id: 'pool-coupe',
      def: 'pool-coupe',
      plate: 'P-POOLCO',
      knownBurned: false,
    });
    const future = quote(world, { kind: 'street-ops.drive', vehicle: 'future-wagen' }, ctx);
    expect(future.allowed).toBe(false);
    expect(future.reason).toBe('not available in this year');
  });
});
