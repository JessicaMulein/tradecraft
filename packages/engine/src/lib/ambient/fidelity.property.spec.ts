/**
 * Property 22: tier-independent couplings.
 * Feature: ambient-world, Property 22: Tier-independent couplings
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
import { runAmbientContract } from '../fidelity/contract.js';
import { generate, type GenerateInputs } from '../generate.js';
import { revealTruth, type Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { stepCover } from './cover.js';
import { ambientContractOf, createAmbientSimulator, disclosedHolds, playerConcerning } from './fidelity.js';
import { eligiblePair } from './gossip.js';
import { applyHook } from './hooks.js';
import { isPrincipalNpc } from './life.js';
import type { Overlay } from './locations.js';
import { ambientDayBoundary, ambientPhase } from './tick.js';

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

const DENSITIES = ['sparse', 'standard', 'rich'] as const;

function loadCore() {
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
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const CORE = loadCore();

function presetOf(id: string): DifficultyPreset {
  for (const [key, value] of CORE.content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no preset ${id}`);
}

function scenario(presetId: string, density: (typeof DENSITIES)[number]): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: presetId },
    mole: false,
    ambient: { enabled: true, density },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(presetId: string, density: (typeof DENSITIES)[number]): GenerateInputs {
  return {
    content: CORE.content,
    preset: presetOf(presetId),
    scenario: scenario(presetId, density),
    cityData: CORE.cityData,
    descriptors: CORE.descriptors,
    publicTexts: CORE.publicTexts,
  };
}

describe('ambient fidelity', () => {
  it('queues a cover hook in multi-city mode and still applies it in single-city mode', () => {
    const world = generate('fidelity-hook', inputs('standard', 'sparse'));
    const ambient = world.ambient;
    expect(ambient).toBeDefined();
    if (ambient === undefined) {
      return;
    }
    const armed = {
      ...world,
      ambient: { ...ambient, multiCity: true as const, pendingCouplings: [] },
    };
    const queued = applyHook(armed, { kind: 'cover-suspicion-delta', amount: 0.05 });
    expect(revealTruth(queued.next.player.coverSuspicion)).toBe(revealTruth(world.player.coverSuspicion));
    expect(queued.next.ambient?.pendingCouplings).toEqual([
      { kind: 'cover-suspicion-delta', amount: 0.05, cause: 'ambient' },
    ]);
    expect(queued.next.plot).toEqual(world.plot);
    const plain = applyHook(world, { kind: 'cover-suspicion-delta', amount: 0.05 });
    expect(plain.applied).toBe(true);
    expect(revealTruth(plain.next.player.coverSuspicion)).not.toBe(revealTruth(world.player.coverSuspicion));
    expect(plain.next.ambient?.pendingCouplings).toBeUndefined();
  });

  it('maps status, curfew, crowd and route overlays, and ignores an ended overlay', () => {
    const world = generate('fidelity-overlays', inputs('standard', 'sparse'));
    const ambient = world.ambient;
    expect(ambient).toBeDefined();
    if (ambient === undefined) {
      return;
    }
    const day = world.time.day;
    const overlays: Overlay[] = [
      {
        id: 'ov:closed',
        source: 'evt:t',
        target: 'loc:cafe',
        fromDay: day,
        toDay: day + 2,
        effect: { kind: 'location-status', status: 'closed-temporarily' },
      },
      {
        id: 'ov:open',
        source: 'evt:t',
        target: 'loc:open',
        fromDay: day,
        toDay: day + 2,
        effect: { kind: 'location-status', status: 'open' },
      },
      {
        id: 'ov:curfew',
        source: 'evt:t',
        target: 'loc:bar',
        fromDay: day,
        toDay: day + 2,
        effect: { kind: 'curfew', phases: ['evening'] },
      },
      {
        id: 'ov:crowd',
        source: 'evt:t',
        target: 'loc:park',
        fromDay: day,
        toDay: day + 2,
        effect: { kind: 'crowd-modifier', factor: 0.5 },
      },
      {
        id: 'ov:route',
        source: 'evt:t',
        target: 'district:a|district:b',
        fromDay: day,
        toDay: day + 2,
        effect: { kind: 'route-closure' },
      },
      {
        id: 'ov:checkpoint',
        source: 'evt:t',
        target: 'district:c|district:d',
        fromDay: day,
        toDay: day + 2,
        effect: { kind: 'route-checkpoint', detection: 0.4, coverRisk: 0.2 },
      },
      {
        id: 'ov:ended',
        source: 'evt:t',
        target: 'loc:ended',
        fromDay: day,
        toDay: day,
        effect: { kind: 'crowd-modifier', factor: 0.2 },
      },
    ];
    const simulator = createAmbientSimulator();
    const city = ambient.cityId.startsWith('city:') ? ambient.cityId : `city:${ambient.cityId}`;
    const listed = simulator.couplings(
      city as `city:${string}`,
      { world: { ...world, ambient: { ...ambient, overlays } }, disclosed: [] },
      world.time,
    );
    expect(listed).toEqual([
      { kind: 'location-closed', loc: 'loc:cafe', phases: 4 },
      { kind: 'location-closed', loc: 'loc:bar', phases: 1 },
      { kind: 'crowd-modifier', loc: 'loc:park', factor: 0.5 },
      { kind: 'route-delay', route: 'route:district:a|district:b', phases: 4 },
      { kind: 'route-delay', route: 'route:district:c|district:d', phases: 4 },
    ]);
  });

  it('treats spine placements in the same city as co-present', () => {
    const base = {
      time: { day: 0, phase: 0 },
      npcs: {},
      ambient: {
        ties: [],
        cityId: 'city:vienna',
        spinePlacements: {
          'npc:a': { city: 'city:vienna', loc: 'loc:cafe' },
          'npc:b': { city: 'city:vienna', loc: 'loc:cafe' },
          'npc:c': { city: 'city:vienna', loc: 'loc:park' },
          'npc:d': { city: 'city:prague', loc: 'loc:cafe' },
        },
      },
    } as unknown as WorldState;
    expect(eligiblePair(base, 'npc:a', 'npc:b')).toBe(true);
    expect(eligiblePair(base, 'npc:a', 'npc:c')).toBe(false);
    expect(eligiblePair(base, 'npc:a', 'npc:d')).toBe(false);
  });

  it('keeps principals off cover duties in multi-city mode', () => {
    const world = generate('fidelity-duties', inputs('standard', 'sparse'));
    const ambient = world.ambient;
    expect(ambient).toBeDefined();
    if (ambient === undefined) {
      return;
    }
    const armed = {
      ...world,
      time: { day: 0, phase: 0 as const },
      ambient: { ...ambient, multiCity: true as const, duties: [], pendingCouplings: [] },
    };
    const stepped = stepCover(armed);
    const duties = stepped.ambient?.duties ?? [];
    expect(duties.length).toBeGreaterThan(0);
    for (const duty of duties) {
      for (const id of duty.attendees) {
        expect(isPrincipalNpc(stepped, id)).toBe(false);
      }
    }
  });

function singleCityDay(world: WorldState): WorldState {
  let state = ambientDayBoundary(structuredClone(world)).state;
  const day = state.time.day;
  for (const phase of [0, 1, 2, 3] as const) {
    state = ambientPhase({ ...state, time: { day, phase } }).state;
  }
  return state;
}

function eventSignature(world: WorldState): unknown {
  const events = world.ambient?.events ?? {};
  return Object.keys(events)
    .sort()
    .map((id) => ({ id, value: events[id as keyof typeof events] }));
}

  // Feature: ambient-world, Property 22: Tier-independent couplings
  it('keeps a week of couplings, events and player-concerning state tier-independent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.constantFrom(...DENSITIES),
        fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
        (seed, density, coarseDays) => {
          const world = generate(String(seed), inputs('standard', density));
          const left = singleCityDay(world);
          const right = singleCityDay(world);
          expect(left.ambient?.multiCity).toBeUndefined();
          expect(left.ambient?.pendingCouplings).toBeUndefined();
          expect(eventSignature(left)).toEqual(eventSignature(right));
          expect(revealTruth(left.player.coverSuspicion)).toBe(revealTruth(right.player.coverSuspicion));

          const spec = ambientContractOf(world);
          runAmbientContract(spec);
          const simulator = createAmbientSimulator();
          const origin = spec.spine();
          const ids = Object.keys(world.npcs).sort();
          const placements =
            ids[0] !== undefined && ids[1] !== undefined
              ? {
                  [ids[0]]: { city: spec.city, loc: world.player.loc },
                  [ids[1]]: { city: spec.city, loc: world.player.loc },
                }
              : {};
          let mixed = spec.initial();
          let full = spec.initial();
          const mixedCouplings = [];
          const fullCouplings = [];
          for (let day = 0; day < coarseDays.length; day += 1) {
            const spine = {
              time: { day: origin.time.day + day, phase: 0 as const },
              placements,
            };
            const step = coarseDays[day] === true ? simulator.advanceCoarse : simulator.advanceFull;
            mixed = step(spec.city, mixed, spine, createPrng(`${seed}:mixed:${day}`)).next;
            full = simulator.advanceFull(spec.city, full, spine, createPrng(`${seed}:full:${day}`)).next;
            mixedCouplings.push(simulator.couplings(spec.city, mixed, spine.time));
            fullCouplings.push(simulator.couplings(spec.city, full, spine.time));
            expect(playerConcerning(mixed)).toEqual(playerConcerning(full));
            expect(eventSignature(mixed.world)).toEqual(eventSignature(full.world));
            expect(revealTruth(mixed.world.player.coverSuspicion)).toBe(revealTruth(world.player.coverSuspicion));
            expect(mixed.world.plot.stages).toEqual(world.plot.stages);
            expect(mixed.world.channels).toEqual(world.channels);
            if (day === 0) {
              expect(eventSignature(full.world)).toEqual(eventSignature(left));
            }
          }
          expect(mixedCouplings).toEqual(fullCouplings);
          expect(fullCouplings.some((listed) => listed.length > 0)).toBe(true);
          const disclosed: readonly Proposition[] = [
            {
              id: 'prop:seen',
              subject: 'npc:clerk',
              predicate: 'HAS_STATUS',
              object: { kind: 'text', value: 'seen' },
            },
          ];
          const reconciled = simulator.reconcile(
            spec.city,
            { world: full.world, disclosed: [] },
            { time: { day: origin.time.day + coarseDays.length, phase: 0 }, placements },
            disclosed,
            createPrng(String(seed)),
          );
          expect(reconciled.disclosed).toEqual(disclosed);
          expect(disclosedHolds(reconciled.world, disclosed[0]!)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});
